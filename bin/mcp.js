/**
 * ContextDebt MCP server — the same scanner, exposed to AI coding agents
 * (Claude Code, Cursor, Windsurf, any MCP client) over stdio.
 *
 *   npx -y contextdebt mcp
 *
 * Two tools:
 *   scan_workarounds  — every self-admitted workaround in a directory, with the ones
 *                       whose stated reason has expired listed first, plus the evidence.
 *   check_reason      — one GitHub issue or PR reference: is the reason it stands for
 *                       resolved, closed without a fix, or still open? Closed is not fixed.
 *
 * Same rules as the CLI: runs locally, the only network calls are GitHub status lookups
 * for references your own comments make, and it never says "safe to delete" — an expired
 * reason is evidence for a human (or an agent) to weigh, not a verdict.
 *
 * Protocol: JSON-RPC 2.0, one message per line on stdin/stdout. Nothing but protocol
 * messages may ever be written to stdout; diagnostics go to stderr.
 */
"use strict";

const path = require("node:path");
const { execFile } = require("node:child_process");

const CLI = path.join(__dirname, "cli.js");
const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LIST_CAP = 100;

const NOT_A_VERDICT =
  "An expired reason is evidence, not a verdict: it means the condition the comment " +
  "names has changed. Whether the code can go is a separate question — check tests and " +
  "callers, and leave the decision to a human. Never describe these as safe to delete.";

const TOOLS = [
  {
    name: "scan_workarounds",
    title: "Find workarounds whose stated reason expired",
    description:
      "Scan a directory (JS/TS/PHP/Python/Liquid) for self-admitted workarounds in comments " +
      "— 'workaround', 'until we upgrade', 'TODO: remove when ...', 'Remove in v18' — and " +
      "check whether the reason each one cites has expired: the GitHub issue it names was " +
      "closed as fixed, the version it waits for is already at or below the project's own " +
      "floor or release, or the date it set has passed. Use this before editing, keeping, or " +
      "copying code that carries such a comment, and when asked about technical debt. " +
      "Runs locally. Results are evidence, never 'safe to delete'.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory to scan. Defaults to the server's working directory." },
        include_all: { type: "boolean", description: "Also list markers with no expired signal (default false)." }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  },
  {
    name: "check_reason",
    title: "Is the reason a comment cites still alive?",
    description:
      "Given one GitHub issue or pull request reference (owner/repo#123 or a github.com URL) " +
      "that a code comment cites as its reason, report whether that reason is resolved " +
      "(issue closed as completed, or PR merged), closed WITHOUT a fix (closed as not planned, " +
      "or PR closed unmerged — the workaround is then permanent, not expired), or still open. " +
      "Closed is not the same as fixed.",
    inputSchema: {
      type: "object",
      properties: {
        reference: { type: "string", description: "owner/repo#123, or https://github.com/owner/repo/issues/123 (or /pull/123)." }
      },
      required: ["reference"],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  }
];

function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });
const text = (obj, isError = false) =>
  ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }], isError });

function runCli(dir, includeAll) {
  const args = [CLI, dir, "--json"];
  if (includeAll) args.push("--all");
  return new Promise((resolve, reject) => {
    execFile(process.execPath, args, { maxBuffer: 64 * 1024 * 1024, timeout: 180000, env: process.env },
      (err, stdout) => {
        if (err && !stdout) return reject(err);
        try { resolve(JSON.parse(stdout)); }
        catch { reject(new Error(String(stdout).trim().slice(0, 300) || "scanner produced no JSON")); }
      });
  });
}

const issueKey = (i) => (i.url || "").replace(/^https?:\/\//, "");

function signalsOf(f, issues, today) {
  const { reasonResolved, closedWithoutFix } = require(CLI);
  const out = [];
  for (const i of f.issues || []) {
    const r = issues[issueKey(i)] || issues[i.url];
    if (reasonResolved(r)) out.push({ signal: "cited_reference_resolved", reference: i.url, evidence: r });
    else if (closedWithoutFix(r)) out.push({ signal: "cited_reference_closed_without_fix", reference: i.url, evidence: r });
  }
  if (f.floor && f.floor.status === "expired") out.push({ signal: "fixed_at_or_below_project_floor", evidence: f.floor });
  if (f.own && f.own.status === "expired") out.push({ signal: "project_already_shipped_target_version", evidence: f.own });
  if (f.dated && f.dated < today) out.push({ signal: "stated_date_passed", evidence: f.date || { date: f.dated } });
  return out;
}

const brief = (f, signals) => ({ file: f.file, line: f.line, comment: f.text, kind: f.kind, signals });

async function scanWorkarounds({ path: p, include_all } = {}) {
  const dir = path.resolve(p || process.cwd());
  const d = await runCli(dir, !!include_all);
  if (!d || !Array.isArray(d.findings)) return text({ root: dir, files: 0, note: "No JS/TS/PHP/Python source files found here." });
  const today = new Date().toISOString().slice(0, 10);
  const expired = [], closedUnfixed = [], rest = [];
  for (const f of d.findings) {
    const s = signalsOf(f, d.issues || {}, today);
    if (s.some((x) => x.signal !== "cited_reference_closed_without_fix")) expired.push(brief(f, s));
    else if (s.length) closedUnfixed.push(brief(f, s));
    else if (include_all) rest.push(brief(f, []));
  }
  const cap = (a) => ({ items: a.slice(0, LIST_CAP), total: a.length, truncated: a.length > LIST_CAP });
  return text({
    root: d.root, version: d.version, files: d.files, loc: d.loc,
    workaround_markers: d.markers, oracle_status: d.oracle_status, oracle_note: d.oracle_note,
    expired_reasons: cap(expired),
    closed_without_fix: cap(closedUnfixed),
    ...(include_all ? { other_markers: cap(rest) } : {}),
    dated_upcoming: d.dated_upcoming,
    how_to_read: NOT_A_VERDICT
  });
}

function parseRef(s) {
  const t = String(s || "").trim();
  let m = t.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/(\d+)/i);
  if (!m) m = t.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
  return m ? { owner: m[1], repo: m[2], num: Number(m[3]) } : null;
}

async function checkReason({ reference } = {}) {
  const ref = parseRef(reference);
  if (!ref) return text("Could not read that reference. Use owner/repo#123 or a github.com issue/pull URL.", true);
  const { fetchIssue, reasonResolved, closedWithoutFix } = require(CLI);
  const r = await fetchIssue(ref.owner, ref.repo, ref.num);
  const reading =
    r.state === null ? "unknown"
      : reasonResolved(r) ? "resolved"
        : closedWithoutFix(r) ? "closed_without_fix"
          : "open";
  const meaning = {
    unknown: `Could not check (${r.note || "no answer"}). Unknown is not the same as open. Set GITHUB_TOKEN to raise the rate limit.`,
    resolved: "The reason this reference stands for is resolved. A workaround that cites it has an expired reason — still check that the fix is in the version this project actually uses.",
    closed_without_fix: "Closed, but nothing was fixed (closed as not planned, or a PR closed unmerged). A workaround that cites it is permanent, not expired.",
    open: "Still open. The reason is alive."
  }[reading];
  return text({ reference: `${ref.owner}/${ref.repo}#${ref.num}`, reading, meaning, evidence: r, how_to_read: NOT_A_VERDICT });
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  try {
    switch (method) {
      case "initialize": {
        const asked = params && params.protocolVersion;
        const { VERSION } = require(CLI);
        return ok(id, {
          protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
          capabilities: { tools: {} },
          serverInfo: { name: "contextdebt", title: "ContextDebt", version: VERSION || "0" },
          instructions: "Use scan_workarounds before changing or copying code whose comments admit a workaround, and check_reason for a single cited issue. " + NOT_A_VERDICT
        });
      }
      case "ping": return isRequest && ok(id, {});
      case "tools/list": return ok(id, { tools: TOOLS });
      case "tools/call": {
        const name = params && params.name;
        const a = (params && params.arguments) || {};
        if (name === "scan_workarounds") return ok(id, await scanWorkarounds(a));
        if (name === "check_reason") return ok(id, await checkReason(a));
        return fail(id, -32602, `Unknown tool: ${name}`);
      }
      default:
        if (isRequest) return fail(id, -32601, `Method not found: ${method}`);
    }
  } catch (e) {
    if (isRequest) {
      if (method === "tools/call") return ok(id, text(`Scan failed: ${e.message}`, true));
      return fail(id, -32603, e.message);
    }
  }
}

function run() {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); continue; }
      Promise.resolve(handle(msg)).catch((e) => process.stderr.write(`contextdebt mcp: ${e.stack || e}\n`));
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

module.exports = { run, parseRef, TOOLS };
