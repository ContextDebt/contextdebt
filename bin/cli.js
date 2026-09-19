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

const VERSION = "0.1.12";
const LANG = new Map([
  [".js", "js"], [".jsx", "js"], [".ts", "js"], [".tsx", "js"], [".mjs", "js"], [".cjs", "js"],
  [".mts", "js"], [".cts", "js"],
  [".php", "php"], [".liquid", "liquid"], [".py", "py"], [".pyi", "py"]
]);
const EXT = new Set(LANG.keys());
const EXCLUDE_DIR = /^(node_modules|dist|build|out|vendor|coverage|\.git|\.next|\.turbo|\.cache|__tests__|__mocks__|test|tests|spec|e2e|fixtures|examples?|docs?|\.storybook|t|\.venv|venv|site-packages|__pycache__|\.tox|\.mypy_cache|\.ruff_cache)$/;
// `build`, `dist` and `out` are excluded at any depth, which is right for build
// output and wrong for the occasional hand-written source dir (CPython's Tools/build).
// We keep the exclusion — letting generated code in would cost precision — but report
// what was skipped, so the escape hatch (scan that path directly) is discoverable.
const OUTPUT_DIR = /^(dist|build|out)$/;
const EXCLUDE_FILE = /\.(test|spec|stories|d)\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$|\.min\.js$/;

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
    // the condition is right there in the words
    "(?:remove|delete)\\s+(?:once|when|after)\\b",
    // "remove this" is not enough on its own. "Remove this line not to show stack trace"
    // describes what the code does; "remove this when the parser lands" is a promise.
    // So it needs a tag in front of it or a condition behind it — nothing else counts.
    "\\b(?:TODO|FIXME|HACK|XXX)\\b[^.;]{0,24}?(?:remove|delete)\\s+this\\b",
    "(?:remove|delete)\\s+this\\b[^.;]{0,40}?\\b(?:when|once|after|if|unless|until)\\b",
    // 0.1.13, the active voice: a tag plus a bare "remove". This is the shape that made
    // drizzle-orm report 0 markers across 270k lines while grep found 17 of them —
    // "// TODO: remove", "// TODO: remove?", "// TODO: Seems not used. Remove."
    // The tag is the guard: "remove" alone is an ordinary English verb in UI copy.
    // ...but never "remove from": that phrase belongs to the release-target shape below,
    // which requires a version-like target, because "remove from the array" and
    // "remove from displays" are what the code does to a list.
    "\\b(?:TODO|FIXME|HACK|XXX)\\b.{0,40}?\\bremove\\b(?!\\s+from\\b)",
    // objects that carry the intent without needing a tag
    "\\bremove\\s+in\\s+(?:the\\s+)?future(?:\\s+versions?)?\\b",
    "\\bremove\\s+as\\s+part\\s+of\\b",
    "\\bremove\\s+and\\s+use\\b[^.;]{0,40}?\\binstead\\b",
    "\\bremove\\s+sometime\\b",
    "(?:can|should|will)\\s+be\\s+(?:removed|deleted)\\s+(?:when|once|after|in|by)",
    // "we can use structuredClone once we drop Node 16" — the clause after once/after
    // must name a party or a thing. Without that guard the shape swallows instructions
    // to the program ("delete the bucket once we flush") and plans nobody dated
    // ("will be replaced by Next.js").
    "\\bwe\\s+can\\s+(?:use|replace)\\b.{0,60}?\\b(?:once|after)\\s+(?:we|this|it|they)\\b",
    // "TODO: Remove the compat shim once the loader lands" — a tagged removal of a
    // named object. The tag is required and the verb must be exactly `remove`:
    // "Delete source files after uploading" is what the code does, not a confession.
    "\\b(?:TODO|FIXME|XXX)\\b.{0,24}?\\bremove\\b.{0,60}?\\b(?:once|after)\\b",
    // "Remove in v18." — a version target. The number must follow "in" directly, so
    // "will be removed in Python 3.17" (prose, and usually a docstring) stays out.
    "\\bremove\\s+in\\s+v?\\d+(?:\\.\\d+)*\\b",
    // "TODO(v11): remove," — the version rides inside the tag instead of the sentence.
    "\\b(?:TODO|FIXME|XXX)\\s*\\(\\s*v?\\d+(?:\\.\\d+)*\\s*\\)\\s*:?\\s*remove\\b",
    // "TODO: Remove from `core-js@4`" — a release the author named. The target must be
    // version-like: "remove from the array" and "remove from displays" are what the code
    // does to a list, and a tag alone would not tell them apart.
    "\\b(?:TODO|FIXME|XXX)\\b.{0,24}?\\bremove\\s+from\\s+[`\u0027\"]?(?:@?[\\w.-]+(?:\\/[\\w.-]+)?@)?v?\\d+(?:\\.\\d+){0,2}\\b"
  ].join("|"),
  "gi"
);
// Month names, shared by the address classifier and the deadline detector. Kept as
// one source so the two can never disagree about what a date looks like.
const MONTH_NAMES = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const MONTH_NUM = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

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

// Quoted ranges on a line: text wrapped in a matching pair of " or ` on that same
// line. A marker inside one is being cited, not confessed — linter rule docs, style
// guides, security checklists and this scanner's own source all discuss markers
// rather than admit to them. `'` is deliberately NOT a delimiter: apostrophes
// ("don't", "won't") are far more common in English comments than quoting is, and a
// lone one would swallow the rest of the line. An unmatched delimiter opens nothing.
function quotedSpans(line) {
  const spans = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"' || ch === "`") {
      // a run of three is a Python docstring delimiter, not an inline quote — pairing
      // it would swallow the whole docstring and undo v0.1.7
      let run = 1;
      while (line[i + run] === ch) run += 1;
      if (run >= 3) { i += run; continue; }
      const end = line.indexOf(ch, i + 1);
      if (end !== -1) {
        spans.push([i, end + 1]);
        i = end + 1;
        continue;
      }
    }
    i += 1;
  }
  return spans;
}

const inRange = (ranges, i) => ranges.some(([s, e]) => i >= s && i < e);

// The quoted ranges blanked out, so an address quoted as an example is not an address.
function stripQuoted(line) {
  const q = quotedSpans(line);
  if (q.length === 0) return line;
  let out = line;
  for (const [s, e] of q) out = out.slice(0, s) + " ".repeat(e - s) + out.slice(e);
  return out;
}

// An address is something a human can come back to. A keyword in front of a bare
// number is what separates a tracker reference from `#fff`, `#[Route(...)]` and
// "step #1": a missed address is a lead we pick up later, a false one is a false
// claim in someone's check run.
const ADDRESS_URL = /github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull)\/\d+/i;
const ADDRESS_REPO = /\b[\w.-]+\/[\w.-]+#\d{1,6}\b/;
const ADDRESS_SELF = /\b(?:issue|issues|bug|ticket|pr|gh)\s*#\s*\d{1,6}\b/i;
// Most organisations that pay for software do not track work in GitHub issues. novu
// leaves 14 marker lines pointing at Linear; under the GitHub-only rules every one of
// them counted as unaddressed, which says the authors left nothing to come back to when
// in fact they left an address we could not read.
const ADDRESS_LINEAR = /\blinear\.app\/[\w.-]+\/issue\/([A-Za-z]{2,6}-\d{1,6})/i;
const ADDRESS_JIRA = /\b[\w.-]+\.atlassian\.net\/browse\/([A-Za-z]{2,6}-\d{1,6})/i;
// A bare ticket key, uppercase only. Lowercase in prose is far too common to risk, and
// the standards below are not tickets — "workaround for UTF-16 handling" must not read
// as an address just because it has the shape of one.
const NOT_A_TICKET = /^(?:UTF|ISO|SHA|RFC|AES|RSA|MD|CVE|HTTP|HTML|CSS|ES|ECMA|IEEE|ANSI|PEP|JSR|UCS|ARM|IPV|SSE|AVX|X)$/;
const ADDRESS_TRACKER_KEY = /\b([A-Z]{2,6})-(\d{2,6})\b/;
const ADDRESS_DATE = new RegExp(
  [
    "\\b20\\d{2}-\\d{2}(?:-\\d{2})?\\b",
    "\\bin\\s+20\\d{2}\\b",
    "\\bQ[1-4]\\s+20\\d{2}\\b",
    `\\b(?:${MONTH_NAMES})\\.?,?\\s+(?:\\d{1,2}(?:st|nd|rd|th)?,?\\s+)?20\\d{2}\\b`,
    `\\b(?:${MONTH_NAMES})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`,
    `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTH_NAMES})\\b`
  ].join("|"),
  "i"
);

// The kind of address a marker carries, or null. Prose conditions ("when we drop
// 3.7") are deliberately not detected — fuzzy matching would cost precision.
//
// `line` is the marker's own line; `ctx` is the ±2-line window the issue lookup
// already treats as this marker's citation. A URL is read from the window, because
// the convention is to park it on the line under the marker. A date or a `#N` is read
// from the marker's own line only: on a neighbour it may well belong to a different
// comment, and inheriting it would invent an address that nobody wrote here.
function addressOf(line, ctx) {
  const wide = ctx === undefined ? line : ctx;
  // Only a GitHub URL keeps the wider window: parking the link on the line under the
  // marker is the published convention there. Everything else is read from the marker's
  // own line, the 0.1.10 rule — a Linear URL two lines away may belong to a different
  // comment, and borrowing it would put someone else's ticket number on this note.
  if (ADDRESS_URL.test(wide)) return "url";
  if (ADDRESS_LINEAR.test(line)) return "linear";
  if (ADDRESS_JIRA.test(line)) return "jira";
  if (ADDRESS_REPO.test(line)) return "repo";
  if (ADDRESS_SELF.test(line)) return "self";
  const key = ADDRESS_TRACKER_KEY.exec(line);
  if (key && !NOT_A_TICKET.test(key[1])) return "tracker_key";
  if (ADDRESS_DATE.test(line)) return "date";
  return null;
}

// Whether the oracle can ever ask about this address. A Linear or Jira key is an address
// a human comes back for; nothing we run can resolve it, and nothing may open an issue
// off it. Saying so is the point: addressed and resolvable are different claims.
const VERIFIABLE = new Set(["url", "repo", "self"]);
function addressVerifiable(kind) { return kind === null ? null : VERIFIABLE.has(kind); }

// Index of the first trustworthy marker match on a line, or -1.
function markerIndex(line, spans) {
  // computed on first use: most lines never reach a predicate at all
  let quoted = null;
  const unquoted = (i) => {
    if (quoted === null) quoted = quotedSpans(line);
    return !inRange(quoted, i);
  };
  const inAny = (i) => unquoted(i) && inRange(spans, i);
  const inStrong = (i) => unquoted(i) && spans.some(([s, e, weak]) => !weak && i >= s && i < e);
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

// A date is a DEADLINE only when all three hold: a removal intent sits in the same
// comment (the v0.1.5 rule, unchanged); the date is introduced by a deadline
// preposition or follows a removal verb directly; and it is not an authored-date
// shape. JS/TS produced zero ISO dates in three census rounds and the one date that
// existed was prose, which is why the shapes below matter more than the ISO one.
const DEADLINE_PREP = /\b(?:after|by|before|until|once|on)\s+(?:the\s+)?$/i;
const REMOVE_DIRECT = /\b(?:remov\w*|delet\w*|drop\w*|expir\w*)\b[^.;]{0,24}$/i;
// "Added Oct 2019 for the old parser" is where the note came from, not when it dies.
// These lines still carry an address; they never carry a verdict.
const AUTHORED_DATE = /\b(?:added|creat(?:ed|es)?|wrote|written|since|as\s+of|updated|introduced)\b[^.;]{0,24}$/i;
// A copyright header is a date nobody signed up to, and a year range is never a day.
const NOT_A_DATE_LINE = /\u00a9|\(c\)\s*20\d{2}|\bcopyright\b/i;
const YEAR_RANGE = /\b20\d{2}\s*[-\u2013\u2014]\s*20\d{2}\b/;

const pad2 = (n) => String(n).padStart(2, "0");
const lastDayOf = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const isoOf = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
const monthNum = (word) => MONTH_NUM[word.slice(0, 3).toLowerCase()];

// Ordered most specific first: at the same index the longer match wins, so
// "Oct 28, 2025" is never read as the year-less "Oct 28".
const DATE_SHAPES = [
  { format: "iso", re: /\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g,
    build: (m) => ({ y: +m[1], mo: +m[2], d: +m[3] }) },
  { format: "iso", re: /\b(20\d{2})-(0[1-9]|1[0-2])\b(?!-)/g,
    build: (m) => ({ y: +m[1], mo: +m[2], d: null }) },
  { format: "prose", re: /\bQ([1-4])\s+(20\d{2})\b/gi,
    build: (m) => ({ y: +m[2], mo: +m[1] * 3, d: null }) },
  { format: "prose", re: new RegExp(`\\b(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`, "gi"),
    build: (m) => ({ y: +m[3], mo: monthNum(m[1]), d: +m[2] }) },
  { format: "prose", re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_NAMES})\\.?,?\\s+(20\\d{2})\\b`, "gi"),
    build: (m) => ({ y: +m[3], mo: monthNum(m[2]), d: +m[1] }) },
  { format: "prose", re: new RegExp(`\\b(${MONTH_NAMES})\\.?,?\\s+(20\\d{2})\\b`, "gi"),
    build: (m) => ({ y: +m[2], mo: monthNum(m[1]), d: null }) },
  { format: "prose", re: new RegExp(`\\b(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "gi"),
    build: (m) => ({ y: null, mo: monthNum(m[1]), d: +m[2] }) },
  { format: "prose", re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_NAMES})\\b`, "gi"),
    build: (m) => ({ y: null, mo: monthNum(m[2]), d: +m[1] }) }
];

// Every date-shaped run on the line that is not inside a quoted span, longest first
// at a given index, with anything nested inside an earlier match dropped.
function dateCandidates(line) {
  if (NOT_A_DATE_LINE.test(line) || YEAR_RANGE.test(line)) return [];
  const quoted = quotedSpans(line);
  const found = [];
  for (const shape of DATE_SHAPES) {
    shape.re.lastIndex = 0;
    let m;
    while ((m = shape.re.exec(line)) !== null) {
      if (inRange(quoted, m.index)) continue;
      const parts = shape.build(m);
      if (!parts.mo) continue;
      found.push({ index: m.index, end: m.index + m[0].length, raw: m[0], format: shape.format, parts });
    }
  }
  found.sort((a, b) => a.index - b.index || (b.end - b.index) - (a.end - a.index));
  const kept = [];
  for (const c of found) if (!kept.some((k) => c.index >= k.index && c.end <= k.end)) kept.push(c);
  return kept;
}

const hasDate = (line) => line !== undefined && dateCandidates(line).length > 0;

// The deadline on `lines[i]`, or null. `opts.dateLine(file, lineNo)` is the optional
// history resolver: it returns { sha, date } for the commit that introduced a line,
// and it is the ONLY way a year-less date gets a year. With no resolver such a date
// is reported as unresolved — never guessed from the clock, never from the file mtime.
function expiryDate(lines, i, opts) {
  const line = lines[i];
  const candidates = dateCandidates(line);
  if (candidates.length === 0) return null;

  // rule 1 (v0.1.5, unchanged): a removal intent in the same comment
  let intent = DATE_INTENT.test(line);
  if (!intent) {
    for (const j of [i - 1, i + 1]) {
      const n = lines[j];
      if (n === undefined || hasDate(n)) continue; // a dated neighbour is claimed by its own date
      if (DATE_INTENT.test(n)) { intent = true; break; }
    }
  }
  if (!intent) return null;

  for (const c of candidates) {
    const before = line.slice(0, c.index);
    if (AUTHORED_DATE.test(before)) continue;                          // rule 3
    if (!DEADLINE_PREP.test(before) && !REMOVE_DIRECT.test(before)) continue; // rule 2
    const { y, mo, d } = c.parts;
    if (y !== null) {
      return { kind: "dated", raw: c.raw, parsed: isoOf(y, mo, d === null ? lastDayOf(y, mo) : d), format: c.format };
    }
    // year-less: the author left it off, so only history can say which year they meant
    const resolver = opts && opts.dateLine;
    if (!resolver) return { kind: "dated_unresolved", raw: c.raw, reason: "no history resolver" };
    let info = null;
    try { info = resolver(opts.file, i + 1); } catch { info = null; }
    if (!info || !info.date || !info.sha) {
      return { kind: "dated_unresolved", raw: c.raw, reason: "no history for this line" };
    }
    // the first year in which <month day> falls on or after the commit that wrote it
    let year = +info.date.slice(0, 4);
    const day = d === null ? lastDayOf(year, mo) : d;
    if (isoOf(year, mo, day) < info.date) year += 1;
    return {
      kind: "dated", raw: c.raw, format: c.format,
      parsed: isoOf(year, mo, d === null ? lastDayOf(year, mo) : d),
      year_basis: `commit ${info.sha} ${info.date}`
    };
  }
  return null;
}

// ---------- tiny ansi ----------
const tty = process.stdout.isTTY;
const c = (n) => (s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : String(s));
const red = c(31), yellow = c(33), dim = c(2), bold = c(1);
const redBold = (s) => c(1)(c(31)(s));

// ---------- walk & scan ----------
function scan(root, opts = {}) {
  const dateLine = opts.dateLine || null;
  const floorCache = new Map();
  const lockCache = new Map();
  const ownCache = new Map();
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
      const rel0 = path.relative(root, p);
      const provenance = vendoredProvenance(lang, lines, rel0);
      // One pass for the comment spans of every line, in order — the block state has to
      // carry, and a declaration needs to read the lines above it.
      const spansByLine = [];
      {
        let st = INITIAL_STATE[lang];
        for (let i = 0; i < lines.length; i++) {
          const cs = commentSpans(lang, lines[i], st);
          st = cs.state;
          spansByLine.push(cs.spans);
        }
      }
      const named = [];
      for (let i = 0; i < lines.length; i++) {
        const cs = { spans: spansByLine[i] };
        if (lines[i].length > 500) continue; // minified/bundled line — not a human comment
        if (markerIndex(lines[i], cs.spans) === -1) {
          // not a marker by its words — but the name may confess instead
          const name = confessingName(lines[i]);
          if (name && !isCommentOnly(lines[i], cs.spans)) {
            const span = reasonSpan(lines, spansByLine, i);
            if (span) named.push({ line: i, span, name });
          }
          continue;
        }
        if (/(cannot|can\x27t|don\x27t|do not|won\x27t|shouldn\x27t|must not|never)\s+(be\s+)?(remove|delete)/i.test(lines[i])) continue;
        const ctx = lines.slice(Math.max(0, i - 2), i + 2).join("\n");
        const issues = [...ctx.matchAll(ISSUE_URL)].map((m) => ({
          url: m[0], owner: m[1], repo: m[2], num: m[4]
        }));
        const trac = [...ctx.matchAll(TRAC_URL)].map((m) => m[0]);
        // same window as the issue lookup — a comment is the block, not one line —
        // but with quoted examples blanked out first
        const addrCtx = lines.slice(Math.max(0, i - 2), i + 2).map(stripQuoted).join("\n");
        const addrKind = addressOf(stripQuoted(lines[i]), addrCtx);
        const rel = path.relative(root, p);
        const date = expiryDate(lines, i, { file: rel, dateLine });
        // a "fixed in <pkg> <version>" claim the repository can settle by itself
        let floor = null;
        const claim = versionClaim(lines[i]);
        if (claim) {
          const found = manifestFloor(root, rel, claim.pkg, floorCache);
          const lock = lockfileVersion(root, claim.pkg, lockCache);
          floor = {
            kind: "version_floor", pkg: claim.pkg, fixed_in: claim.fixed_in,
            floor: found ? found.floor : null,
            source: found ? found.source : null,
            declared: found ? found.range : null,
            manifest: found ? found.manifest : null,
            status: !found ? "unresolved" : found.floor === null ? "unresolved"
              : cmpVer(found.floor, claim.fixed_in) >= 0 ? "expired" : "watching"
          };
          if (lock) floor.lockfile_version = lock;
        }
        // a release the note names, judged against the version this project calls itself
        let own = null;
        const target = ownVersionTarget(lines[i]);
        if (target) {
          const mine = ownVersion(root, rel, ownCache);
          own = {
            kind: "own_version", target: target.pkg ? `${target.pkg}@${target.target}` : `v${target.target}`,
            pkg: target.pkg, version: target.target,
            own_version: mine ? mine.version : null,
            manifest: mine ? mine.manifest : null,
            status: !mine ? "unresolved" : cmpVer(mine.version, target.target) >= 0 ? "expired" : "watching"
          };
        }
        // a version verdict inside somebody else's code is not a verdict about this project
        if (provenance) {
          for (const v of [floor, own]) {
            if (!v) continue;
            v.status = "unresolved";
            v.reason = `vendored_provenance:${provenance}`;
          }
        }
        findings.push({
          file: rel, line: i + 1,
          text: lines[i].trim().slice(0, 160), issues, trac,
          dated: date && date.kind === "dated" ? date.parsed : null, date, floor, own,
          address: addrKind, verifiable: addressVerifiable(addrKind)
        });
      }
      // Named workarounds, after the word-based pass, so a reason block that already
      // reported a marker of its own is not counted twice.
      const reported = new Set(findings.filter((f) => f.file === rel0).map((f) => f.line));
      for (const n of named) {
        let clash = false;
        for (let k = n.span.from; k <= n.span.to; k++) if (reported.has(k)) clash = true;
        if (clash) continue;
        const reason = lines.slice(n.span.from - 1, n.span.to);
        const reasonText = reason.join("\n");
        if (/(cannot|can\x27t|don\x27t|do not|won\x27t|shouldn\x27t|must not|never)\s+(be\s+)?(remove|delete)/i.test(reasonText)) continue;
        // the reason block is what gets read — the declaration line only names the finding
        let date = null;
        for (let k = n.span.from - 1; k < n.span.to && !date; k++) {
          date = expiryDate(lines, k, { file: rel0, dateLine });
        }
        let floor = null, own = null;
        for (const rl of reason) {
          if (!floor) {
            const claim = versionClaim(rl);
            if (claim) {
              const found = manifestFloor(root, rel0, claim.pkg, floorCache);
              const lock = lockfileVersion(root, claim.pkg, lockCache);
              floor = {
                kind: "version_floor", pkg: claim.pkg, fixed_in: claim.fixed_in,
                floor: found ? found.floor : null, source: found ? found.source : null,
                declared: found ? found.range : null, manifest: found ? found.manifest : null,
                status: !found || found.floor === null ? "unresolved"
                  : cmpVer(found.floor, claim.fixed_in) >= 0 ? "expired" : "watching"
              };
              if (lock) floor.lockfile_version = lock;
            }
          }
          if (!own) {
            const t = ownVersionTarget(rl);
            if (t) {
              const mine = ownVersion(root, rel0, ownCache);
              own = {
                kind: "own_version", target: t.pkg ? `${t.pkg}@${t.target}` : `v${t.target}`,
                pkg: t.pkg, version: t.target,
                own_version: mine ? mine.version : null, manifest: mine ? mine.manifest : null,
                status: !mine ? "unresolved" : cmpVer(mine.version, t.target) >= 0 ? "expired" : "watching"
              };
            }
          }
        }
        if (provenance) {
          for (const v of [floor, own]) {
            if (!v) continue;
            v.status = "unresolved";
            v.reason = `vendored_provenance:${provenance}`;
          }
        }
        const bare = reason.map(stripQuoted).join("\n");
        const namedAddr = addressOf(bare, bare);
        const issues = [...reasonText.matchAll(ISSUE_URL)].map((m) => ({
          url: m[0], owner: m[1], repo: m[2], num: m[4]
        }));
        findings.push({
          file: rel0, line: n.line + 1,
          text: lines[n.line].trim().slice(0, 160),
          named: n.name, reason_span: n.span,
          issues, trac: [...reasonText.matchAll(TRAC_URL)].map((m) => m[0]),
          dated: date && date.kind === "dated" ? date.parsed : null, date, floor, own,
          address: namedAddr, verifiable: addressVerifiable(namedAddr)
        });
      }
    }
  }
  if (process.stderr.isTTY) process.stderr.write("\r" + " ".repeat(60) + "\r");
  return { loc, files, findings, skipped };
}

// ---------- named workarounds ----------
// Our strongest rule is that a marker must sit in a comment. It is also what blinded us
// to the best note found in 1.34M lines: novu's `const esbuildDestructuringWorkaround`,
// whose comment block states the reason, the exact version that kills it, and an upstream
// issue — but contains no marker word at all. The confession was in the identifier.
//
// So a declaration whose NAME confesses counts too, and only then: the adjacent comment
// block is the reason, and without one there is nothing to read. `const hackyFix = {}`
// with no explanation is a style smell, not a self-admitted workaround, and `removeTodo`
// is a function doing its job.
const DECL_NAME = /\b(?:const|let|var|function|class|type|interface)\s+([A-Za-z_$][\w$]*)/;
const PROP_NAME = /^\s*([A-Za-z_$][\w$]*)\s*:\s*[{[(]/;
const CONFESSING_NAME = /(?:workaround|hack|hotfix|shim|polyfill|patch)$/i;
const CONFESSING_PREFIX = /^(?:workaround|hack|hotfix)/i;

function confessingName(line) {
  const m = DECL_NAME.exec(line) || PROP_NAME.exec(line);
  if (!m) return null;
  const name = m[1];
  return CONFESSING_NAME.test(name) || CONFESSING_PREFIX.test(name) ? name : null;
}

// A line holding nothing but a comment: blank it out and only the comment's own
// punctuation is left. Works the same in every language we read.
function isCommentOnly(line, spans) {
  if (!spans || spans.length === 0) return false;
  let out = line;
  for (const [a, b] of spans) out = out.slice(0, a) + " ".repeat(b - a) + out.slice(b);
  return out.replace(/[/*#\s-]/g, "") === "";
}

// The comment attached to a declaration: the run of comment-only lines directly above
// it, or a trailing comment on the line itself. 1-based, inclusive. Null when there is
// no comment, which is the guard that keeps this rule honest.
function reasonSpan(lines, spansByLine, i) {
  let top = i;
  while (top - 1 >= 0 && isCommentOnly(lines[top - 1], spansByLine[top - 1])) top -= 1;
  if (top < i) return { from: top + 1, to: i };
  if (spansByLine[i] && spansByLine[i].length > 0) return { from: i + 1, to: i + 1 };
  return null;
}

// ---------- provenance: whose code is this anyway ----------
// A version verdict only means something when the version it is compared against belongs
// to the same project. novu's bundled copy of json-schema-faker carries `// TODO: remove
// in v2` inside a vendored copy of the `yaml` package; matched against @novu/framework
// 2.13.2 it read as expired, and the "v2" meant yaml@2, which shipped in 2021. Both of
// the only two expired verdicts the CLI produced across 1.34M lines were that file.
//
// So: if a file shows provenance from somewhere else, a version verdict is unresolved.
// Not expired, not watching — we do not know whose version the note is talking about.
const VENDOR_PATH = /(^|\/)(vendor|vendored|third_party|thirdparty|external)(\/|$)|(^|\/)public\/js(\/|$)|(^|\/)\.yarn\/releases(\/|$)/i;
const COPIED_FROM = /(copied|vendored|inlined|bundled)\s+(the\s+)?(code\s+)?from/i;
const ARTIFACT_URL = /unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|registry\.npmjs\.org|\/releases\/download\//i;
const GENERATED_HEADER = /code\s+generated\s+by\b.*\bdo\s+not\s+edit/i;
const GENERATED_TAG = /@generated\b/;
const PROVENANCE_LINES = 20;

// The provenance signal a file carries, or null. Only the first 20 lines are read, and
// only inside comment spans: a file that merely mentions unpkg somewhere in its code is
// not vendored, and neither is one that builds a CDN URL at runtime.
function vendoredProvenance(lang, lines, file) {
  if (VENDOR_PATH.test(file)) return "vendored_path";
  let state = INITIAL_STATE[lang];
  const upto = Math.min(PROVENANCE_LINES, lines.length);
  for (let i = 0; i < upto; i++) {
    const cs = commentSpans(lang, lines[i], state);
    state = cs.state;
    if (cs.spans.length === 0) continue;
    const text = cs.spans.map(([a, b]) => lines[i].slice(a, b)).join(" ");
    if (COPIED_FROM.test(text)) return "copied_from";
    if (ARTIFACT_URL.test(text)) return "copied_from_url";
    if (GENERATED_HEADER.test(text) || GENERATED_TAG.test(text)) return "generated";
  }
  return null;
}

// ---------- tier 3: the dependency floor ----------
// "it was fixed in vite 5.1" is a claim the repository can settle by itself: if the
// project's own floor for vite is already above 5.1, the reason the comment cites is
// dead, and nothing had to leave the machine to prove it. The floor is what the project
// promises to support, so that is what the verdict stands on; a lockfile line is
// evidence printed beside it, never the verdict.
const FIXED_IN = /\b(?:(?:fixed|resolved|landed|shipped|released|available)\s+in|since)\s+(@[\w.-]+\/[\w.-]+|[a-z][\w.-]*)[\s@]+v?(\d+(?:\.\d+){0,2})\b/i;
const MANIFEST_FIELDS = ["peerDependencies", "dependencies", "devDependencies"];

const verParts = (v) => { const p = String(v).split(".").map(Number); while (p.length < 3) p.push(0); return p; };
// partial versions are padded, so "5.1" and "5.1.0" are the same floor
function cmpVer(a, b) {
  const x = verParts(a), y = verParts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

// The lowest version any alternative of a range admits. "^6.4.0 || ^7.0.0" is 6.4.0,
// ">=20.19.0" is 20.19.0, "~1.2.3" is 1.2.3. Anything we cannot read — "*", "latest",
// a workspace or git range, an upper bound — returns null and the claim stays
// unresolved. A guessed floor is a guessed verdict.
function rangeFloor(range) {
  if (typeof range !== "string") return null;
  const r = range.trim();
  if (!r || r === "*" || r === "latest" || r === "x") return null;
  if (/^(?:workspace|catalog|file|link|npm|git|https?|github):/i.test(r)) return null;
  let lowest = null;
  for (const alt of r.split("||")) {
    const a = alt.trim();
    if (a.startsWith("<")) return null; // an upper bound says nothing about the floor
    const m = a.match(/(\d+(?:\.\d+){0,2})/);
    if (!m) return null;
    if (lowest === null || cmpVer(m[1], lowest) < 0) lowest = m[1];
  }
  return lowest;
}

// The nearest package.json upward from the file, then the repo root. The first manifest
// that declares the package is the answer, even when its range is unreadable — a
// further-away declaration is not the one this file lives under.
function manifestFloor(root, file, pkg, cache) {
  const key = path.dirname(file) + "\u0000" + pkg;
  if (cache.has(key)) return cache.get(key);
  let out = null;
  let dir = path.dirname(path.join(root, file));
  const stop = path.resolve(root);
  for (;;) {
    let json = null;
    try { json = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")); } catch { json = null; }
    if (json) {
      const manifest = path.relative(root, path.join(dir, "package.json")) || "package.json";
      let hit = null;
      for (const field of MANIFEST_FIELDS) {
        if (json[field] && json[field][pkg] !== undefined) { hit = { field, range: json[field][pkg] }; break; }
      }
      if (!hit && pkg === "node" && json.engines && json.engines.node !== undefined) {
        hit = { field: "engines", range: json.engines.node };
      }
      if (hit) { out = { floor: rangeFloor(hit.range), source: hit.field, range: hit.range, manifest }; break; }
    }
    if (path.resolve(dir) === stop || dir === path.dirname(dir)) break;
    dir = path.dirname(dir);
  }
  cache.set(key, out);
  return out;
}

// Evidence, not verdict: whatever the lockfile actually resolved for this package.
function lockfileVersion(root, pkg, cache) {
  if (cache.has(pkg)) return cache.get(pkg);
  let found = null;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
    const e = j.packages && j.packages[`node_modules/${pkg}`];
    if (e && e.version) found = e.version;
    else if (j.dependencies && j.dependencies[pkg] && j.dependencies[pkg].version) found = j.dependencies[pkg].version;
  } catch { /* no npm lockfile here */ }
  if (!found) {
    try {
      const text = fs.readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8");
      const re = new RegExp(`^  '?${pkg.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}'?@(\\d[\\w.+-]*):`, "m");
      const m = text.match(re);
      if (m) found = m[1];
    } catch { /* no pnpm lockfile here */ }
  }
  cache.set(pkg, found);
  return found;
}

// The version claim on a marker line, if it makes one.
function versionClaim(line) {
  const m = FIXED_IN.exec(stripQuoted(line));
  return m ? { pkg: m[1], fixed_in: m[2] } : null;
}

// ---------- tier 4: the project's own version ----------
// "Remove from `core-js@4`" is a deadline written in releases instead of days. The
// repository can settle it alone: if the project is already at or past the release the
// note names, the reason it cites is dead. The target must be version-like — a tag in
// front of "remove from the displays array" is still a list operation.
const OWN_VERSION_SHAPES = [
  /\b(?:TODO|FIXME|XXX)\b.{0,24}?\bremove\s+from\s+[`\u0027"]?(?:(@?[\w.-]+(?:\/[\w.-]+)?)@)?v?(\d+(?:\.\d+){0,2})\b/i,
  /\bremove\s+in\s+[`\u0027"]?(?:(@?[\w.-]+(?:\/[\w.-]+)?)@)?v?(\d+(?:\.\d+){0,2})\b/i,
  /\b(?:TODO|FIXME|XXX)\s*\(\s*(?:(@?[\w.-]+(?:\/[\w.-]+)?)@)?v?(\d+(?:\.\d+){0,2})\s*\)\s*:?\s*remove\b/i
];

// The release a marker names, or null. Read from the raw line — core-js writes its
// target inside backticks — but rejected when the phrase itself sits inside a quoted
// span, which is the 0.1.9 rule doing its job on a cited example.
function ownVersionTarget(line) {
  const quoted = quotedSpans(line);
  for (const re of OWN_VERSION_SHAPES) {
    const m = re.exec(line);
    if (!m) continue;
    if (inRange(quoted, m.index)) continue;
    return { pkg: m[1] || null, target: m[2], raw: m[0].trim() };
  }
  return null;
}

// The version this project calls itself, from the nearest package.json upward.
function ownVersion(root, file, cache) {
  const key = path.dirname(file);
  if (cache.has(key)) return cache.get(key);
  let out = null;
  let dir = path.dirname(path.join(root, file));
  const stop = path.resolve(root);
  for (;;) {
    try {
      const json = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      if (typeof json.version === "string" && /^\d/.test(json.version)) {
        out = {
          version: json.version, name: json.name || null,
          manifest: path.relative(root, path.join(dir, "package.json")) || "package.json"
        };
        break;
      }
    } catch { /* keep walking up */ }
    if (path.resolve(dir) === stop || dir === path.dirname(dir)) break;
    dir = path.dirname(dir);
  }
  cache.set(key, out);
  return out;
}

// ---------- history resolver (CLI side of the dateLine interface) ----------
// A year-less deadline ("Remove after Aug 24") only means something next to the date
// it was written on, so we ask git which commit introduced that exact line. A shallow
// clone is refused on purpose: a boundary commit's date is not the line's date, and a
// wrong year here would invent a deadline nobody set.
function gitDateLine(root) {
  const { execFileSync } = require("node:child_process");
  const git = (args) => execFileSync("git", args, {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000
  }).trim();
  try {
    if (git(["rev-parse", "--is-inside-work-tree"]) !== "true") return null;
    if (git(["rev-parse", "--is-shallow-repository"]) === "true") return null;
  } catch { return null; }
  return (file, lineNo) => {
    let text;
    try {
      text = fs.readFileSync(path.join(root, file), "utf8").split("\n")[lineNo - 1];
    } catch { return null; }
    if (!text || !text.trim()) return null;
    try {
      const out = git(["log", "-S" + text.trim(), "--format=%H%x09%cs", "--reverse", "--", file]);
      if (!out) return null;
      const [sha, date] = out.split("\n")[0].split("\t");
      return sha && date ? { sha, date } : null;
    } catch { return null; }
  };
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
            resolve({
              state: d.state, closed_at: d.closed_at, state_reason: d.state_reason, title: d.title,
              is_pr: !!d.pull_request,
              merged_at: d.pull_request && d.pull_request.merged_at
            });
          } catch { resolve({ state: null, note: "parse error" }); }
        });
      }
    );
    req.on("error", () => resolve({ state: null, note: "network error" }));
    req.on("timeout", () => { req.destroy(); resolve({ state: null, note: "timeout" }); });
  });
}

// Closed is not fixed. An issue closed as "not_planned" was refused — the workaround
// that cites it is permanent, not expired. A pull request closed without a merge
// shipped nothing. The issues endpoint returns state "closed" for both, and carries
// `pull_request.merged_at` for PRs, so this needs no extra request.
function reasonResolved(r) {
  if (!r) return false;
  if (r.is_pr) return !!r.merged_at;
  return r.state === "closed" && r.state_reason !== "not_planned";
}

// A reference that is closed but settled nothing — the opposite of an expired reason.
function closedWithoutFix(r) {
  return !!r && r.state === "closed" && !reasonResolved(r);
}

// ---------- main ----------
async function main() {
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
  const { loc, files, findings, skipped } = scan(root, { dateLine: gitDateLine(root) });

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

  // How much of the oracle actually answered. A reference we could not reach tells us
  // nothing, so "0 expired" and "we could not check" must not print as the same number:
  // when nothing resolved, the expired counts are unknown, and unknown is null.
  const referenced = unique.size;
  const uncheckedUrls = [...unique.keys()].filter((u) => !resolved[u] || resolved[u].state === null);
  const issuesResolved = referenced - uncheckedUrls.length;
  const oracleStatus =
    referenced === 0 ? "no_references"
      : issuesResolved === 0 ? "unavailable"
        : uncheckedUrls.length === 0 ? "complete" : "partial";
  const oracleNote = {
    no_references: "No issue reference found in these markers — nothing for the oracle to check.",
    unavailable: `None of the ${referenced} referenced issue(s) could be checked (rate limit or network). The expired-reason counts are unknown here, not zero.`,
    partial: `${issuesResolved} of ${referenced} referenced issue(s) checked; ${uncheckedUrls.length} could not be reached (rate limit or network).`,
    complete: `All ${referenced} referenced issue(s) checked.`
  }[oracleStatus];

  const expired = findings.filter((f) => f.issues.some((i) => reasonResolved(resolved[i.url])));
  const closedUnfixed = findings.filter(
    (f) => !expired.includes(f) && f.issues.some((i) => closedWithoutFix(resolved[i.url]))
  );
  const investigable = findings.filter((f) => f.address !== null);
  const unaddressed = findings.filter((f) => f.address === null);
  const todayISO = new Date().toISOString().slice(0, 10);
  const datedExpired = findings.filter((f) => f.dated && f.dated < todayISO && !expired.includes(f));
  const datedUpcoming = findings.filter((f) => f.dated && f.dated >= todayISO);
  const datedUnresolved = findings.filter((f) => f.date && f.date.kind === "dated_unresolved");
  const floorExpired = findings.filter((f) => f.floor && f.floor.status === "expired");
  const floorWatching = findings.filter((f) => f.floor && f.floor.status === "watching");
  const floorUnresolved = findings.filter((f) => f.floor && f.floor.status === "unresolved");
  const ownExpired = findings.filter((f) => f.own && f.own.status === "expired");
  const ownWatching = findings.filter((f) => f.own && f.own.status === "watching");
  const ownUnresolved = findings.filter((f) => f.own && f.own.status === "unresolved");
  const days = (a, b) => Math.floor((Date.parse(a) - Date.parse(b)) / 86400000);
  for (const f of datedExpired) f.date.days_overdue = days(todayISO, f.dated);
  for (const f of datedUpcoming) f.date.days_until = days(f.dated, todayISO);
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
      issues_resolved: issuesResolved, issues_unchecked: uncheckedUrls.length,
      oracle_status: oracleStatus, oracle_note: oracleNote,
      // 0.1.11's contract stands: null still means "we could not check". A floor verdict
      // needs no network, so once one exists the count is knowable and stops being null.
      expired_reasons: issuesResolved === 0 && floorExpired.length === 0
        ? null : (issuesResolved === 0 ? 0 : expired.length) + floorExpired.length,
      expired_by_issue: issuesResolved === 0 ? null : expired.length,
      expired_by_version_floor: floorExpired.length,
      version_floor_watching: floorWatching.length,
      version_floor_unresolved: floorUnresolved.length,
      expired_by_own_version: ownExpired.length,
      own_version_watching: ownWatching.length,
      own_version_unresolved: ownUnresolved.length,
      closed_unfixed: issuesResolved === 0 ? null : closedUnfixed.length,
      expired_by_own_date: datedExpired.length, dated_upcoming: datedUpcoming.length,
      dated_unresolved: datedUnresolved.length,
      trac_tickets_referenced: tracRefs.length, skipped_dirs: skipped,
      notes: { investigable: investigable.length, unaddressed: unaddressed.length },
      findings, issues: resolved }, null, 2));
    return;
  }

  console.log(`  ${bold(String(files).padStart(7))}  files scanned ${dim("(" + secs + "s)")}`);
  console.log(`  ${bold(loc.toLocaleString().padStart(7))}  lines of code`);
  console.log(`  ${bold(String(findings.length).padStart(7))}  self-admitted workarounds ${dim("(" + density.toFixed(2) + " per 10k LOC)")}`);
  if (expired.length > 0) {
    console.log(`  ${redBold(String(expired.length).padStart(7))}  ${redBold("with EXPIRED reasons")} ${dim("— the issue they cite was closed as fixed")}`);
  }
  if (closedUnfixed.length > 0) {
    console.log(`  ${bold(String(closedUnfixed.length).padStart(7))}  cite an issue closed without a fix`);
    console.log(dim("           (not planned, or a pull request nobody merged) — these are not"));
    console.log(dim("           expired; if anything they are permanent"));
  }
  if (datedExpired.length > 0) {
    console.log(`  ${redBold(String(datedExpired.length).padStart(7))}  ${redBold("past their own written expiry date")}`);
  }
  if (oracleStatus === "unavailable") {
    console.log(`  ${bold("      ?")}  ${bold("expired reasons: unknown, not zero")}`);
    console.log(dim(`           none of the ${referenced} referenced issue(s) could be checked (rate limit`));
    console.log(dim("           or network). Set GITHUB_TOKEN and re-run to get an answer."));
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

  if (ownExpired.length > 0) {
    console.log(`  ${redBold("EXPIRED BY THE RELEASE THEY NAMED")} ${dim("— this project is already at or past it:")}`);
    for (const f of ownExpired) {
      console.log("");
      console.log(`  ${yellow(f.file + ":" + f.line)}`);
      console.log(`    ${dim(f.text)}`);
      console.log(`    ${red("\u21b3 names " + f.own.target + "; this project is at " + f.own.own_version + " (" + f.own.manifest + ")")}`);
    }
    console.log("");
  }

  if (floorExpired.length > 0) {
    console.log(`  ${redBold("EXPIRED BY THE PROJECT'S OWN FLOOR")} ${dim("— the fix is already in the lowest version this repo supports:")}`);
    for (const f of floorExpired) {
      const v = f.floor;
      console.log("");
      console.log(`  ${yellow(f.file + ":" + f.line)}`);
      console.log(`    ${dim(f.text)}`);
      console.log(`    ${red("\u21b3 " + v.pkg + " " + v.fixed_in + " \u2264 floor " + v.floor + " (" + v.source + " " + v.declared + " in " + v.manifest + ")")}`);
      if (v.lockfile_version) console.log(`    ${dim("\u21b3 lockfile resolves " + v.pkg + " " + v.lockfile_version)}`);
    }
    console.log("");
  }

  if (expired.length > 0) {
    console.log(`  ${redBold("EXPIRED REASONS")} ${dim("— your own comments cite these; they're done:")}`);
    for (const f of expired) {
      const i = f.issues.find((x) => reasonResolved(resolved[x.url]));
      const r = resolved[i.url];
      const when = r.closed_at ? r.closed_at.slice(0, 10) : "?";
      console.log("");
      console.log(`  ${yellow(f.file + ":" + f.line)}`);
      console.log(`    ${dim(f.text)}`);
      console.log(`    ${red("↳ " + i.url + " — closed " + when + (r.state_reason ? " (" + r.state_reason + ")" : ""))}`);
    }
    console.log("");
  }

  if (closedUnfixed.length > 0) {
    console.log(`  ${bold("CLOSED WITHOUT A FIX")} ${dim("— cited, closed, and settled nothing:")}`);
    for (const f of closedUnfixed) {
      const i = f.issues.find((x) => closedWithoutFix(resolved[x.url]));
      const r = resolved[i.url];
      const when = r.closed_at ? r.closed_at.slice(0, 10) : "?";
      const why = r.is_pr ? "PR not merged" : r.state_reason || "no reason given";
      console.log("");
      console.log(`  ${yellow(f.file + ":" + f.line)}`);
      console.log(`    ${dim(f.text)}`);
      console.log(`    ${dim("↳ " + i.url + " — closed " + when + " (" + why + ")")}`);
    }
    console.log("");
  }

  const rest = findings.filter(
    (f) => !expired.includes(f) && !datedExpired.includes(f) && !closedUnfixed.includes(f)
      && !floorExpired.includes(f) && !ownExpired.includes(f)
  );
  if (rest.length > 0) {
    const show = showAll ? rest : rest.slice(0, 10);
    const skipped = findings.length - rest.length;
    const restNote = "(showing " + Math.min(10, rest.length) + " of " + rest.length + (skipped > 0 ? " — " + skipped + " listed above" : "") + " — use --all)";
    console.log(`  ${bold("SELF-ADMITTED WORKAROUNDS")} ${dim(showAll ? "" : restNote)}`);
    for (const f of show) {
      console.log(`  ${yellow(f.file + ":" + f.line)}  ${dim(f.text.slice(0, 90))}`);
    }
    console.log("");
  }

  if (uncheckedUrls.length > 0) {
    console.log(dim(`  ${uncheckedUrls.length} referenced issue(s) not checked (rate limit / network). Set GITHUB_TOKEN to check all.`));
  }
  if (skipped.length > 0) {
    const shown = skipped.slice(0, 3).join(", ");
    console.log(dim(`  ${skipped.length} build-output director${skipped.length === 1 ? "y" : "ies"} skipped (${shown}${skipped.length > 3 ? ", …" : ""}).`));
    console.log(dim("  If one of those holds hand-written source, scan that path directly."));
  }
  if (datedUpcoming.length > 0) {
    console.log(dim(`  ${datedUpcoming.length} dated TODO(s) not due yet — watcher material.`));
  }
  if (ownWatching.length > 0) {
    const n = ownWatching.length;
    console.log(dim(`  ${n} note${n === 1 ? "" : "s"} name${n === 1 ? "s" : ""} a release this project has not reached yet — watcher material.`));
  }
  if (floorWatching.length > 0) {
    const n = floorWatching.length;
    console.log(dim(`  ${n} note${n === 1 ? " names" : "s name"} a fix in a version above this repo's floor — watcher material,`));
    for (const f of floorWatching.slice(0, 3)) {
      console.log(dim(`    ${f.file}:${f.line} — ${f.floor.pkg} ${f.floor.fixed_in} > floor ${f.floor.floor}`));
    }
  }
  if (floorUnresolved.length > 0) {
    const n = floorUnresolved.length;
    console.log(dim(`  ${n} version claim(s) could not be settled: the package is not in any manifest above the`));
    console.log(dim("  file, or its range is one we refuse to read (workspace, git, \"*\"). Unresolved, not clean."));
  }
  if (datedUnresolved.length > 0) {
    const n = datedUnresolved.length;
    console.log(dim(`  ${n} note${n === 1 ? " names" : "s name"} a deadline without a year, and there is no history to date`));
    console.log(dim(`  ${n === 1 ? "it" : "them"}. Scan a full clone (not a shallow one) and the year comes from the commit.`));
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

  // notes — which of the markers above left an address anyone can come back for
  if (findings.length > 0) {
    const n = findings.length;
    const carried = investigable.length;
    const left = unaddressed.length;
    const second = left === 0
      ? "every note here left an address. that is rarer than it sounds."
      : `the other ${left} ${left === 1 ? "is" : "are"} honest, correct, and stuck.`;
    console.log(`  ${bold("notes")}`);
    console.log(dim(`    ${n} marker${n === 1 ? "" : "s"} ${n === 1 ? "is a" : "are"} self-admitted workaround${n === 1 ? "" : "s"}; ${carried} carr${carried === 1 ? "ies" : "y"} an address (issue link or date)`));
    console.log(dim(`    someone can come back for. ${second}`));
    console.log(dim("    census baseline: ~1 in 20. writing the returnable kind: contextdebt.dev/notes"));
    console.log("");
  }
}

if (require.main === module) main();

module.exports = { reasonResolved, addressOf, expiryDate, scan, gitDateLine };
