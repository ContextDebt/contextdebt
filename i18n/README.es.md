# ContextDebt

[English](../README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · Español · [한국어](README.ko.md)

El código está lleno de comentarios como «borrar cuando se arregle el issue 1234» o «parche temporal hasta subir a v3». La razón caducó hace tiempo, el código sigue ahí — y tu IA lo lee todos los días.

ContextDebt encuentra esos workarounds declarados y comprueba si la razón que citan ya caducó: si el issue citado se cerró **como resuelto** (cerrado no es lo mismo que resuelto), si el arreglo ya está en o por debajo de la versión mínima que el propio proyecto soporta, o si la fecha que fijó el comentario ya pasó.

## En Claude Code, Cursor o cualquier cliente MCP

```bash
claude mcp add contextdebt -- npx -y contextdebt mcp
```

Cursor / Windsurf / Claude Desktop:

```json
{ "mcpServers": { "contextdebt": { "command": "npx", "args": ["-y", "contextdebt", "mcp"] } } }
```

Luego pídele al agente: *use contextdebt — ¿qué workarounds de este repo tienen la razón caducada?*

## CLI

```bash
npx contextdebt
```

**Se ejecuta 100 % en local; tu código nunca sale de tu máquina.** Las únicas llamadas de red consultan el estado de los issues de GitHub que citan tus propios comentarios.

**«Razón caducada» no significa «seguro de borrar».** Que la razón murió es una afirmación; que quitar el código sea seguro es otra, y esa depende de tus tests y de tu criterio.

Informe: [contextdebt.dev/report](https://contextdebt.dev/report) · MIT
