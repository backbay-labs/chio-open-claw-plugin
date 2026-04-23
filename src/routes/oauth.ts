/**
 * OAuth callbacks for Slack and Discord. Persists the per-team install
 * payload so the bot can address multiple workspaces without re-requesting
 * tokens from env. Telegram uses a single global bot token (BotFather), so
 * it has no OAuth dance.
 */
import { Hono } from "hono";
import { config } from "../config.js";
import { putTeamToken } from "../storage.js";

export function oauthRouter() {
  const app = new Hono();

  app.get("/install", (c) => {
    const slackUrl = config.SLACK_CLIENT_ID
      ? `https://slack.com/oauth/v2/authorize?client_id=${config.SLACK_CLIENT_ID}&scope=channels:history,chat:write,files:write,commands,app_mentions:read&redirect_uri=${encodeURIComponent(config.OPENCLAW_PUBLIC_URL + "/oauth/slack/callback")}`
      : "#";
    const discordUrl = config.DISCORD_CLIENT_ID
      ? `https://discord.com/oauth2/authorize?client_id=${config.DISCORD_CLIENT_ID}&scope=bot+applications.commands&permissions=2147485696&redirect_uri=${encodeURIComponent(config.OPENCLAW_PUBLIC_URL + "/oauth/discord/callback")}`
      : "#";

    return c.html(`<!doctype html>
<html><body style="font-family:system-ui;max-width:480px;margin:4rem auto;">
<h1>Install OpenClaw</h1>
<ul>
  <li><a href="${slackUrl}">Add to Slack</a></li>
  <li><a href="${discordUrl}">Add to Discord</a></li>
  <li>Telegram: create a bot with @BotFather and set <code>TELEGRAM_BOT_TOKEN</code>.</li>
</ul>
</body></html>`);
  });

  app.get("/oauth/slack/callback", async (c) => {
    const code = c.req.query("code");
    if (!code) return c.json({ error: "missing code" }, 400);
    if (!config.SLACK_CLIENT_ID || !config.SLACK_CLIENT_SECRET) {
      return c.json({ error: "slack oauth not configured" }, 501);
    }
    const res = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.SLACK_CLIENT_ID,
        client_secret: config.SLACK_CLIENT_SECRET,
        redirect_uri: `${config.OPENCLAW_PUBLIC_URL}/oauth/slack/callback`,
      }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      team?: { id?: string; name?: string };
      access_token?: string;
    };
    if (!data.ok || !data.team?.id) {
      return c.json({ error: "slack oauth rejected", data }, 400);
    }
    putTeamToken({
      platform: "slack",
      teamId: data.team.id,
      botToken: data.access_token ?? null,
      installPayload: JSON.stringify(data),
      installedAt: new Date().toISOString(),
    });
    return c.html(
      `<h1>OpenClaw installed for ${data.team?.name ?? data.team.id}</h1>`,
    );
  });

  app.get("/oauth/discord/callback", async (c) => {
    const code = c.req.query("code");
    if (!code) return c.json({ error: "missing code" }, 400);
    if (!config.DISCORD_CLIENT_ID || !config.DISCORD_CLIENT_SECRET) {
      return c.json({ error: "discord oauth not configured" }, 501);
    }
    const res = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.DISCORD_CLIENT_ID,
        client_secret: config.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: `${config.OPENCLAW_PUBLIC_URL}/oauth/discord/callback`,
      }),
    });
    const data = (await res.json()) as {
      guild?: { id?: string; name?: string };
      access_token?: string;
    };
    if (!data.guild?.id) {
      return c.json({ error: "discord install missing guild", data }, 400);
    }
    putTeamToken({
      platform: "discord",
      teamId: data.guild.id,
      botToken: data.access_token ?? null,
      installPayload: JSON.stringify(data),
      installedAt: new Date().toISOString(),
    });
    return c.html(
      `<h1>OpenClaw installed in ${data.guild?.name ?? data.guild.id}</h1>`,
    );
  });

  return app;
}
