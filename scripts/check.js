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
const path = require("node:path");

const root = path.join(__dirname, "..");
const { reasonResolved, addressOf } = require(path.join(root, "bin", "cli.js"));

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
const expected = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "expected.json"), "utf8")).expected;

const out = execFileSync(process.execPath, [path.join(root, "bin", "cli.js"), path.join(root, "fixtures"), "--json"], {
  encoding: "utf8", env: { ...process.env, GITHUB_TOKEN: "" }
});
const report = JSON.parse(out);
const actual = {};
const actualAddresses = {};
for (const f of report.findings) {
  actual[`${f.file}:${f.line}`] = f.dated;
  actualAddresses[`${f.file}:${f.line}`] = f.address;
}

const expectedAddresses = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "expected.json"), "utf8")).addresses;
const problems = [];

// the notes block is presentational: the two buckets must account for every marker
const { investigable, unaddressed } = report.notes;
if (investigable + unaddressed !== report.markers) {
  problems.push(`  notes     ${investigable} + ${unaddressed} != ${report.markers} markers — buckets do not reconcile`);
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

if (problems.length) {
  console.error(`fixture check FAILED (${problems.length} problem(s)):`);
  console.error(problems.sort().join("\n"));
  process.exit(1);
}
console.log(
  `fixture check passed — ${RESOLUTION_TABLE.length} resolution rows, ${ADDRESS_TABLE.length} address rows, ` +
  `${Object.keys(expected).length} lines, ${investigable} with an address`
);
