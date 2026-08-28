# ContextDebt

**Context debt** is the expired code your AI reads — and you pay for — every day: workarounds for bugs fixed upstream years ago, polyfills for browsers you no longer support, retry logic tuned for defaults that no longer exist. The reason died; the code stayed.

## Try it now

```bash
npx contextdebt
```

Run it inside any JS/TS or WordPress/PHP repository. In seconds you get:

- every **self-admitted workaround** in your code (`workaround`, `until we upgrade`, `TODO: remove when ...`)
- for comments that reference GitHub issues: whether that issue is **already closed** — i.e. the reason your own comment cites is **expired**

```
  4,421  files scanned (0.4s)
399,947  lines of code
     51  self-admitted workarounds (1.28 per 10k LOC)
      4  with EXPIRED reasons — the issue they cite is already closed
```

**Runs 100% locally. Your code never leaves your machine.** The only network calls are GitHub API status lookups for issue URLs your own comments reference. Set `GITHUB_TOKEN` to raise the lookup rate limit.

Options: `npx contextdebt [path] [--all] [--json]`

## What this is (and isn't)

This free scanner finds *candidates* — code whose stated reason may have expired. It deliberately says "expired reason", never "safe to delete": proving a removal is safe requires mining the git history, matching upstream fixes against your lockfile, and running your tests — that's the full ContextDebt pipeline, coming soon.

- Web: [contextdebt.dev](https://contextdebt.dev)
- GitHub: [github.com/ContextDebt](https://github.com/ContextDebt)
- X: [@contextdebtdev](https://x.com/contextdebtdev)
- Contact: hello@contextdebt.dev

MIT © ContextDebt
