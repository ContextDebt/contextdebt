# CLAUDE.md — ContextDebt

CLI that finds **self-admitted workarounds whose reasons have expired** — comments that say "workaround until X" where X already happened (issue closed, date passed). https://contextdebt.dev · npm `contextdebt`.

Product strategy, pricing, and roadmap live outside this repo (internal white paper). This file is engineering truth only.

## Non-negotiable product rules

1. **Precision > recall.** A false "expired" claim kills trust in the whole product. When unsure, don't flag. Target precision >90%.
2. **Never say "safe to delete".** We report "expired reason" — the cited justification is dead. Deletion is the human's call. This wording rule applies to CLI output, README, and all copy.
3. **Lockfile is the source of truth**, never the latest published release. "Issue closed" alone is insufficient — the fix must be in a version the repo actually runs.
4. **No auto-merge. Ever.** (Applies to the future PR product; keep the promise visible in copy.)
5. **Runs 100% locally.** The only network calls are GitHub API lookups for issue URLs found in the user's own comments. Never upload code, never phone home. Any change that sends more data than an issue number is rejected.
6. All user-facing copy is **English only**.

## Architecture

- Single file: `bin/cli.js`. **Zero runtime dependencies**, Node >= 18. Keep it that way — `npx contextdebt` cold-start is part of the product.
- Detection tiers:
  - **Tier 1** — `MARKER` regex (case-insensitive) for self-admitted markers: workaround/hacky/HACK/hotfix/kludge/"until we upgrade"/"remove this when"/etc. Guarded by a negation regex (`cannot/don't/never ... remove`).
  - **Tier 2** — GitHub issue status: `ISSUE_URL` regex on ±2-line context → `fetchIssue()` via api.github.com. Budget: 15 lookups unauthenticated, 100 with `GITHUB_TOKEN`.
  - **Date detector** — ISO date (`20xx-xx-xx`) in a marker line compared to today → "EXPIRED BY THEIR OWN DATE". Zero API, 100% provable. Dates in the future are reported as "watcher material".
- Excludes: `EXCLUDE_DIR` (node_modules, dist, build, tests, docs, …) and `EXCLUDE_FILE` (*.test.*, *.d.ts, *.min.js). Known issue: `build/` is excluded at any depth, which can hide a legit source dir — reconsider before adding more.
- Output: human-readable by default (summary counts → EXPIRED BY OWN DATE → EXPIRED REASONS → first 10 markers, `--all` for all), `--json` for machines. Progress line goes to **stderr** (200ms throttle). Slow-scan hint (>60s) points at cloud-synced folders (iCloud/OneDrive).

## Release workflow

1. Bump `VERSION` in `bin/cli.js` **and** `version` in `package.json` — they must match.
2. Update `CHANGELOG.md` (keep-a-changelog style, newest first).
3. Test locally: `node bin/cli.js <some repo>` — verify counts, at least one dated-TODO fixture, and the negation guard (a line like "cannot remove this" must NOT be flagged).
4. Commit, tag `vX.Y.Z`, push.
5. `npm publish` is **manual, by the human, with OTP**. Never automate publishing; never store npm tokens in CI. This is a supply-chain stance, not a missing feature.

## Known gotchas

- GitHub API returns 403 from shared/datacenter IPs — always support `GITHUB_TOKEN`, degrade gracefully (report "not checked", never crash).
- npm's website caches README for hours after publish — verify with `npm view contextdebt readme` before assuming a bad publish.
- Regexes must stay case-insensitive: real-world markers are "TODO: Remove after 2026-04-30" (capital R) — a case-sensitive pattern missed the biggest find in benchmarking.
- Zero markers on a scan is a valid result (young codebases confess nothing), not a bug — but check `files scanned` isn't 0 first.

## Backlog (engineering)

- v0.1.3: zero-result output should still be useful ("either you're clean, or your debt is the silent kind — deep scan coming").
- Support trac/other issue-tracker links (WordPress cites core.trac.wordpress.org, not GitHub).
- More extensions: `.php`, `.liquid` (WordPress/Shopify wave).
- `_autoresponse` thank-you email on the landing waitlist (site repo, not this one).
