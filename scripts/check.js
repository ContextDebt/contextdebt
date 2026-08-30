#!/usr/bin/env node
/**
 * Fixture check, two parts:
 *   1. reasonResolved() against a fixed table — no network, no fixtures.
 *   2. scans fixtures/ and compares the result against fixtures/expected.json.
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
const { reasonResolved } = require(path.join(root, "bin", "cli.js"));

// closed !== fixed. Each row is [label, reference as fetchIssue resolves it, expected].
const RESOLUTION_TABLE = [
  ["issue closed as completed", { state: "closed", state_reason: "completed" }, true],
  ["issue closed as not_planned", { state: "closed", state_reason: "not_planned" }, false],
  ["issue still open", { state: "open", state_reason: null }, false],
  ["pull request merged", { state: "closed", is_pr: true, merged_at: "2026-02-11T09:00:00Z" }, true],
  ["pull request closed unmerged", { state: "closed", is_pr: true, merged_at: null }, false],
  ["reference never resolved", null, false],
];

const tableProblems = [];
for (const [label, ref, want] of RESOLUTION_TABLE) {
  const got = reasonResolved(ref);
  if (got !== want) tableProblems.push(`  reasonResolved  ${label}  — expected ${want}, got ${got}`);
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
const actual = {};
for (const f of JSON.parse(out).findings) actual[`${f.file}:${f.line}`] = f.dated;

const problems = [];
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
console.log(`fixture check passed — ${RESOLUTION_TABLE.length} resolution rows, ${Object.keys(expected).length} lines across 4 languages`);
