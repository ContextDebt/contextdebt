# Changelog

## 0.1.8 — 2026-08-31

Precision fix: closed is not fixed.

- **Bug.** The expired filter asked only `state === "closed"`. GitHub's issues endpoint returns `"closed"` for three different endings, and two of them settle nothing: an issue closed as `not_planned` was refused — the workaround citing it is *permanent*, not expired — and a pull request closed without a merge shipped no fix at all. Both were reported as EXPIRED. On our census corpus of 978 cited references, 73 of 752 closed references were of these two kinds: roughly **one in ten of everything the tool would have called EXPIRED was wrong**.
- `fetchIssue` now also resolves `is_pr` and `merged_at` (the same response already carries `pull_request.merged_at`, so this costs no extra request), and a new `reasonResolved()` decides: a PR counts only when merged, an issue only when closed for a reason other than `not_planned`.
- New bucket, reported separately and not in red: **`N cite an issue closed without a fix`**, listed under CLOSED WITHOUT A FIX with the `state_reason` or "PR not merged". These are the opposite of expired debt — if anything they are permanent.
- The EXPIRED line now reads "the issue they cite was closed as fixed".
- `--json` gains `closed_unfixed`. No existing key was renamed.
- `npm test` gains a fixed resolution table (no network): completed issue → expired, `not_planned` → not, open → not, merged PR → expired, unmerged PR → not, unresolved reference → not.

Verified end to end against four live references (a completed issue, a `not_planned` issue, a merged PR, a closed unmerged PR): v0.1.7 called all four EXPIRED, v0.1.8 calls two EXPIRED and moves two to CLOSED WITHOUT A FIX.

## 0.1.7 — 2026-08-30

Comment context for the last two languages, and Python docstrings recovered.

- **Python docstrings count now.** A triple-quoted block is treated as a comment when nothing but whitespace precedes it — that is what separates a docstring from data (`SQL = """select ..."""`) or an argument (`parser(description="""...""")`), where marker words are content. This recovers the ~12 CPython markers v0.1.5 traded away, including the `"""Workaround for zipfile.Path.is_file ..."""` that named the trade-off.
- **Docstring spans are weak.** Explicit marker words (workaround/hack/kludge/hotfix) count inside a docstring; removal intents ("remove this", "delete when") do not. Docstrings are prose written for the reader, so `"""Remove this directory."""` in pathlib documents behaviour rather than confessing debt — counting those cost 9 false positives against 9 real finds.
- **PHP comment context.** `//`, `#` and `/* */` count inside `<?php … ?>`; outside it the file is template output, where only `<!-- -->` counts. `#[Route(...)]` is PHP 8 attribute syntax, not a comment.
- **Liquid comment context.** `{% comment %}` blocks (including the `{%- -%}` whitespace-control form) and HTML comments count; theme markup does not.
- **Skipped build directories are now reported.** `build`, `dist` and `out` are still excluded at any depth — letting generated code in would cost precision — but the scan now says which ones it skipped, so a hand-written source dir that happens to be named `build` (CPython's `Tools/build`, 21 files) is visible instead of silently missing. Scan that path directly to include it. `--json` gains `skipped_dirs`.
- **A fixture suite ships with the repo.** `npm test` scans `fixtures/` and compares every reported line against `fixtures/expected.json` — 15 lines across four languages, including the negative cases (`var kludge = 0;`, `const s = "remove this when done"`, `#[Group('doctrine-dbal-workaround')]`, `"""Remove this file or link."""`). Not published to npm.

Measured against v0.1.6: CPython 66 → 75 markers (9 gained, 8 of them real docstring confessions), Symfony 41 → 34 (7 lost, all false positives: 4 PHP attributes, 2 emoji data rows, 1 test method name), react 107 → 107, Dawn 2 → 2.

Known limits: PHP heredocs are not tracked, so a `//` inside one can open a false comment span. Liquid's inline `{% # ... %}` and `{% liquid %}` comment forms are not handled. The word "hack" used as a verb in prose ("you are supposed to hack that up yourself") still reads as a marker.

## 0.1.6 — 2026-08-29

The comment-context rule reaches JS/TS.

- Markers in `.js`/`.jsx`/`.ts`/`.tsx`/`.mjs`/`.cjs` only count inside a comment — after `//`, or within `/* */`. `var kludge = 0;` and `function hotfixQueue()` are identifiers, not confessions, and no longer flag.
- Block comments are tracked across lines, so a marker on a bare line inside `/* ... */` is now found (v0.1.5 needed a `//`, `/*` or `*` on the line itself).
- String literals are skipped when locating comments, so the `//` in `const u = "https://example.com/kludge"` no longer opens a fake comment, and `" * To remove this script ..."` inside a string stops flagging.
- A marker word in code no longer hides a real one in the trailing comment on the same line: `var kludge = 0; // workaround until we upgrade` is reported. Same fix applies to Python — `kludge2 = 0  # workaround until we upgrade` was silently dropped before.
- Regex literals are not parsed. A marker sitting after one on the same line can be missed; that costs recall, never precision.

Measured on react (1,675 files, 368,879 LOC): 109 markers → 107, both drops real false positives (`delete this[propName];` in code, and a marker inside a string literal in a webpack config). axios and redux: unchanged. PHP and Liquid keep the old behaviour.

## 0.1.5 — 2026-08-29

Precision pass. Three real false positives from CPython and Symfony, gone.

- Python markers must sit in a comment: on `.py`/`.pyi` a marker only counts when a `#` opens a comment to the left of the match. Kills identifiers and string literals like `kludge = 0`. Other languages are unchanged.
- A date alone is no longer an expiry. An ISO date counts as an expiry date only when a removal intent (remove/delete/drop/after/until/by/expire) sits within one line of it — so authored dates (`# 2014-12-02 ch/doko Add workaround`) and version stamps (`Hack Standard Library (v4.40 - 2020-05-03)`) stop being reported as expired.
- An adjacent line carrying its own date no longer lends its removal intent to a neighbouring date.

Measured against v0.1.4: CPython drops from 1 "expired by own date" to 0 (the one was an authored date), Symfony from 1 to 0 (a version stamp). Symfony's 41 markers are untouched.

## 0.1.4 — 2026-08-29

Python support.

- Scan `.py` and `.pyi` files — markers and the date detector work as-is
- Exclude Python noise dirs: venv, .venv, site-packages, __pycache__, .tox, .mypy_cache, .ruff_cache, t
- Fixed the "(use --all)" count so it no longer disagrees with the total when expired findings are listed separately

## 0.1.3 — 2026-08-29

WordPress edition preview.

- Scan `.php` and `.liquid` files (WordPress / Shopify) — same markers, same date detector
- New marker forms: "will be deleted after ...", "delete this when ..." — matched only inside comments, so UI strings like "Are you sure you want to delete this?" never flag (precision > recall)
- Report referenced WordPress trac tickets (status check coming in the WP edition)
- Skip minified/bundled lines (>500 chars)
- When a scan finds 0 markers, say what that actually means — either you're clean, or your debt is the silent kind

## 0.1.2 — 2026-08-28
- New detector: **EXPIRED BY THEIR OWN DATE** — flags markers whose comment names an ISO date (e.g. `TODO: Remove after 2026-04-30`) that has already passed, with days-past count. Zero network calls, 100% provable.
- Dated TODOs not yet due are counted separately as watcher material.
- `--json` output gains `expired_by_own_date` and `dated_upcoming`.

## 0.1.1 — 2026-08-28
- Live progress line while scanning (files/lines/elapsed) — no more "is it stuck?" on large repos.
- Friendly note when a scan is slow (usually cloud-synced folders like iCloud/OneDrive downloading files on read).

## 0.1.0 — 2026-08-27
- First real release: local scanner for self-admitted workarounds ("workaround", "until we upgrade", "TODO: remove when…") across JS/TS sources.
- Checks GitHub issues referenced by your own comments; closed issues are flagged as **EXPIRED reasons**.
- `--json` and `--all` flags. Runs 100% locally — your code never leaves your machine.

## 0.0.1 — 2026-08-27
- Name reservation stub.
