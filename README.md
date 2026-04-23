# OpenClaw

Ship signed Chio agents straight from your group chat.

OpenClaw is a hosted Chio edge that lives in Slack, Discord, and Telegram. Mention `@chio`, describe the job, and a `POLICY PROPOSAL` card lands in the channel. Team taps countersign with a passkey; the bonded agent runs and streams receipts back into the thread.

One bot. Three platforms. Same kernel.

## What it does

- Parses natural-language intent ("chio, run the nightly backfill, cap $40") into a draft policy.
- Posts an approval card with `[ countersign ] [ attenuate ] [ deny ]` actions.
- Requires M-of-N passkey signatures before issuing a capability.
- Streams every receipt (allow / deny / cancel) back into the originating thread.
- Rotates at shift change; revoke with `chio, stop` from any surface.

See the UX contract at `chio-world/src/app/plugins/openclaw/page.tsx`.

## Install

### Managed edge (fastest)

1. Open https://openclaw.chio.co/install
2. Pick Slack / Discord / Telegram.
3. One-click OAuth (Slack, Discord) or drop a bot token (Telegram).
4. Bind your trust plane: `@chio, bind trust to https://trust.chio.co`.

### Self-host

```bash
cp .env.example .env
# fill Slack / Discord / Telegram creds + CHIO_TRUST_URL
npm install
npm run build
npm start
```

Docker:

```bash
docker build -t openclaw .
docker run --env-file .env -p 8787:8787 openclaw
```

## Minimum scopes

- **Slack**: `channels:history`, `chat:write`, `files:write`, `commands`
- **Discord**: `bot`, `applications.commands`, `messages.read`
- **Telegram**: bot token with group admin

## Architecture

```
  Slack / Discord / Telegram
          |
          v
    platform adapters  --+
          |              |
          v              |
    intent parser        |
          |              |
          v              |
    approval state ------+
          |              |
          v              |
        Chio SDK  <->  trust plane
          |
          v
   receipts webhook  ->  thread
```

All three adapters share `src/core/*`. The HTTP server handles OAuth callbacks and the `/receipts` webhook.

## Development

```bash
npm run dev       # hot reload
npm run typecheck
```

## License

Apache-2.0.

## CI

[![ci](https://github.com/owner/chio-open-claw-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/owner/chio-open-claw-plugin/actions/workflows/ci.yml)

Workflow: [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Runs lint/typecheck (non-blocking in Wave 5.1), unit tests, and a chio-backed smoke pass. Swap `owner/...` once the GitHub org is live.
