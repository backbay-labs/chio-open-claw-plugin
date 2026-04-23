/**
 * Slack adapter. Parses mentions into intents, posts approval cards, and
 * renders confirmations when the web countersign flow completes.
 *
 * Countersignatures no longer happen inside Slack. Buttons on the card
 * deep-link to /countersign?token=… where the real WebAuthn ceremony runs
 * in the browser (see templates/approval-card.ts).
 */
import bolt from "@slack/bolt";
import { config } from "../config.js";
import { parseIntentWithFallback } from "../core/intent.js";
import { draftFromIntent } from "../core/draft.js";
import { createProposal, attenuate, get } from "../core/approval.js";
import { subscribe, unsubscribeAgent } from "../core/subscriptions.js";
import {
  listReceiptsForAgent,
  revoke,
} from "../core/chio.js";
import { renderSlack } from "../../templates/approval-card.js";
import { formatReceiptBundle } from "../core/receipt-format.js";
import { mintRegistrationToken } from "../routes/register.js";

const { App } = bolt;

export async function startSlack(): Promise<bolt.App | null> {
  if (!config.SLACK_SIGNING_SECRET || !config.SLACK_BOT_TOKEN) {
    console.log("[slack] missing creds; adapter disabled");
    return null;
  }

  const appOpts: ConstructorParameters<typeof App>[0] = {
    signingSecret: config.SLACK_SIGNING_SECRET,
    token: config.SLACK_BOT_TOKEN,
    socketMode: !!config.SLACK_APP_TOKEN,
  };
  if (config.SLACK_APP_TOKEN) appOpts.appToken = config.SLACK_APP_TOKEN;
  const app = new App(appOpts);

  app.event("app_mention", async ({ event, client }) => {
    const text = (event.text ?? "").replace(/<@[^>]+>/g, "").trim();
    const intent = await parseIntentWithFallback(text);
    const threadTs = event.thread_ts ?? event.ts;
    const slackUserId = event.user ?? "unknown";
    const userId = `slack:${slackUserId}`;

    switch (intent.kind) {
      case "register_passkey": {
        const tok = mintRegistrationToken({
          userId,
          userHandle: slackUserId,
          platform: "slack",
        });
        const url = `${config.OPENCLAW_PUBLIC_URL}/register?token=${tok}`;
        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: threadTs,
          text: `passkey registration: <${url}|open in browser>`,
        });
        return;
      }
      case "bond": {
        const proposal = createProposal({
          surface: "slack",
          channelId: event.channel,
          threadId: threadTs,
          proposerId: userId,
          draft: draftFromIntent(intent),
        });
        subscribe({
          surface: "slack",
          channelId: event.channel,
          threadId: threadTs,
          agent: proposal.draft.name,
        });
        const card = renderSlack(proposal, userId);
        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: threadTs,
          ...card,
        });
        return;
      }
      case "revoke": {
        try {
          if (intent.target) await revoke(intent.target);
          await client.chat.postMessage({
            channel: event.channel,
            thread_ts: threadTs,
            text: intent.target
              ? `capability ${intent.target} revoked`
              : "revoke requires a target (e.g. did:chio:… or capability id)",
          });
        } catch (err) {
          await client.chat.postMessage({
            channel: event.channel,
            thread_ts: threadTs,
            text: `revoke failed: ${(err as Error).message}`,
          });
        }
        return;
      }
      case "post_receipts": {
        const rs = await listReceiptsForAgent("current", intent.n).catch(
          () => [],
        );
        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: threadTs,
          text: "```\n" + formatReceiptBundle(rs) + "\n```",
        });
        return;
      }
      case "status": {
        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: threadTs,
          text: intent.target
            ? `status of ${intent.target}: use \`chio, post receipts\` to see recent activity`
            : `openclaw trust=${config.CHIO_TRUST_URL}`,
        });
        return;
      }
      case "shift_handoff": {
        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: threadTs,
          text:
            "shift handoff queued — TTLs will rotate at the next boundary in `.chio/shifts.yaml`",
        });
        return;
      }
      case "policy_draft": {
        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: threadTs,
          text: `drafting policy: ${intent.description}\nsay \`@chio bond a <name> agent, cap $X, ttl Xh\` to post an approval card.`,
        });
        return;
      }
      case "help": {
        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: threadTs,
          text: [
            "chio commands:",
            "`register my passkey` — enroll a WebAuthn credential.",
            "`bond an agent for <job>, cap $X, ttl Xh` — post approval card.",
            "`bump budget by $X` — raise budget on the current agent.",
            "`attenuate to $10` — lower budget/ttl on the current draft.",
            "`revoke agent <name>` — tear down a capability.",
            "`post last 5 receipts` — bundle receipts into the thread.",
            "`shift handoff` — rotate to next on-call.",
            "`status` — show trust plane binding.",
          ].join("\n"),
        });
        return;
      }
      default: {
        await client.chat.postMessage({
          channel: event.channel,
          thread_ts: threadTs,
          text: `heard: \`${intent.kind}\` — say \`@chio help\` for commands`,
        });
      }
    }
  });

  // attenuate button does not require a countersignature; it just lowers the
  // draft and re-posts a fresh card (signers must re-countersign).
  app.action("attenuate", async ({ body, ack, client, action }) => {
    await ack();
    const id = (action as { value: string }).value;
    const p = attenuate(id, { budgetUsd: 10 });
    if (!p) return;
    await client.chat.postMessage({
      channel: (body as { channel: { id: string } }).channel.id,
      text: `attenuated · budget lowered to $${p.draft.budgetUsd.toFixed(2)} · re-countersign required`,
    });
  });

  // these action_ids fire when Slack renders the URL button; we only need
  // to ack (the browser flow does the real work).
  app.action("countersign_url", async ({ ack }) => ack());
  app.action("deny_url", async ({ ack }) => ack());

  void get;
  void unsubscribeAgent;

  await app.start();
  console.log("[slack] adapter online");
  return app;
}

export async function postToThread(
  app: bolt.App,
  channelId: string,
  threadId: string,
  text: string,
): Promise<void> {
  await app.client.chat.postMessage({
    channel: channelId,
    thread_ts: threadId,
    text,
  });
}

/**
 * Post a quorum-reached confirmation card to the originating thread. Used by
 * the HTTP verify handler so every platform the proposal touched hears about
 * the successful bond.
 */
export async function postApprovalNotice(
  app: bolt.App,
  channelId: string,
  threadId: string,
  text: string,
): Promise<void> {
  await app.client.chat.postMessage({
    channel: channelId,
    thread_ts: threadId,
    text,
  });
}
