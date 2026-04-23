/**
 * Telegram adapter. Telegram inline keyboard buttons with a `url` field are
 * opened in the user's browser automatically, so our countersign deep-link
 * flow is a native fit. `callback_data` buttons (attenuate) stay local.
 */
import { Bot } from "grammy";
import { config } from "../config.js";
import { parseIntentWithFallback } from "../core/intent.js";
import { draftFromIntent } from "../core/draft.js";
import { createProposal, attenuate } from "../core/approval.js";
import { subscribe } from "../core/subscriptions.js";
import { renderTelegram } from "../../templates/approval-card.js";
import { listReceiptsForAgent, revoke } from "../core/chio.js";
import { formatReceiptBundle } from "../core/receipt-format.js";
import { mintRegistrationToken } from "../routes/register.js";

export async function startTelegram(): Promise<Bot | null> {
  if (!config.TELEGRAM_BOT_TOKEN) {
    console.log("[telegram] missing token; adapter disabled");
    return null;
  }

  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (
      !/^@?chio[,:\s]/i.test(text) &&
      !text.toLowerCase().includes("@chio")
    ) {
      return;
    }
    const intent = await parseIntentWithFallback(text);
    const chatId = String(ctx.chat.id);
    const msgId = String(ctx.message.message_id);
    const tgUserId = String(ctx.from?.id ?? "unknown");
    const userId = `telegram:${tgUserId}`;

    if (intent.kind === "register_passkey") {
      const tok = mintRegistrationToken({
        userId,
        userHandle: ctx.from?.username ?? tgUserId,
        platform: "telegram",
      });
      const url = `${config.OPENCLAW_PUBLIC_URL}/register?token=${tok}`;
      await ctx.reply(`passkey registration: ${url}`);
      return;
    }

    if (intent.kind === "bond") {
      const proposal = createProposal({
        surface: "telegram",
        channelId: chatId,
        threadId: msgId,
        proposerId: userId,
        draft: draftFromIntent(intent),
      });
      subscribe({
        surface: "telegram",
        channelId: chatId,
        threadId: msgId,
        agent: proposal.draft.name,
      });
      const card = renderTelegram(proposal, userId);
      await ctx.reply(card.text, {
        parse_mode: card.parse_mode,
        reply_markup: card.reply_markup,
        reply_parameters: { message_id: ctx.message.message_id },
      });
      return;
    }

    if (intent.kind === "revoke") {
      try {
        if (intent.target) await revoke(intent.target);
        await ctx.reply(
          intent.target
            ? `capability ${intent.target} revoked`
            : "revoke requires a target",
        );
      } catch (err) {
        await ctx.reply(`revoke failed: ${(err as Error).message}`);
      }
      return;
    }

    if (intent.kind === "post_receipts") {
      const rs = await listReceiptsForAgent("current", intent.n).catch(() => []);
      await ctx.reply("```\n" + formatReceiptBundle(rs) + "\n```", {
        parse_mode: "MarkdownV2",
      });
      return;
    }

    if (intent.kind === "help") {
      await ctx.reply(
        "commands: register my passkey · bond an agent for ... · bump budget · attenuate · revoke · post receipts · shift handoff · status",
      );
      return;
    }

    await ctx.reply(`heard: ${intent.kind} — say 'chio, help' for commands`);
  });

  bot.on("callback_query:data", async (ctx) => {
    const [action, id] = ctx.callbackQuery.data.split(":");
    if (!id) return;
    if (action === "attenuate") {
      const p = attenuate(id, { budgetUsd: 10 });
      await ctx.answerCallbackQuery(
        p
          ? `attenuated · $${p.draft.budgetUsd.toFixed(2)} · re-countersign`
          : "no such proposal",
      );
    }
  });

  bot.start({ onStart: () => console.log("[telegram] adapter online") });
  return bot;
}

export async function postToTelegramThread(
  bot: Bot,
  chatId: string,
  threadId: string,
  text: string,
): Promise<void> {
  await bot.api.sendMessage(chatId, text, {
    reply_parameters: { message_id: Number(threadId) },
  });
}
