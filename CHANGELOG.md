# Changelog

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
