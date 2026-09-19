#!/usr/bin/env node
/**
 * Fixture check, three parts:
 *   1. reasonResolved() against a fixed table — no network, no fixtures.
 *   2. addressOf() against a fixed table — no network, no fixtures. The URL case
 *      lives here rather than in a fixture: a github.com URL in fixtures/ would make
 *      the scan reach for the API on every test run.
 *   3. scans fixtures/ and compares the result against fixtures/expected.json.
 *      Every reported line must be listed there with the expiry date it should
 *      carry; anything else counts as a regression.
 *
 * Run: npm test
 */
"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..");
const { reasonResolved, addressOf, scan } = require(path.join(root, "bin", "cli.js"));

// closed !== fixed. Each row is [label, reference as fetchIssue resolves it, expected].
const RESOLUTION_TABLE = [
  ["issue closed as completed", { state: "closed", state_reason: "completed" }, true],
  ["issue closed as not_planned", { state: "closed", state_reason: "not_planned" }, false],
  ["issue still open", { state: "open", state_reason: null }, false],
  ["pull request merged", { state: "closed", is_pr: true, merged_at: "2026-02-11T09:00:00Z" }, true],
  ["pull request closed unmerged", { state: "closed", is_pr: true, merged_at: null }, false],
  ["reference never resolved", null, false],
];

// An address is what someone can come back for. Each row is [label, line, expected kind].
const ADDRESS_TABLE = [
  ["full github issue url", "// workaround, see https://github.com/o/r/issues/12", "url"],
  ["full github pull url", "// hack until https://github.com/o/r/pull/3 lands", "url"],
  ["owner/repo#N", "// workaround, tracked in owner/repo#123", "repo"],
  ["keyword Issue #N", "// quick hack for Issue #436", "self"],
  ["keyword gh #N", "// hacky shim for gh #77", "self"],
  ["keyword pr # N spaced", "// kludge until pr # 8 merges", "self"],
  ["iso date", "// temporary fix until 2027-01-01", "date"],
  ["year-month", "// kludge, revisit 2027-01", "date"],
  ["in YYYY", "// hotfix added in 2019 for the old parser", "date"],
  ["no address", "// HACK: don't touch", null],
  ["hex colour is not an issue", "// hack: the placeholder colour is #fff", null],
  ["php attribute is not an issue", "// workaround for the #[Route(...)] attribute shape", null],
  ["bare number in prose is not an issue", "// kludge - see step #1 in the runbook", null],
  ["bare #N with no keyword", "// workaround, see #436 for the details", null],
];

const tableProblems = [];
for (const [label, ref, want] of RESOLUTION_TABLE) {
  const got = reasonResolved(ref);
  if (got !== want) tableProblems.push(`  reasonResolved  ${label}  — expected ${want}, got ${got}`);
}
for (const [label, line, want] of ADDRESS_TABLE) {
  const got = addressOf(line, line);
  if (got !== want) tableProblems.push(`  addressOf       ${label}  — expected ${want}, got ${got}`);
}
if (tableProblems.length) {
  console.error(`resolution table FAILED (${tableProblems.length} problem(s)):`);
  console.error(tableProblems.join("\n"));
  process.exit(1);
}
const spec = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "expected.json"), "utf8"));
const expected = spec.expected;
const expectedAddresses = spec.addresses;
const problems = [];

// ---- run 1: the CLI, with no history to read ----
// The copy lives outside any git checkout on purpose. fixtures/ sits inside this
// repository, so the real resolver would date a year-less deadline from our own commit
// and the pinned answer would change the moment the fixture is committed. Outside a
// checkout the resolver returns null, which is exactly the "no resolver" half of the
// 0.1.12 contract.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "contextdebt-fixtures-"));
fs.cpSync(path.join(root, "fixtures"), tmp, { recursive: true });
let report;
try {
  report = JSON.parse(execFileSync(process.execPath, [path.join(root, "bin", "cli.js"), tmp, "--json"], {
    encoding: "utf8", env: { ...process.env, GITHUB_TOKEN: "" }
  }));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const actual = {};
const actualAddresses = {};
for (const f of report.findings) {
  actual[`${f.file}:${f.line}`] = f.dated;
  actualAddresses[`${f.file}:${f.line}`] = f.address;
}

// the notes block is presentational: the two buckets must account for every marker
const { investigable, unaddressed } = report.notes;
if (investigable + unaddressed !== report.markers) {
  problems.push(`  notes     ${investigable} + ${unaddressed} != ${report.markers} markers — buckets do not reconcile`);
}
// a generated file is skipped whole, and a deprecation notice is counted apart from a
// workaround: both are claims about what we did NOT report, so both are pinned
if (report.skipped_generated !== spec.skipped_generated) {
  problems.push(`  generated   expected ${spec.skipped_generated} generated file(s) skipped, got ${report.skipped_generated}`);
}
if (report.deprecation_notices !== spec.deprecation_notices) {
  problems.push(`  deprecated  expected ${spec.deprecation_notices} deprecation notice(s), got ${report.deprecation_notices}`);
}
if (report.dated_unresolved !== spec.dated_unresolved_without_resolver) {
  problems.push(`  unresolved  expected ${spec.dated_unresolved_without_resolver} year-less deadline(s) with no resolver, got ${report.dated_unresolved}`);
}

for (const key of Object.keys(expectedAddresses)) {
  if (!(key in actualAddresses)) continue; // a missing line is reported below
  if (actualAddresses[key] !== expectedAddresses[key]) {
    problems.push(`  address   ${key}  — expected ${expectedAddresses[key]}, got ${actualAddresses[key]}`);
  }
}
for (const key of Object.keys(expected)) {
  if (!(key in actual)) problems.push(`  missing   ${key}  — expected a report here, got none`);
  else if (actual[key] !== expected[key]) problems.push(`  date      ${key}  — expected ${expected[key]}, got ${actual[key]}`);
}
for (const key of Object.keys(actual)) {
  if (!(key in expected)) problems.push(`  unwanted  ${key}  — reported, but not listed in expected.json`);
}

// addressed and resolvable are two claims, and 0.1.13 separates them: a Linear or Jira
// key is an address a human comes back for that no oracle of ours can ask about. The rule
// is checked rather than pinned per line, so a new address kind has to declare which it is.
const RESOLVABLE = new Set(["url", "repo", "self"]);
for (const f of report.findings) {
  const want = f.address === null ? null : RESOLVABLE.has(f.address);
  if (f.verifiable !== want) {
    problems.push(`  verifiable ${f.file}:${f.line}  — address ${f.address} should be verifiable=${want}, got ${f.verifiable}`);
  }
}

// a floor verdict is the one thing in this release that needs no network at all, so it
// is pinned per line: expired, watching, or unresolved — never a silent absence
const actualFloor = {};
for (const f of report.findings) if (f.floor) actualFloor[`${f.file}:${f.line}`] = f.floor.status;
for (const key of Object.keys(spec.expected_floor)) {
  if (!(key in actualFloor)) problems.push(`  floor     ${key}  — expected a version claim here, got none`);
  else if (actualFloor[key] !== spec.expected_floor[key]) {
    problems.push(`  floor     ${key}  — expected ${spec.expected_floor[key]}, got ${actualFloor[key]}`);
  }
}
for (const key of Object.keys(actualFloor)) {
  if (!(key in spec.expected_floor)) problems.push(`  floor+    ${key}  — a version claim not listed in expected_floor`);
}

// the release-target verdict, pinned the same way: a list operation must never appear
// here at all, and a marker under no manifest must stay unresolved rather than clean
const actualOwn = {};
for (const f of report.findings) if (f.own) actualOwn[`${f.file}:${f.line}`] = f.own.status;
for (const key of Object.keys(spec.expected_own_version)) {
  if (!(key in actualOwn)) problems.push(`  own       ${key}  — expected a release target here, got none`);
  else if (actualOwn[key] !== spec.expected_own_version[key]) {
    problems.push(`  own       ${key}  — expected ${spec.expected_own_version[key]}, got ${actualOwn[key]}`);
  }
}
for (const key of Object.keys(actualOwn)) {
  if (!(key in spec.expected_own_version)) problems.push(`  own+      ${key}  — a release target not listed in expected_own_version`);
}

// ---- run 2: the same fixtures through a fake history resolver ----
// A year-less deadline means nothing without the date it was written on. The table
// below stands in for `git log -S`; the CLI and the App must both turn it into the
// same year, so the outcome is pinned separately from run 1.
const FAKE_HISTORY = spec.fake_history;
const withResolver = scan(path.join(root, "fixtures"), {
  dateLine: (file, lineNo) => FAKE_HISTORY[`${file}:${lineNo}`] || null
});
const resolvedExpected = { ...expected, ...spec.expected_with_resolver };
const resolvedActual = {};
for (const f of withResolver.findings) resolvedActual[`${f.file}:${f.line}`] = f.dated;
for (const key of Object.keys(resolvedExpected)) {
  if (!(key in resolvedActual)) problems.push(`  missing*  ${key}  — expected a report here with the resolver, got none`);
  else if (resolvedActual[key] !== resolvedExpected[key]) {
    problems.push(`  date*     ${key}  — with resolver expected ${resolvedExpected[key]}, got ${resolvedActual[key]}`);
  }
}
for (const key of Object.keys(resolvedActual)) {
  if (!(key in resolvedExpected)) problems.push(`  unwanted* ${key}  — reported with the resolver, but not listed`);
}
// the year a resolver produces must name the commit it came from, or it is a guess
for (const key of Object.keys(spec.expected_with_resolver)) {
  const f = withResolver.findings.find((x) => `${x.file}:${x.line}` === key);
  if (f && f.date && !f.date.year_basis) {
    problems.push(`  basis*    ${key}  — resolved a year-less date without naming the commit`);
  }
}

if (problems.length) {
  console.error(`fixture check FAILED (${problems.length} problem(s)):`);
  console.error(problems.sort().join("\n"));
  process.exit(1);
}
console.log(
  `fixture check passed — ${RESOLUTION_TABLE.length} resolution rows, ${ADDRESS_TABLE.length} address rows, ` +
  `${Object.keys(expected).length} lines, ${investigable} with an address, ` +
  `${report.dated_unresolved} unresolved without history / ${Object.keys(spec.expected_with_resolver).length} resolved with it, ` +
  `${Object.keys(spec.expected_floor).length} floor verdicts, ${Object.keys(spec.expected_own_version).length} release targets, ` +
  `${report.deprecation_notices} deprecations, ${report.skipped_generated} generated skipped`
);
