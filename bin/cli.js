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

const VERSION = "0.1.3";
const EXT = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".php", ".liquid"]);
const EXCLUDE_DIR = /^(node_modules|dist|build|out|vendor|coverage|\.git|\.next|\.turbo|\.cache|__tests__|__mocks__|test|tests|spec|e2e|fixtures|examples?|docs?|\.storybook)$/;
const EXCLUDE_FILE = /\.(test|spec|stories|d)\.(js|jsx|ts|tsx|mjs|cjs)$|\.min\.js$/;

const MARKER = new RegExp(
  [
    "workaround", "hacky", "\\bHACK\\b", "hotfix", "band-?aid", "kludge",
    "temporar(?:y|ily)\\s+(?:fix|hack|solution|workaround|patch)",
    "until\\s+(?:we|this|it|they)\\b.{0,60}?(?:upgrade|fix|release|support|land|migrate)"
  ].join("|"),
  "i"
);
// removal intents ("remove this when...", "will be deleted after...") appear in UI strings
// too — only trust them inside comments.
const MARKER_REMOVAL = new RegExp(
  [
    "(?:remove|delete)\\s+(?:this|once|when|after)\\b",
    "(?:can|should|will)\\s+be\\s+(?:removed|deleted)\\s+(?:when|once|after|in|by)"
  ].join("|"),
  "i"
);
const COMMENTISH = /(^|\s)(\/\/|\/\*|\*|#)|<!--|\{%-?\s*comment/;
const ISSUE_URL = /github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)/g;
const TRAC_URL = /(?:core|meta)\.trac\.wordpress\.org\/ticket\/(\d+)/g;

// ---------- tiny ansi ----------
const tty = process.stdout.isTTY;
const c = (n) => (s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : String(s));
const red = c(31), yellow = c(33), dim = c(2), bold = c(1);
const redBold = (s) => c(1)(c(31)(s));

// ---------- walk & scan ----------
function scan(root) {
  let loc = 0, files = 0;
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
        if (!EXCLUDE_DIR.test(e.name)) stack.push(path.join(dir, e.name));
        continue;
      }
      if (!e.isFile()) continue;
      if (!EXT.has(path.extname(e.name)) || EXCLUDE_FILE.test(e.name)) continue;
      const p = path.join(dir, e.name);
      let text;
      try { text = fs.readFileSync(p, "utf8"); } catch { continue; }
      const lines = text.split("\n");
      loc += lines.length; files += 1;
      progress();
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].length > 500) continue; // minified/bundled line — not a human comment
        const isMarker = MARKER.test(lines[i]) ||
          (MARKER_REMOVAL.test(lines[i]) && COMMENTISH.test(lines[i]));
        if (!isMarker) continue;
        if (/(cannot|can\x27t|don\x27t|do not|won\x27t|shouldn\x27t|must not|never)\s+(be\s+)?(remove|delete)/i.test(lines[i])) continue;
        const ctx = lines.slice(Math.max(0, i - 2), i + 2).join("\n");
        const issues = [...ctx.matchAll(ISSUE_URL)].map((m) => ({
          url: m[0], owner: m[1], repo: m[2], num: m[4]
        }));
        const trac = [...ctx.matchAll(TRAC_URL)].map((m) => m[0]);
        const dm = lines[i].match(/(20\d{2}-\d{2}-\d{2})/);
        findings.push({
          file: path.relative(root, p), line: i + 1,
          text: lines[i].trim().slice(0, 160), issues, trac,
          dated: dm ? dm[1] : null
        });
      }
    }
  }
  if (process.stderr.isTTY) process.stderr.write("\r" + " ".repeat(60) + "\r");
  return { loc, files, findings };
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

  Scans JS/TS/PHP source for self-admitted workarounds ("workaround",
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
  const { loc, files, findings } = scan(root);

  if (files === 0) {
    console.log("  No JS/TS/PHP source files found here. Run inside a repository.");
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
      trac_tickets_referenced: tracRefs.length,
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
    console.log(`  ${bold("SELF-ADMITTED WORKAROUNDS")} ${dim(showAll ? "" : "(first 10 — use --all for all " + rest.length + ")")}`);
    for (const f of show) {
      console.log(`  ${yellow(f.file + ":" + f.line)}  ${dim(f.text.slice(0, 90))}`);
    }
    console.log("");
  }

  const unchecked = [...unique.keys()].filter((u) => !resolved[u] || resolved[u].state === null);
  if (unchecked.length > 0) {
    console.log(dim(`  ${unchecked.length} referenced issue(s) not checked (rate limit / network). Set GITHUB_TOKEN to check all.`));
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
