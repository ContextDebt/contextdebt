#!/usr/bin/env node
/**
 * ContextDebt scanner v0 — finds self-admitted workarounds in your codebase
 * and checks whether the reasons they cite are already dead.
 *
 * Runs 100% locally. Your code never leaves your machine.
 * The only network calls are GitHub API lookups for issue URLs
 * that YOUR OWN comments reference (status check only).
 *
 * https://contextdebt.dev
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");

const VERSION = "0.1.7";
const LANG = new Map([
  [".js", "js"], [".jsx", "js"], [".ts", "js"], [".tsx", "js"], [".mjs", "js"], [".cjs", "js"],
  [".php", "php"], [".liquid", "liquid"], [".py", "py"], [".pyi", "py"]
]);
const EXT = new Set(LANG.keys());
const EXCLUDE_DIR = /^(node_modules|dist|build|out|vendor|coverage|\.git|\.next|\.turbo|\.cache|__tests__|__mocks__|test|tests|spec|e2e|fixtures|examples?|docs?|\.storybook|t|\.venv|venv|site-packages|__pycache__|\.tox|\.mypy_cache|\.ruff_cache)$/;
// `build`, `dist` and `out` are excluded at any depth, which is right for build
// output and wrong for the occasional hand-written source dir (CPython's Tools/build).
// We keep the exclusion — letting generated code in would cost precision — but report
// what was skipped, so the escape hatch (scan that path directly) is discoverable.
const OUTPUT_DIR = /^(dist|build|out)$/;
const EXCLUDE_FILE = /\.(test|spec|stories|d)\.(js|jsx|ts|tsx|mjs|cjs)$|\.min\.js$/;

const MARKER = new RegExp(
  [
    "workaround", "hacky", "\\bHACK\\b", "hotfix", "band-?aid", "kludge",
    "temporar(?:y|ily)\\s+(?:fix|hack|solution|workaround|patch)",
    "until\\s+(?:we|this|it|they)\\b.{0,60}?(?:upgrade|fix|release|support|land|migrate)"
  ].join("|"),
  "gi"
);
// removal intents ("remove this when...", "will be deleted after...") appear in UI strings
// too — only trust them inside comments.
const MARKER_REMOVAL = new RegExp(
  [
    "(?:remove|delete)\\s+(?:this|once|when|after)\\b",
    "(?:can|should|will)\\s+be\\s+(?:removed|deleted)\\s+(?:when|once|after|in|by)"
  ].join("|"),
  "gi"
);
const ISSUE_URL = /github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)/g;
const TRAC_URL = /(?:core|meta)\.trac\.wordpress\.org\/ticket\/(\d+)/g;

// A span flagged WEAK holds prose rather than a code comment: explicit marker words
// still count there, removal intents do not.
const WEAK = true;

// A marker word only counts when it sits in a comment. Every supported language
// has its own idea of what a comment is, so each one gets a scanner that returns
// the comment ranges of a line plus the state to carry into the next line.
// Ranges are [start, end) index pairs into the line.

// JS/TS: `//` to end of line, `/* */` across lines. String literals are skipped so
// the `//` in `const u = "https://x"` doesn't fake a comment. Regex literals are not
// parsed — worst case a marker after one is missed, which costs recall, never precision.
function jsSpans(line, inBlock) {
  const spans = [];
  let i = 0;
  let open = inBlock ? 0 : -1;
  while (i < line.length) {
    if (open >= 0) {
      const end = line.indexOf("*/", i);
      if (end === -1) break;
      spans.push([open, end]);
      open = -1;
      i = end + 2;
      continue;
    }
    const ch = line[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i += 1;
      while (i < line.length && line[i] !== ch) i += line[i] === "\\" ? 2 : 1;
      i += 1;
      continue;
    }
    if (ch === "/" && line[i + 1] === "/") {
      spans.push([i + 2, line.length]);
      return { spans, state: false };
    }
    if (ch === "/" && line[i + 1] === "*") { open = i + 2; i += 2; continue; }
    i += 1;
  }
  if (open >= 0) {
    spans.push([open, line.length]);
    return { spans, state: true };
  }
  return { spans, state: false };
}

// Python: `#` to end of line, plus docstrings. A triple-quoted block counts as a
// comment only when nothing but whitespace precedes it — that is what separates a
// docstring from data (`SQL = """select ..."""`) or an argument
// (`parser(description="""...""")`), where marker words are content, not confessions.
// Docstring spans are marked weak: they are prose written for the reader, so
// "Remove this directory." (pathlib) documents behaviour, it does not confess debt.
// Carried state is null or { delim, counts }.
function pySpans(line, open) {
  const spans = [];
  let i = 0;
  let start = open ? 0 : -1;
  while (i < line.length) {
    if (open) {
      const end = line.indexOf(open.delim, i);
      if (end === -1) break;
      if (open.counts) spans.push([start, end, WEAK]);
      i = end + 3;
      open = null;
      start = -1;
      continue;
    }
    const ch = line[i];
    if (ch === "#") {
      spans.push([i + 1, line.length]);
      return { spans, state: null };
    }
    if (ch === '"' || ch === "'") {
      const delim = line.slice(i, i + 3);
      if (delim === '"""' || delim === "'''") {
        // r/b/u/f prefixes belong to the quote, not to the code before it
        const counts = line.slice(0, i).replace(/[rRbBuUfF]+$/, "").trim() === "";
        const end = line.indexOf(delim, i + 3);
        if (end !== -1) {
          if (counts) spans.push([i + 3, end, WEAK]);
          i = end + 3;
          continue;
        }
        open = { delim, counts };
        start = i + 3;
        break;
      }
      i += 1;
      while (i < line.length && line[i] !== ch) i += line[i] === "\\" ? 2 : 1;
      i += 1;
      continue;
    }
    i += 1;
  }
  if (open) {
    if (open.counts) spans.push([start < 0 ? 0 : start, line.length, WEAK]);
    return { spans, state: open };
  }
  return { spans, state: null };
}

// PHP is two languages in one file. Outside `<?php … ?>` the text is template output —
// marker words there are page copy, so only `<!-- -->` counts. Inside the code block,
// `//`, `#` and `/* */` count. `#[Attribute]` is PHP 8 syntax, not a comment.
// Heredocs are not tracked; a `//` inside one can open a false comment span.
// Carried state is { inPhp, block } where block is "/*", "<!--" or null.
function phpSpans(line, st) {
  const spans = [];
  let i = 0;
  let inPhp = st.inPhp;
  let block = st.block;
  let open = block ? 0 : -1;
  while (i < line.length) {
    if (block) {
      const close = block === "/*" ? "*/" : "-->";
      const end = line.indexOf(close, i);
      if (end === -1) break;
      spans.push([open, end]);
      i = end + close.length;
      block = null;
      open = -1;
      continue;
    }
    if (!inPhp) {
      const tag = line.indexOf("<?", i);
      const html = line.indexOf("<!--", i);
      if (html !== -1 && (tag === -1 || html < tag)) {
        block = "<!--"; open = html + 4; i = open;
        continue;
      }
      if (tag === -1) break;
      inPhp = true;
      i = tag + 2;
      continue;
    }
    const ch = line[i];
    if (ch === '"' || ch === "'") {
      i += 1;
      while (i < line.length && line[i] !== ch) i += line[i] === "\\" ? 2 : 1;
      i += 1;
      continue;
    }
    if (ch === "?" && line[i + 1] === ">") { inPhp = false; i += 2; continue; }
    if ((ch === "#" && line[i + 1] !== "[") || (ch === "/" && line[i + 1] === "/")) {
      const from = ch === "#" ? i + 1 : i + 2;
      const end = line.indexOf("?>", from); // a line comment also ends at `?>`
      if (end === -1) {
        spans.push([from, line.length]);
        return { spans, state: { inPhp, block: null } };
      }
      spans.push([from, end]);
      inPhp = false;
      i = end + 2;
      continue;
    }
    if (ch === "/" && line[i + 1] === "*") { block = "/*"; open = i + 2; i += 2; continue; }
    i += 1;
  }
  if (block) spans.push([open, line.length]);
  return { spans, state: { inPhp, block } };
}

const LIQUID_OPEN = /<!--|\{%-?\s*comment\s*-?%\}/g;
const LIQUID_END = { html: /-->/g, liquid: /\{%-?\s*endcomment\s*-?%\}/g };

// Liquid templates: `{% comment %}` blocks and HTML comments. Everything else is
// markup the shopper reads. Carried state is "html", "liquid" or null.
function liquidSpans(line, st) {
  const spans = [];
  let i = 0;
  let block = st;
  let open = st ? 0 : -1;
  while (i <= line.length) {
    const re = block ? LIQUID_END[block] : LIQUID_OPEN;
    re.lastIndex = i;
    const m = re.exec(line);
    if (!m) break;
    if (block) {
      spans.push([open, m.index]);
      block = null;
      open = -1;
    } else {
      block = m[0][0] === "<" ? "html" : "liquid";
      open = m.index + m[0].length;
    }
    i = m.index + m[0].length;
  }
  if (block) {
    spans.push([open, line.length]);
    return { spans, state: block };
  }
  return { spans, state: null };
}

const INITIAL_STATE = { js: false, py: null, php: { inPhp: false, block: null }, liquid: null };
const SPANNER = { js: jsSpans, py: pySpans, php: phpSpans, liquid: liquidSpans };
function commentSpans(lang, line, state) { return SPANNER[lang](line, state); }

// First index where `re` matches and `allow` accepts it, or -1. Walking past a
// rejected match matters: `var kludge = 0; // workaround until we upgrade` is a
// real marker hiding behind an identifier.
function firstMatch(re, line, allow) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(line)) !== null) {
    if (allow(m.index)) return m.index;
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  return -1;
}

// Index of the first trustworthy marker match on a line, or -1.
function markerIndex(line, spans) {
  const inAny = (i) => spans.some(([s, e]) => i >= s && i < e);
  const inStrong = (i) => spans.some(([s, e, weak]) => !weak && i >= s && i < e);
  const hits = [];
  const m = firstMatch(MARKER, line, inAny);
  if (m !== -1) hits.push(m);
  // the spans already prove we are in a comment, so the removal intents — which are
  // the ones that show up in UI strings — need no extra textual test.
  if (spans.some(([, , weak]) => !weak)) {
    const r = firstMatch(MARKER_REMOVAL, line, inStrong);
    if (r !== -1) hits.push(r);
  }
  return hits.length ? Math.min(...hits) : -1;
}

// A date alone proves nothing: "# 2014-12-02 ch/doko Add workaround" is an authored
// date and "Hack Standard Library (v4.40 - 2020-05-03)" is a version stamp. Only
// treat a date as an expiry when something nearby says the code is meant to go away.
const DATE_INTENT = /\b(?:remov\w*|delet\w*|drop\w*|after|until|by|expir\w*)\b/i;
const ANY_DATE = /20\d{2}-\d{2}-\d{2}/;

// The date on `lines[i]`, but only when a removal intent sits within ±1 line.
// A neighbour that carries its own date is claimed by that date and lends nothing.
function expiryDate(lines, i) {
  const dm = lines[i].match(/(20\d{2}-\d{2}-\d{2})/);
  if (!dm) return null;
  if (DATE_INTENT.test(lines[i])) return dm[1];
  for (const j of [i - 1, i + 1]) {
    const n = lines[j];
    if (n === undefined || ANY_DATE.test(n)) continue;
    if (DATE_INTENT.test(n)) return dm[1];
  }
  return null;
}

// ---------- tiny ansi ----------
const tty = process.stdout.isTTY;
const c = (n) => (s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : String(s));
const red = c(31), yellow = c(33), dim = c(2), bold = c(1);
const redBold = (s) => c(1)(c(31)(s));

// ---------- walk & scan ----------
function scan(root) {
  let loc = 0, files = 0;
  const skipped = [];
  const findings = [];
  const stack = [root];
  const started = Date.now();
  let lastTick = 0;
  const progress = () => {
    if (!process.stderr.isTTY) return;
    const now = Date.now();
    if (now - lastTick < 200) return;
    lastTick = now;
    const secs = ((now - started) / 1000).toFixed(0);
    process.stderr.write(`\r  scanning… ${files} files, ${loc.toLocaleString()} lines (${secs}s)   `);
  };
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!EXCLUDE_DIR.test(e.name)) { stack.push(path.join(dir, e.name)); continue; }
        if (OUTPUT_DIR.test(e.name)) skipped.push(path.relative(root, path.join(dir, e.name)));
        continue;
      }
      if (!e.isFile()) continue;
      if (!EXT.has(path.extname(e.name)) || EXCLUDE_FILE.test(e.name)) continue;
      const p = path.join(dir, e.name);
      let text;
      try { text = fs.readFileSync(p, "utf8"); } catch { continue; }
      const lines = text.split("\n");
      const lang = LANG.get(path.extname(e.name));
      loc += lines.length; files += 1;
      progress();
      let state = INITIAL_STATE[lang];
      for (let i = 0; i < lines.length; i++) {
        // must run before the length skip below, or a long line loses the block state
        const cs = commentSpans(lang, lines[i], state);
        state = cs.state;
        if (lines[i].length > 500) continue; // minified/bundled line — not a human comment
        if (markerIndex(lines[i], cs.spans) === -1) continue;
        if (/(cannot|can\x27t|don\x27t|do not|won\x27t|shouldn\x27t|must not|never)\s+(be\s+)?(remove|delete)/i.test(lines[i])) continue;
        const ctx = lines.slice(Math.max(0, i - 2), i + 2).join("\n");
        const issues = [...ctx.matchAll(ISSUE_URL)].map((m) => ({
          url: m[0], owner: m[1], repo: m[2], num: m[4]
        }));
        const trac = [...ctx.matchAll(TRAC_URL)].map((m) => m[0]);
        findings.push({
          file: path.relative(root, p), line: i + 1,
          text: lines[i].trim().slice(0, 160), issues, trac,
          dated: expiryDate(lines, i)
        });
      }
    }
  }
  if (process.stderr.isTTY) process.stderr.write("\r" + " ".repeat(60) + "\r");
  return { loc, files, findings, skipped };
}

// ---------- tier 2: issue status ----------
function fetchIssue(owner, repo, num) {
  return new Promise((resolve) => {
    const headers = { "User-Agent": "contextdebt-cli", "Accept": "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
    const req = https.get(
      { host: "api.github.com", path: `/repos/${owner}/${repo}/issues/${num}`, headers, timeout: 8000 },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          if (res.statusCode !== 200) return resolve({ state: null, note: `HTTP ${res.statusCode}` });
          try {
            const d = JSON.parse(body);
            resolve({ state: d.state, closed_at: d.closed_at, state_reason: d.state_reason, title: d.title });
          } catch { resolve({ state: null, note: "parse error" }); }
        });
      }
    );
    req.on("error", () => resolve({ state: null, note: "network error" }));
    req.on("timeout", () => { req.destroy(); resolve({ state: null, note: "timeout" }); });
  });
}

// ---------- main ----------
(async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--version") || args.includes("-v")) { console.log(VERSION); return; }
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
  ${bold("contextdebt")} v${VERSION} — find the expired code your AI reads every day

  Usage: npx contextdebt [path] [--json] [--all]

  Scans JS/TS/PHP/Python source for self-admitted workarounds ("workaround",
  "until we upgrade", "TODO: remove when ...") and checks whether
  GitHub issues they reference are already closed.

  Runs 100% locally — your code never leaves your machine.
  Set GITHUB_TOKEN to raise the issue-lookup rate limit.

  https://contextdebt.dev
`);
    return;
  }
  const json = args.includes("--json");
  const showAll = args.includes("--all");
  const root = path.resolve(args.find((a) => !a.startsWith("-")) || ".");

  if (!json) {
    console.log("");
    console.log(`  ${bold("Context")}${redBold("Debt")} ${dim("v" + VERSION + " — scanning " + root)}`);
    console.log(dim("  running locally · your code never leaves this machine"));
    console.log("");
  }

  const t0 = Date.now();
  const { loc, files, findings, skipped } = scan(root);

  if (files === 0) {
    console.log("  No JS/TS/PHP/Python source files found here. Run inside a repository.");
    console.log(dim("  https://contextdebt.dev"));
    return;
  }

  // resolve unique issues (budget without token; GitHub unauth limit is low)
  const unique = new Map();
  for (const f of findings) for (const i of f.issues) unique.set(i.url, i);
  const budget = process.env.GITHUB_TOKEN ? 100 : 15;
  const resolved = {};
  for (const [url, i] of [...unique].slice(0, budget)) {
    resolved[url] = await fetchIssue(i.owner, i.repo, i.num);
  }

  const expired = findings.filter((f) =>
    f.issues.some((i) => resolved[i.url] && resolved[i.url].state === "closed")
  );
  const todayISO = new Date().toISOString().slice(0, 10);
  const datedExpired = findings.filter((f) => f.dated && f.dated < todayISO && !expired.includes(f));
  const datedUpcoming = findings.filter((f) => f.dated && f.dated >= todayISO);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (+secs > 60 && !json) {
    console.log(dim("  note: slow scan usually means files are in a cloud-synced folder (iCloud/OneDrive)"));
    console.log(dim("  and had to be downloaded first. Re-running will be much faster."));
    console.log("");
  }
  const density = loc ? (findings.length / loc * 10000) : 0;

  if (json) {
    const tracRefs = [...new Set(findings.flatMap((f) => f.trac || []))];
    console.log(JSON.stringify({ version: VERSION, root, files, loc, markers: findings.length,
      density_per_10k_loc: +density.toFixed(2), issues_checked: Object.keys(resolved).length,
      expired_reasons: expired.length,
      expired_by_own_date: datedExpired.length, dated_upcoming: datedUpcoming.length,
      trac_tickets_referenced: tracRefs.length, skipped_dirs: skipped,
      findings, issues: resolved }, null, 2));
    return;
  }

  console.log(`  ${bold(String(files).padStart(7))}  files scanned ${dim("(" + secs + "s)")}`);
  console.log(`  ${bold(loc.toLocaleString().padStart(7))}  lines of code`);
  console.log(`  ${bold(String(findings.length).padStart(7))}  self-admitted workarounds ${dim("(" + density.toFixed(2) + " per 10k LOC)")}`);
  if (expired.length > 0) {
    console.log(`  ${redBold(String(expired.length).padStart(7))}  ${redBold("with EXPIRED reasons")} ${dim("— the issue they cite is already closed")}`);
  }
  if (datedExpired.length > 0) {
    console.log(`  ${redBold(String(datedExpired.length).padStart(7))}  ${redBold("past their own written expiry date")}`);
  }
  console.log("");
  if (datedExpired.length > 0) {
    console.log(`  ${redBold("EXPIRED BY THEIR OWN DATE")} ${dim("— the comment names a date that already passed:")}`);
    for (const f of datedExpired) {
      const daysLate = Math.floor((Date.now() - Date.parse(f.dated)) / 86400000);
      console.log("");
      console.log(`  ${yellow(f.file + ":" + f.line)}`);
      console.log(`    ${dim(f.text)}`);
      console.log(`    ${red("↳ dated " + f.dated + " — " + daysLate + " days past")}`);
    }
    console.log("");
  }

  if (expired.length > 0) {
    console.log(`  ${redBold("EXPIRED REASONS")} ${dim("— your own comments cite these; they're done:")}`);
    for (const f of expired) {
      const i = f.issues.find((x) => resolved[x.url] && resolved[x.url].state === "closed");
      const r = resolved[i.url];
      const when = r.closed_at ? r.closed_at.slice(0, 10) : "?";
      console.log("");
      console.log(`  ${yellow(f.file + ":" + f.line)}`);
      console.log(`    ${dim(f.text)}`);
      console.log(`    ${red("↳ " + i.url + " — closed " + when + (r.state_reason ? " (" + r.state_reason + ")" : ""))}`);
    }
    console.log("");
  }

  const rest = findings.filter((f) => !expired.includes(f) && !datedExpired.includes(f));
  if (rest.length > 0) {
    const show = showAll ? rest : rest.slice(0, 10);
    const skipped = findings.length - rest.length;
    const restNote = "(showing " + Math.min(10, rest.length) + " of " + rest.length + (skipped > 0 ? " — " + skipped + " expired listed above" : "") + " — use --all)";
    console.log(`  ${bold("SELF-ADMITTED WORKAROUNDS")} ${dim(showAll ? "" : restNote)}`);
    for (const f of show) {
      console.log(`  ${yellow(f.file + ":" + f.line)}  ${dim(f.text.slice(0, 90))}`);
    }
    console.log("");
  }

  const unchecked = [...unique.keys()].filter((u) => !resolved[u] || resolved[u].state === null);
  if (unchecked.length > 0) {
    console.log(dim(`  ${unchecked.length} referenced issue(s) not checked (rate limit / network). Set GITHUB_TOKEN to check all.`));
  }
  if (skipped.length > 0) {
    const shown = skipped.slice(0, 3).join(", ");
    console.log(dim(`  ${skipped.length} build-output director${skipped.length === 1 ? "y" : "ies"} skipped (${shown}${skipped.length > 3 ? ", …" : ""}).`));
    console.log(dim("  If one of those holds hand-written source, scan that path directly."));
  }
  if (datedUpcoming.length > 0) {
    console.log(dim(`  ${datedUpcoming.length} dated TODO(s) not due yet — watcher material.`));
  }
  const tracSet = new Set(findings.flatMap((f) => f.trac || []));
  if (tracSet.size > 0) {
    console.log(dim(`  ${tracSet.size} WordPress trac ticket(s) referenced — status check coming in the WP edition.`));
  }
  if (findings.length === 0) {
    console.log("  0 self-admitted workarounds. Either you're clean — or your debt is the");
    console.log("  silent kind: the workarounds nobody wrote a comment for.");
    console.log("");
  }
  console.log(dim("  These are the candidates your AI reads on every task."));
  console.log(dim("  Deep scan with evidence chains — coming soon: ") + bold("https://contextdebt.dev"));
  console.log("");
})();
