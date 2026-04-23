/**
 * Discord adapter. Same shape as Slack: intent parse → card → browser
 * countersign. Discord LINK-style buttons (component type 2, style 5) carry
 * a `url` field pointing at /countersign; the browser handles the ceremony.
 */
import {
  Client,
  GatewayIntentBits,
  Events,
  type Interaction,
  type Message,
} from "discord.js";
import { config } from "../config.js";
import { parseIntentWithFallback } from "../core/intent.js";
import { draftFromIntent } from "../core/draft.js";
import { createProposal, attenuate } from "../core/approval.js";
import { subscribe } from "../core/subscriptions.js";
import { renderDiscord } from "../../templates/approval-card.js";
import { listReceiptsForAgent, revoke } from "../core/chio.js";
import { formatReceiptBundle } from "../core/receipt-format.js";
import { mintRegistrationToken } from "../routes/register.js";

export async function startDiscord(): Promise<Client | null> {
  if (!config.DISCORD_BOT_TOKEN) {
    console.log("[discord] missing token; adapter disabled");
    return null;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.on(Events.MessageCreate, async (msg: Message) => {
    if (msg.author.bot) return;
    const mentioned = client.user && msg.mentions.has(client.user);
    const addressed = /^@?chio[,:\s]/i.test(msg.content);
    if (!mentioned && !addressed) return;

    const text = msg.content.replace(/<@!?\d+>/g, "").trim();
    const intent = await parseIntentWithFallback(text);
    const userId = `discord:${msg.author.id}`;

    if (intent.kind === "register_passkey") {
      const tok = mintRegistrationToken({
        userId,
        userHandle: msg.author.username,
        platform: "discord",
      });
      const url = `${config.OPENCLAW_PUBLIC_URL}/register?token=${tok}`;
      await msg.reply(`passkey registration: ${url}`);
      return;
    }

    if (intent.kind === "bond") {
      const proposal = createProposal({
        surface: "discord",
        channelId: msg.channelId,
        threadId: msg.id,
        proposerId: userId,
        draft: draftFromIntent(intent),
      });
      subscribe({
        surface: "discord",
        channelId: msg.channelId,
        threadId: msg.id,
        agent: proposal.draft.name,
      });
      const card = renderDiscord(proposal, userId);
      await msg.reply(card as Parameters<typeof msg.reply>[0]);
      return;
    }

    if (intent.kind === "revoke") {
      try {
        if (intent.target) await revoke(intent.target);
        await msg.reply(
          intent.target
            ? `capability ${intent.target} revoked`
            : "revoke requires a target (did:chio:… or capability id)",
        );
      } catch (err) {
        await msg.reply(`revoke failed: ${(err as Error).message}`);
      }
      return;
    }

    if (intent.kind === "post_receipts") {
      const rs = await listReceiptsForAgent("current", intent.n).catch(() => []);
      await msg.reply("```\n" + formatReceiptBundle(rs) + "\n```");
      return;
    }

    if (intent.kind === "help") {
      await msg.reply(
        "commands: `register my passkey` · `bond an agent for …, cap $X, ttl Xh` · `bump budget by $X` · `attenuate to $10` · `revoke agent <name>` · `post receipts` · `shift handoff` · `status`",
      );
      return;
    }

    await msg.reply(`heard: ${intent.kind} — say \`@chio help\` for commands`);
  });

  client.on(Events.InteractionCreate, async (ix: Interaction) => {
    if (!ix.isButton()) return;
    const [action, id] = ix.customId.split(":");
    if (!id) return;

    if (action === "attenuate") {
      const p = attenuate(id, { budgetUsd: 10 });
      if (!p) {
        await ix.reply({ content: "no such proposal" });
        return;
      }
      await ix.reply({
        content: `attenuated · budget lowered to $${p.draft.budgetUsd.toFixed(2)} · re-countersign required`,
      });
    }
  });

  await client.login(config.DISCORD_BOT_TOKEN);
  console.log("[discord] adapter online");
  return client;
}

export async function postToDiscordThread(
  client: Client,
  channelId: string,
  text: string,
): Promise<void> {
  const ch = await client.channels.fetch(channelId);
  if (ch && ch.isTextBased() && "send" in ch) {
    await ch.send(text);
  }
}
