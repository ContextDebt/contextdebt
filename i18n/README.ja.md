# ContextDebt

[English](../README.md) · [简体中文](README.zh-CN.md) · 日本語 · [Español](README.es.md) · [한국어](README.ko.md)

コードには「issue 1234 が直ったら消す」「v3 に上げるまでの回避策」といったコメントがあふれています。理由はとっくに期限切れなのに、コードは残り続け、AI は毎日それを読んでいます。

ContextDebt は、こうした自己申告のワークアラウンドを見つけ、引用された理由が期限切れかどうかを確かめます。引用先の issue が**修正済みとして**クローズされたか(クローズ ≠ 修正)、修正がプロジェクト自身の最低サポートバージョン以下にすでに入っているか、コメントに書かれた期限が過ぎたか。

## Claude Code・Cursor・任意の MCP クライアントで使う

```bash
claude mcp add contextdebt -- npx -y contextdebt mcp
```

Cursor / Windsurf / Claude Desktop:

```json
{ "mcpServers": { "contextdebt": { "command": "npx", "args": ["-y", "contextdebt", "mcp"] } } }
```

エージェントにこう頼みます:*use contextdebt — このリポジトリで理由が期限切れのワークアラウンドはどれ?*

## CLI

```bash
npx contextdebt
```

**完全にローカルで動作し、コードが外に出ることはありません。** ネットワーク通信は、あなた自身のコメントが参照する GitHub issue の状態確認だけです。

**「理由が期限切れ」は「安全に削除できる」ではありません。** 理由が消えたことと、コードを消して安全かどうかは別の問題で、後者にはテストとあなたの判断が必要です。

レポート:[contextdebt.dev/report](https://contextdebt.dev/report) · MIT
