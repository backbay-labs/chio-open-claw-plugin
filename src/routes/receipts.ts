/**
 * POST /receipts — ingests `ChioReceipt` payloads from the trust plane and
 * fans them out to subscribed Slack/Discord/Telegram threads.
 *
 * Signature verification is **real**: we call `@chio/bridge.verifyReceiptJson`,
 * which runs `@chio-protocol/sdk/invariants.verifyReceipt` — canonicalises
 * the body (RFC 8785), reconstructs the signed bytes, and verifies the
 * ed25519 signature against the receipt's embedded `kernel_key`. A forged
 * `x-chio-sig: ed25519:deadbeef` with a nonsense body now returns 401.
 */
import { Hono } from "hono";
import type bolt from "@slack/bolt";
import type { Client } from "discord.js";
import type { Bot } from "grammy";
import { parseReceipt } from "@chio/bridge";
import type { ChioReceipt } from "@chio/bridge";
import { subscribersFor } from "../core/subscriptions.js";
import { formatReceiptLine } from "../core/receipt-format.js";
import { verifyReceiptJson } from "../core/chio.js";
import { postToThread as postSlack } from "../adapters/slack.js";
import { postToDiscordThread } from "../adapters/discord.js";
import { postToTelegramThread } from "../adapters/telegram.js";

export interface Surfaces {
  slack: bolt.App | null;
  discord: Client | null;
  telegram: Bot | null;
}

export function receiptsRouter(surfaces: Surfaces) {
  const app = new Hono();

  app.post("/receipts", async (c) => {
    const raw = await c.req.text();

    let receipt: ChioReceipt;
    try {
      receipt = parseReceipt(raw);
    } catch (err) {
      return c.json(
        { error: "invalid receipt json", detail: (err as Error).message },
        400,
      );
    }

    // Real ed25519 verify over canonical JSON. The bridge delegates to
    // `@chio-protocol/sdk/invariants.verifyReceipt` which checks both the
    // signature and the parameter hash.
    if (!verifyReceiptJson(receipt)) {
      return c.json({ error: "receipt signature invalid" }, 401);
    }

    const agent = agentForReceipt(receipt);
    const line = formatReceiptLine(receipt);
    const subs = subscribersFor(agent);

    await Promise.allSettled(
      subs.map(async (s) => {
        if (s.surface === "slack" && surfaces.slack) {
          await postSlack(surfaces.slack, s.channelId, s.threadId, line);
        } else if (s.surface === "discord" && surfaces.discord) {
          await postToDiscordThread(surfaces.discord, s.channelId, line);
        } else if (s.surface === "telegram" && surfaces.telegram) {
          await postToTelegramThread(
            surfaces.telegram,
            s.channelId,
            s.threadId,
            line,
          );
        }
      }),
    );

    return c.json({ ok: true, fanout: subs.length, id: receipt.id });
  });

  return app;
}

/**
 * Map a receipt to its logical agent. Receipts carry a `capability_id` (the
 * bonded capability) and `metadata` — we prefer an explicit `agent` key in
 * metadata and fall back to the capability id.
 */
function agentForReceipt(r: ChioReceipt): string {
  const meta = (r as unknown as { metadata?: Record<string, unknown> }).metadata;
  if (meta && typeof meta.agent === "string") return meta.agent;
  const cap = (r as unknown as { capability_id?: string }).capability_id;
  return typeof cap === "string" && cap.length > 0 ? cap : "unknown";
}
