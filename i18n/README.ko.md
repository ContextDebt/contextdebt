# ContextDebt

[English](../README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [Español](README.es.md) · 한국어

코드에는 "issue 1234가 고쳐지면 삭제", "v3로 올리기 전까지 임시 우회" 같은 주석이 가득합니다. 이유는 이미 만료됐는데 코드는 남아 있고, AI는 매일 그 코드를 읽습니다.

ContextDebt는 이렇게 스스로 밝힌 우회 코드(workaround)를 찾아, 주석이 인용한 이유가 만료됐는지 확인합니다. 인용된 issue가 **수정 완료로** 닫혔는지(닫힘 ≠ 수정), 수정이 프로젝트가 직접 지원하는 최소 버전 이하에 이미 들어갔는지, 주석에 적힌 기한이 지났는지.

## Claude Code, Cursor 또는 모든 MCP 클라이언트에서

```bash
claude mcp add contextdebt -- npx -y contextdebt mcp
```

Cursor / Windsurf / Claude Desktop:

```json
{ "mcpServers": { "contextdebt": { "command": "npx", "args": ["-y", "contextdebt", "mcp"] } } }
```

에이전트에게 이렇게 요청하세요: *use contextdebt — 이 저장소에서 이유가 만료된 workaround는 어떤 것인가요?*

## CLI

```bash
npx contextdebt
```

**100% 로컬에서 실행되며 코드는 절대 외부로 나가지 않습니다.** 네트워크 호출은 여러분의 주석이 참조하는 GitHub issue 상태 조회뿐입니다.

**"이유가 만료됨"은 "안전하게 삭제 가능"이 아닙니다.** 이유가 사라졌다는 것과 코드를 지워도 안전하다는 것은 별개의 문제이며, 후자는 테스트와 여러분의 판단이 필요합니다.

리포트: [contextdebt.dev/report](https://contextdebt.dev/report) · MIT
