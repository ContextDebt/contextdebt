# Changelog

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
