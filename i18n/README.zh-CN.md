# ContextDebt

[English](../README.md) · 简体中文 · [日本語](README.ja.md) · [Español](README.es.md) · [한국어](README.ko.md)

代码里到处是这样的注释:“等 issue 1234 修好就删掉”、“升级到 v3 之前的临时方案”。原因早就过期了,代码却还在——而你的 AI 每天都在读它。

ContextDebt 找出这些自认的 workaround,并检查它们引用的原因是否已经过期:引用的 issue 是否已**作为已修复**关闭(“关闭”不等于“修复”)、修复是否已经低于项目自己声明的最低版本、注释写下的日期是否已经过去。

## 在 Claude Code、Cursor 或任何 MCP 客户端中使用

```bash
claude mcp add contextdebt -- npx -y contextdebt mcp
```

Cursor / Windsurf / Claude Desktop:

```json
{ "mcpServers": { "contextdebt": { "command": "npx", "args": ["-y", "contextdebt", "mcp"] } } }
```

然后对 agent 说:*use contextdebt — 这个仓库里哪些 workaround 的原因已经过期了?*

## 命令行

```bash
npx contextdebt
```

**完全在本地运行,代码不会离开你的机器。** 唯一的网络请求是查询你自己的注释所引用的 GitHub issue 状态。

**“原因过期”不等于“可以安全删除”。** 原因失效是一回事,删除代码是否安全是另一回事——那需要你的测试和你的判断。

报告:[contextdebt.dev/report](https://contextdebt.dev/report) · MIT
