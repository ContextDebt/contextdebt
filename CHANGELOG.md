# Changelog

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
