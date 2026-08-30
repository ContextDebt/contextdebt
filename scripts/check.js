#!/usr/bin/env node
/**
 * Fixture check: scans fixtures/ and compares the result against
 * fixtures/expected.json. Every reported line must be listed there with the
 * expiry date it should carry; anything else counts as a regression.
 *
 * Run: npm test
 */
"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
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
console.log(`fixture check passed — ${Object.keys(expected).length} lines matched across 4 languages`);
