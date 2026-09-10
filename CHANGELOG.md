# Changelog

## 0.1.12 — 2026-09-10

The diagnosis layer: three oracles that stand on evidence already inside the repository.

No network, no testimony, no guessing. A date the author wrote, a floor in the project's own manifest, a release the project has already shipped — each one settles a note without asking anybody anything. Unresolved stays unresolved.

- **Prose deadlines.** JS/TS produced zero ISO dates in three census rounds, and the one date that existed was prose. The detector now reads `Oct 28, 2025`, `28 October 2025`, `October 2025` and `Q3 2025` (last day of the month or quarter), `2025-10`, and the year-less `Aug 24`.
- **A date is a deadline only when all three hold**: a removal intent in the same comment (the v0.1.5 rule, unchanged), a deadline preposition introducing it — after / by / before / until / once / on — or a removal verb directly before it, and no authored-date shape in front of it. `Added Oct 2019 for the old parser` is where a note came from, not when it dies: it keeps its address and gains no verdict. Copyright headers and year ranges are never dates at all.
- **The year of a year-less deadline is never assumed.** `expiryDate()` takes an optional `dateLine(path, lineNo)` resolver returning `{ sha, date }`. The year is the first one in which `<month day>` falls on or after the commit that introduced the line, and the answer names that commit in `year_basis`. With no resolver — and on a shallow clone, where a boundary commit's date is not the line's date — the note is `dated_unresolved`, reported in words, and `expired_by_own_date` does not move. Never the current year, never the file mtime.
- **The dependency floor.** `it was fixed in vite 5.1` is settled by the project's own manifest: nearest `package.json` upward, `peerDependencies` → `dependencies` → `devDependencies` → `engines` for `node`. The floor is the lowest version any alternative of the range admits — `^6.4.0 || ^7.0.0 || ^8.0.0` is 6.4.0, `>=20.19.0` is 20.19.0. At or above the version named, the reason is dead; below it, the note is watcher material and both numbers are printed. `*`, `latest`, a workspace or git range, an upper bound, or a package no manifest declares all stay **unresolved** — a guessed floor is a guessed verdict. The lockfile is printed beside the floor as evidence and is never the verdict.
- **The release they named.** ``TODO: Remove from `core-js@4` `` is a new marker shape, and the target must be version-like: `v18`, `4`, `3.0`, `core-js@4`. `remove from the array`, `remove from displays` and `Remove the surveyId from the displays array` are list operations and stay unreported — that guard is the whole shape. The verdict compares the target against the version the project calls itself: at or past it the reason is dead, short of it the note is watching (core-js at 3.50.0 against `core-js@4` is watching, not expired), under no manifest it is unresolved. **0.1.11's `Remove in v18.` and `TODO(v11): remove` gain the same verdict** — already counted, now answered.
- `--json` gains `dated_unresolved`, `expired_by_version_floor`, `version_floor_watching`, `version_floor_unresolved`, `expired_by_own_version`, `own_version_watching`, `own_version_unresolved`, and a per-finding `date` / `floor` / `own`. `expired_reasons` now has two sources; `null` still means "we could not check", and a floor verdict — which needs no network — makes the count knowable. `expired_by_issue` keeps the issue-only number.

**Measured** on fresh shallow clones at their default-branch HEADs, before → after, with the SHA measured. Zero previously-reported markers lost anywhere.

| repo | SHA | markers | new |
| --- | --- | --- | --- |
| puppeteer | `499c713ae7` | 6 → 6 | `expired_by_own_date` 1 — `Oct 28, 2025`, prose |
| vitest | `4944cf4988` | 10 → 10 | `expired_by_version_floor` 1 — vite 5.1 ≤ floor 6.4.0 |
| core-js | `84e45fba09` | 49 → 450 | 401 release targets, all watching, 0 expired |
| sentry-javascript | `9596f42001` | 115 → 115 | unchanged |
| dub | `1eec307816` | 27 → 27 | `expired_by_own_date` 1 with history; `dated_unresolved` 1 shallow |
| celery | `3e40f4332` | 14 → 14 | unchanged |

core-js moving 49 → 450 is this tool changing, not the earlier census being wrong: it now reads `Remove from <target>`, which core-js writes four hundred–odd times and almost nobody else writes at all. Every one of those is watching. Marker counts rise only where these shapes exist.

**Fixtures** 35 → 53 lines. `prose_dates.js` carries one line per rule and every negative the spec names — an authored date, a copyright header, `as of March 2024`, a date in a sentence with no removal intent, a TTL with no date at all, and a year-less deadline inside a quoted example. Two tiny projects pin the floor (the same claim is expired under `^6.4.0` and watcher material under `^5.0.0`) and two more pin the release target (expired at 22.4.1, watching at 3.50.0). The suite now runs the fixtures **twice** — once through the CLI with no history to read, once in-process with a fake resolver — and `expected.json` pins both outcomes, plus every floor verdict and release target per line.

**The App matches.** The GitHub App's engine was ported, not reimplemented: fixtures 53 = 53 and celery `3e40f433` 14 = 14, identical on file, line, date, floor status, release status and address. Two things differ because the environment does — manifests arrive as a map out of the tarball rather than a filesystem walk, and a year-less deadline is resolved afterwards through blame instead of `git log -S`, which can only ever read a deadline as newer, never older.

## 0.1.11 — 2026-09-07

Four more ways people write down that code is meant to go away.

- **Removal intent, four new shapes.** `MARKER_REMOVAL` now also reads: `we can use|replace X once|after we|this|it|they …`; a tagged removal of a named object (`TODO: Remove the compat shim once the loader lands`); a version target (`Remove in v18.`); and a version carried in the tag (`TODO(v11): remove,`). Each one ships with the guard that makes it safe, not as an afterthought.
- **The guards are the feature.** Shape one requires the clause after `once`/`after` to name a party or a thing — without it, `delete the bucket once we flush` reads as a confession when it is an instruction to the program, and `will be replaced by Next.js` reads as a deadline when nobody set one. Shape two requires a `TODO`/`FIXME`/`XXX` tag *and* the verb `remove` exactly, so `Delete source files after uploading` stays out. Shape three requires the version to follow `in` directly, which keeps prose like `will be removed in Python 3.17` where it belongs.
- **Measured on four repos, verified line by line.** sentry-javascript 111 → 117, tldraw 28 → 29, nest 4 → 5, requests 2 → 3. Ten new markers, every one a real removal note someone wrote about their own code, and **zero previously-reported markers lost**.
- **`.mts` and `.cts` are TypeScript.** They were being skipped entirely. Added to the language map and to the test/type-definition exclusions alongside `.ts`. nest's new marker lives in `vitest.config.integration.mts` — a file the scanner could not see before.
- **The oracle says when it does not know.** `--json` gains `issues_resolved`, `issues_unchecked`, `oracle_status` (`no_references` / `unavailable` / `partial` / `complete`) and `oracle_note`. When no reference could be resolved, `expired_reasons` and `closed_unfixed` are now **`null`, not `0`** — "we checked and found none" and "we could not check" are different claims and printing them as the same number was a quiet lie. The human report says it in words: *expired reasons: unknown, not zero*. No existing key renamed.

**Fixtures.** `js_markers.js` gains lines 19-23: one per new shape, plus `// delete the bucket once we flush` as a negative case that must stay unreported. New `fixtures/mts_markers.mts` proves `.mts` is read as TypeScript and that a marker in a string literal there is still ignored. `expected.json` goes 30 → 35 lines, addresses included; the suite still fails on any reported line that is not listed.

## 0.1.10 — 2026-09-02

The notes advisory: which confessions left an address.

Presentational only. **No marker count changes, no new detection** — every number the census was built on stands.

- **New `notes` block** at the end of the default report: how many of the markers already listed carry an address someone can come back for, and how many do not. Counts are derived from those same markers and reconcile exactly. Omitted when a scan finds nothing; when every marker carries an address, the second sentence swaps to say so.
- **What counts as an address.** A full GitHub issue/PR URL (read from the same ±2-line window the issue lookup already treats as the marker's citation); `owner/repo#N`; a keyword-prefixed reference — `issue`/`issues`/`bug`/`ticket`/`pr`/`gh` followed by `#N` — resolving to the scanned repo's own tracker; or a date (`YYYY-MM-DD`, `YYYY-MM`, or "in 20XX"). Prose conditions ("when we drop 3.7") are deliberately not detected.
- **A bare `#N` with no keyword is not an address.** `#fff`, `#[Route(...)]` and "step #1 in the runbook" are not tracker references, and a false address is a false claim in someone's check run. This is why `# quick hack for Issue #436` (celery) resolves and `# workaround, see #436` does not.
- Dates and `#N` are read from the marker's **own line**. A date two lines away often belongs to a different comment, and inheriting it would invent an address nobody wrote. URLs keep the wider window, because parking the link on the line under the marker is the convention.
- Quoted examples are excluded first, as of 0.1.9, so an address quoted as an example is not counted — and a marker written entirely inside quotes never reaches classification at all.
- `--json` gains `notes: { investigable, unaddressed }` and a per-finding `address` (the kind, or null). No existing key renamed.

**Fixtures.** New `fixtures/address_refs.py` carries 11 markers: three keyword references, one `owner/repo#N`, three date forms, four deliberately-unmatched bare-`#` cases, plus a quoted address that 0.1.9 drops before classification. The four existing language fixtures are untouched and still report the same 19 lines with the same expiry dates. `expected.json` gains an `addresses` map pinning the classification of all 30 lines, and the suite now also fails if the two buckets stop reconciling with the marker total.

The full-URL case is tested in the offline table in `scripts/check.js` rather than in a fixture: a `github.com` URL inside `fixtures/` would make every test run reach for the API.

## 0.1.9 — 2026-09-01

Quoted examples are citations, not confessions.

- **The rule.** A marker inside a quoted span within a comment is being *cited*, not admitted. `quotedSpans()` finds text wrapped in a matching pair of `"` or `` ` `` on the same line, and `markerIndex()` now rejects any match that falls inside one. This is a general precision rule, not a special case: it matters for every repository that documents patterns — linter rule docs, style guides, security checklists — and most of all for this scanner, whose source is mostly comments *about* markers.
- `'` is deliberately not a delimiter. Apostrophes ("don't", "won't") are far more common in English comments than quoting is, and a lone one would swallow the rest of the line. An unmatched delimiter opens nothing.
- A run of three delimiters (`"""`) is skipped rather than paired — it is a Python docstring delimiter, not an inline quote. Without that exemption the rule swallows every docstring and silently undoes v0.1.7.
- **Dates inside quotes are quoted too.** `expiryDate()` now walks to the first date *outside* a quoted span. `"Hack Standard Library (v4.40 - 2020-05-03)"` was being reported as an expiry against our own source; it is an example being discussed, not a deadline anyone signed up to.

**Deliberate loss.** A real confession written entirely inside quotes — `// "workaround until X" is the shape we look for` — is now missed. There is no way to tell it apart from a citation without reading intent, and precision beats recall: a false "expired" claim costs more than a missed marker.

**Measured.**

- *This repository*, same 691-line corpus both ways: **8 markers → 2**, density **115.77 → 28.94 per 10k lines**, and the one "expired by own date" (the quoted version stamp above) drops to zero. Against the 108.36 figure quoted for the 646-line v0.1.8 source, the same 2 markers give 28.94.
- *Fixtures*: 15 markers → 19, entirely from the four new YES cases (one per language). Every pre-existing fixture line is unchanged, dated expiries included.

The drop is smaller than "all of it": two markers survive, and neither is a bug. `bin/cli.js:3` says "finds self-admitted workarounds in your codebase" and `bin/cli.js:438` says "was refused — the workaround", both plain prose outside any quotes. This rule reads punctuation, not intent, so prose that names a marker without quoting it still counts. 28.94 per 10k is no longer the densest reading in our census (redash, 81.22), but it is not zero and should not be reported as zero.

Fixtures gain the four quoted-example cases in all four languages, and `fixtures/expected.json` lists the one YES case per language — so the suite now fails both when a NO case comes back and when a YES case stops being reported. Both directions were verified by breaking them on purpose.

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
