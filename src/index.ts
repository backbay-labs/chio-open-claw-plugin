import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { startSlack } from "./adapters/slack.js";
import { startDiscord } from "./adapters/discord.js";
import { startTelegram } from "./adapters/telegram.js";
import { receiptsRouter } from "./routes/receipts.js";
import { oauthRouter } from "./routes/oauth.js";
import { countersignRouter } from "./routes/countersign.js";
import { registerRouter } from "./routes/register.js";
import { startShiftScheduler, stopShiftScheduler } from "./scheduler.js";
import { pruneExpiredChallenges } from "./storage.js";

async function main() {
  const [slack, discord, telegram] = await Promise.all([
    startSlack(),
    startDiscord(),
    startTelegram(),
  ]);

  const app = new Hono();
  app.get("/", (c) =>
    c.json({
      name: "openclaw",
      version: "0.2.0",
      trust: config.CHIO_TRUST_URL,
      rp: config.WEBAUTHN_RP_ID,
    }),
  );
  app.get("/healthz", (c) => c.json({ ok: true }));
  app.route("/", oauthRouter());
  app.route("/", receiptsRouter({ slack, discord, telegram }));
  app.route("/", countersignRouter());
  app.route("/", registerRouter());

  const srv = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    console.log(`[openclaw] http ${info.address}:${info.port}`);
  });

  await startShiftScheduler();
  const sweeper = setInterval(() => pruneExpiredChallenges(), 60_000);

  const shutdown = async () => {
    console.log("[openclaw] shutting down");
    clearInterval(sweeper);
    stopShiftScheduler();
    await Promise.allSettled([
      slack?.stop(),
      discord?.destroy(),
      telegram?.stop(),
    ]);
    srv.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[openclaw] fatal", err);
  process.exit(1);
});
