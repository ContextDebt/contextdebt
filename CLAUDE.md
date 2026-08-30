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
  - **Tier 1** — `MARKER` regex (case-insensitive) for self-admitted markers: workaround/hacky/HACK/hotfix/kludge/"until we upgrade"/"remove this when"/etc. Guarded by a negation regex (`cannot/don't/never ... remove`), and by the comment-context rule below.
  - **Comment context** — a marker only counts inside a comment, in every supported language. `commentSpans(lang, line, state)` dispatches to `jsSpans` / `pySpans` / `phpSpans` / `liquidSpans`; each returns `{ spans, state }` where spans are `[start, end)` index pairs and `state` carries across lines (open block comment, open docstring, inside `<?php`). A span may be flagged `WEAK` (docstrings): explicit marker words count there, removal intents do not.
  - **Tier 2** — GitHub issue status: `ISSUE_URL` regex on ±2-line context → `fetchIssue()` via api.github.com. Budget: 15 lookups unauthenticated, 100 with `GITHUB_TOKEN`.
  - **Date detector** — ISO date (`20xx-xx-xx`) in a marker line compared to today → "EXPIRED BY THEIR OWN DATE". Zero API, 100% provable. Dates in the future are reported as "watcher material".
- Excludes: `EXCLUDE_DIR` (node_modules, dist, build, tests, docs, …) and `EXCLUDE_FILE` (*.test.*, *.d.ts, *.min.js). `build`/`dist`/`out` (`OUTPUT_DIR`) are still excluded at any depth — generated code would wreck precision — but the scan reports which ones it skipped, so a real source dir named `build` (CPython's `Tools/build`) is visible rather than silently missing; the escape hatch is scanning that path directly, since the root argument is never filtered. Reconsider before adding more names.
- Output: human-readable by default (summary counts → EXPIRED BY OWN DATE → EXPIRED REASONS → first 10 markers, `--all` for all), `--json` for machines. Progress line goes to **stderr** (200ms throttle). Slow-scan hint (>60s) points at cloud-synced folders (iCloud/OneDrive).

## Release workflow

1. Bump `VERSION` in `bin/cli.js` **and** `version` in `package.json` — they must match.
2. Update `CHANGELOG.md` (keep-a-changelog style, newest first).
3. Run `npm test` — scans `fixtures/` against `fixtures/expected.json` (15 lines, four languages, negative cases included). It fails on any line reported that is not listed, which is what catches a precision regression. Then test on a real repo: `node bin/cli.js <some repo>` and compare marker counts against the previous version; an unexplained drop over ~20% means stop and audit what was lost.
4. Commit, tag `vX.Y.Z`, push.
5. `npm publish` is **manual, by the human, with OTP**. Never automate publishing; never store npm tokens in CI. This is a supply-chain stance, not a missing feature.

## Known gotchas

- GitHub API returns 403 from shared/datacenter IPs — always support `GITHUB_TOKEN`, degrade gracefully (report "not checked", never crash).
- npm's website caches README for hours after publish — verify with `npm view contextdebt readme` before assuming a bad publish.
- Regexes must stay case-insensitive: real-world markers are "TODO: Remove after 2026-04-30" (capital R) — a case-sensitive pattern missed the biggest find in benchmarking.
- A date is only an expiry when a removal intent (remove/delete/drop/after/until/by/expire) is within ±1 line. A neighbour line that carries its own date is claimed by that date and lends no intent — without that, a `# TODO: Remove after <date>` line leaks its intent onto the version stamp above it.
- `MARKER`/`MARKER_REMOVAL` are global (`gi`) regexes walked by `firstMatch()`, because the first match on a line can be in code while the real marker is in the trailing comment. Anything reusing them must reset `lastIndex` — `firstMatch` does.
- `commentSpans()` runs before the >500-char skip in the scan loop; skipping it there would lose the open-block state for the rest of the file.
- Docstrings are prose, not comments: counting removal intents inside them added 9 false positives to CPython (`"""Remove this directory."""` in pathlib, `"""...will be removed in Python 3.17"""` in tkinter) against 9 real finds. Hence `WEAK` spans. Do not "simplify" that away.
- `#[Attribute]` is PHP 8 syntax, not a `#` comment — Symfony has hundreds (`#[Route]`, `#[Group('...workaround')]`).
- Zero markers on a scan is a valid result (young codebases confess nothing), not a bug — but check `files scanned` isn't 0 first.

## Backlog (engineering)

- PHP heredocs/nowdocs are not tracked (v0.1.7): a `//` or `#` inside one opens a false comment span. Not seen in Symfony, but a heredoc full of SQL or HTML is where it would bite.
- Liquid's inline comment forms — `{% # ... %}` and comments inside `{% liquid %}` blocks — are not handled; only `{% comment %}` and `<!-- -->`.
- The Liquid scanner has no real-world validation: Dawn (88 `.liquid` files) contains zero marker words, so only the fixture covers it. Find a theme with real markers before trusting the numbers.
- "hack" used as a verb in prose still reads as a marker (`Lib/sched.py:4` — "you are supposed to hack that up yourself"). Telling verb from noun is not cheap; left alone deliberately.
