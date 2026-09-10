# Quoted examples stay excluded

2026-09-10. Re-opened by the 10 Sep run, closed again unchanged.

## Decision

The rule shipped in 0.1.9 stands, unchanged: **a marker word inside a matching pair of `"` or `` ` `` on the same comment line is being cited, not confessed, and is not counted.** `'` is not a delimiter. A run of three delimiters (`"""`) is skipped rather than paired. Dates inside quoted spans are quoted too — `expiryDate()` walks to the first date outside a quoted span.

The real reason, from the 0.1.9 entry: this is a general precision rule, not a special case. It matters for every repository that documents patterns — linter rule docs, style guides, security checklists — and most of all for this scanner, whose source is mostly comments *about* markers. `"Hack Standard Library (v4.40 - 2020-05-03)"` was being reported as an expiry against our own source; it is an example being discussed, not a deadline anyone signed up to.

## Rejected alternatives

Each of these was considered in 0.1.9 and rejected for the reason recorded then. None is re-opened here.

- **Make `'` a delimiter too.** Apostrophes ("don't", "won't") are far more common in English comments than quoting is, and a lone one would swallow the rest of the line. An unmatched delimiter opens nothing.
- **Pair a run of three delimiters (`"""`) like any other quote.** It is a Python docstring delimiter, not an inline quote. Pairing it makes the whole docstring body a quoted span and silently undoes v0.1.7.
- **Count a confession written entirely inside quotes anyway.** This is the deliberate loss, quoted verbatim from the 0.1.9 entry:

  > **Deliberate loss.** A real confession written entirely inside quotes — `// "workaround until X" is the shape we look for` — is now missed. There is no way to tell it apart from a citation without reading intent, and precision beats recall: a false "expired" claim costs more than a missed marker.

## Evidence that re-opened and re-closed it

- The **10 Sep 2026 run** filed `// The "workaround" is here.` → 0 as a **P0 bug**. It is not a bug. It is this rule, working exactly as designed and as declared in the 0.1.9 CHANGELOG entry.
- **pdf.js `src/display/editor/tools.js:170`** (`The "workaround" is to append …`) is the declared loss showing up in the wild: **one line in 667 markers across 16 repositories.** That is the measured price of the rule, and it is the price we chose.

## Constraints

**Must:**
- Reject a marker (or a date) whose match index falls inside a quoted span on that line.
- Skip `"""` runs rather than pairing them.
- Report a future occurrence of this shape as a **known deliberate loss**, never as a bug or a regression.

**Must not:**
- Add `'` to the delimiter set.
- Add an intent-reading heuristic to recover confessions inside quotes.
- Re-file this as P0, P1, or a hotfix. It has been decided twice on the same evidence.

## Judgment rules

- The rule reads **punctuation, not intent**. That is what makes it cheap and stable.
- Prose that names a marker *without* quoting it still counts. `bin/cli.js:3` ("finds self-admitted workarounds in your codebase") and `bin/cli.js:438` ("was refused — the workaround") both survive the rule and should.
- When a new shape is proposed for exclusion, the test is whether punctuation alone decides it. If the answer needs intent, the answer is no.
- A missed marker is a lead we lose. A false "expired" is a false claim in someone's check run. When those two trade off, the miss wins.

## Open questions

- **Could a single quoted word (scare quotes) ever be told apart from a citation?** `// The "workaround" is here.` is a confession with one word in scare quotes; `// matches "workaround" and "hack"` is a citation of two. Rejected for now: linter documentation cites single words too — `"TODO"`, `"FIXME"` — so word count does not separate the two cases, and nothing cheaper than intent does. Re-open only with a corpus measurement showing how many of each shape exist, not with a single example.
