# 🪐 Gravity Claw

A lean, secure, fully-understood personal AI agent. Inspired by OpenClaw — built from scratch.

## Architecture

```
┌──────────────┐     long-polling      ┌──────────────┐
│   Telegram   │ ◄──────────────────── │  Gravity     │
│   (you)      │ ────────────────────► │  Claw        │
└──────────────┘                       │              │
                                       │  ┌────────┐  │
                                       │  │ Agent  │  │
                                       │  │ Loop   │──┼──► Claude API
                                       │  └───┬────┘  │
                                       │      │       │
                                       │  ┌───▼────┐  │
                                       │  │ Tools  │  │
                                       │  └────────┘  │
                                       └──────────────┘
                                       No web server.
                                       No exposed ports.
```

## Security Model

| Layer | Protection |
|-------|-----------|
| Network | No web server. Telegram long-polling only. Zero exposed ports. |
| Auth | User ID whitelist. Unauthorized users are silently ignored. |
| Secrets | `.env` only. Never in code, logs, or memory files. |
| Agent | Max iteration limit on the tool loop. No infinite loops. |
| Tools | No community skill files. MCP only (Level 4). |

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure secrets
cp .env.example .env
# Edit .env with your values

# 3. Run
npm run dev
```

## Getting Your Credentials

### Telegram Bot Token
1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy the bot token to `.env`

### Your Telegram User ID
1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. It will reply with your numeric user ID
3. Add it to `ALLOWED_USER_IDS` in `.env`

### Anthropic API Key
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an API key
3. Copy it to `.env`

## Project Structure

```
src/
├── index.ts          Entry point — boot sequence
├── config.ts         Environment config with validation
├── bot.ts            Telegram bot (grammy, long-polling)
├── agent.ts          Agentic loop (Claude + tool execution)
└── tools/
    ├── registry.ts   Tool registration system
    ├── index.ts      Tool barrel (imports all tools)
    └── get-current-time.ts   Level 1 starter tool
```

## Levels

- [x] **Level 1** — Foundation: Telegram + Claude + agentic loop
- [ ] **Level 2** — Memory: SQLite + FTS5 + memory tools
- [ ] **Level 3** — Voice: Whisper in, ElevenLabs out
- [ ] **Level 4** — Tools: Shell, files, MCP bridge
- [ ] **Level 5** — Heartbeat: Proactive check-ins

## vs. OpenClaw

| | OpenClaw | Gravity Claw |
|---|---------|-------------|
| Codebase | Massive, cloned but unread | Lean, every line understood |
| Network | WebSocket server (42K+ public) | No server, Telegram polling |
| Skills | 700+ community files (341 malicious) | MCP only, no untrusted code |
| Cost | $500–$5K/mo reported | Controlled, local-first |
| Security | Multiple CVEs, SSRF, RCE | Whitelist, no ports, no web |
