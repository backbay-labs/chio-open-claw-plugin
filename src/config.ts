import { z } from "zod";

const Env = z.object({
  PORT: z.coerce.number().default(8787),
  OPENCLAW_PUBLIC_URL: z.string().default("http://localhost:8787"),

  // Trust plane (chio trust serve).
  CHIO_TRUST_URL: z.string().default("http://127.0.0.1:8940"),
  CHIO_TRUST_TOKEN: z.string().optional(),
  CHIO_RECEIPT_DB: z.string().optional(),
  // MCP edge (chio mcp serve-http) — used by `bond()` auto-bootstrap.
  CHIO_MCP_EDGE_URL: z.string().optional(),

  // WebAuthn / passkey.
  WEBAUTHN_RP_ID: z.string().default("localhost"),
  WEBAUTHN_RP_NAME: z.string().default("OpenClaw"),
  WEBAUTHN_ORIGIN: z.string().default("http://localhost:8787"),

  // SQLite.
  DATABASE_PATH: z.string().default("./var/openclaw.sqlite"),

  // Slack.
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_APP_TOKEN: z.string().optional(),

  // Discord.
  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  DISCORD_PUBLIC_KEY: z.string().optional(),

  // Telegram.
  TELEGRAM_BOT_TOKEN: z.string().optional(),

  // Approval thresholds.
  DEFAULT_QUORUM: z.coerce.number().default(2),
  DEFAULT_SIGNERS: z.coerce.number().default(3),

  // Shift handoff.
  CHIO_SHIFTS_PATH: z.string().optional(),

  // Optional LLM fallback for complex natural-language intent.
  CHIO_LLM_URL: z.string().optional(),
  CHIO_LLM_TOKEN: z.string().optional(),
});

export const config = Env.parse(process.env);
export type Config = z.infer<typeof Env>;
