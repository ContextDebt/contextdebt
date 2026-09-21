# ContextDebt

**Context debt** is the expired code your AI reads — and you pay for — every day: workarounds for bugs fixed upstream years ago, polyfills for browsers you no longer support, retry logic tuned for defaults that no longer exist. The reason died; the code stayed.

## Try it now

```bash
npx contextdebt
```

We ran it on 1,813 of the most-starred repos on GitHub — results and every claim, re-checkable: [contextdebt.dev/report](https://contextdebt.dev/report)

Run it inside any JS/TS, WordPress/PHP, or Python repository. In seconds you get:

- every **self-admitted workaround** in your comments (`workaround`, `until we upgrade`, `TODO: remove when ...`, `TODO(v11): remove`, `Remove in v18.`, `we can use X once we drop Y`) — comments only, so an identifier like `var kludge = 0` or a UI string never counts
- for comments that reference GitHub issues: whether that issue was **closed as fixed** — i.e. the reason your own comment cites is **expired**. An issue closed as "not planned", or a pull request nobody merged, is reported separately: those workarounds are permanent, not expired
- **and the notes your own repository can settle, with no network at all**: a deadline the author wrote that has passed (`remove after Oct 28, 2025`), a fix that landed at or below the lowest version your manifest supports (`fixed in vite 5.1` under a `^6.4.0` peer floor), a release you have already shipped (`TODO: Remove from core-js@4`). A deadline written without a year is dated from the commit that introduced the line — or reported as unknown. Never guessed from today's date

```
      537  files scanned (0.9s)
   91,120  lines of code
       10  self-admitted workarounds (1.10 per 10k LOC)
        1  with EXPIRED reasons — the issue they cite was closed as fixed

  EXPIRED BY THE PROJECT'S OWN FLOOR — the fix is already in the lowest version this repo supports:

  packages/vitest/src/node/logger.ts:257
    // workaround for https://github.com/vitejs/vite/issues/15438, it was fixed in vite 5.1
    ↳ vite 5.1 ≤ floor 6.4.0 (peerDependencies ^6.4.0 || ^7.0.0 || ^8.0.0 in packages/vitest/package.json)
    ↳ lockfile resolves vite 8.0.11
```

*Real output, `vitest` at `4944cf4988`. The floor and the lockfile line were read out of the repository; nothing was asked of any network to reach that one.*

**Runs 100% locally. Your code never leaves your machine.** The only network calls are GitHub API status lookups for issue URLs your own comments reference — and the checks above that read your own dates, manifests and version make none at all. Set `GITHUB_TOKEN` to raise the lookup rate limit.

Options: `npx contextdebt [path] [--all] [--json]`

## What this is (and isn't)

This free scanner finds *candidates* — code whose stated reason may have expired. It deliberately says "expired reason", never "safe to delete": that the reason died is one claim, that removing the code is safe is another, and only the first is provable from a comment and a manifest. The second needs your tests and your judgement, and stays yours.

Where it cannot prove something, it says so rather than reporting a zero: a version range it refuses to read, a package no manifest declares, a deadline whose year the history could not supply. Unknown and none are different answers.

- Web: [contextdebt.dev](https://contextdebt.dev)
- GitHub: [github.com/ContextDebt](https://github.com/ContextDebt)
- X: [@contextdebtdev](https://x.com/contextdebtdev)
- Contact: hello@contextdebt.dev

MIT © ContextDebt
