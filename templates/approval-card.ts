import type { Proposal } from "../src/core/approval.js";
import { mintCountersignToken } from "../src/core/approval.js";
import { config } from "../src/config.js";

/**
 * Build a `countersign` deep-link for a given platform user.
 *
 * The URL points at OpenClaw's web frontend, which runs the real WebAuthn
 * ceremony in the browser. The token is bound to (proposalId, platform,
 * userId) and consumed after a successful verify.
 */
export function countersignUrl(
  proposal: Proposal,
  platform: "slack" | "discord" | "telegram",
  userId: string,
  action: "countersign" | "deny" = "countersign",
): string {
  const token = mintCountersignToken(proposal.id, platform, userId);
  const url = new URL("/countersign", config.OPENCLAW_PUBLIC_URL);
  url.searchParams.set("proposal", proposal.id);
  url.searchParams.set("platform", platform);
  url.searchParams.set("user", userId);
  url.searchParams.set("token", token);
  url.searchParams.set("action", action);
  return url.toString();
}

const pad = (s: string, n: number) =>
  s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);

export function renderAscii(p: Proposal): string {
  const d = p.draft;
  const rows = [
    `name     ${d.name}`,
    `scope    ${d.scope}`,
    `budget   $${d.budgetUsd.toFixed(2)} / day`,
    `ttl      ${d.ttlHours}h \u00b7 refresh on shift end`,
    `gates    ${d.gates.join(" \u00b7 ") || "\u2014"}`,
    ``,
    `signers  ${p.signatures.length}/${p.quorum} of ${p.totalSigners}`,
  ];
  const width = 49;
  const top = `\u250c\u2500 POLICY PROPOSAL ${"\u2500".repeat(width - 19)}\u2510`;
  const bot = `\u2514${"\u2500".repeat(width - 1)}\u2518`;
  const lines = rows.map((r) => `\u2502 ${pad(r, width - 3)}\u2502`);
  return [top, ...lines, bot].join("\n");
}

/**
 * Slack block kit: button deep-links via `url` field to the countersign page.
 * Slack executes `url`-bearing buttons as external-link actions — the user
 * is taken to the browser, where they run the passkey ceremony. No signature
 * stubs inside chat; chat is the router, browser is the signer.
 */
export function renderSlack(p: Proposal, signerUserId: string) {
  const d = p.draft;
  return {
    text: `POLICY PROPOSAL \u00b7 ${d.name}`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: "POLICY PROPOSAL" } },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*name*\n${d.name}` },
          { type: "mrkdwn", text: `*scope*\n${d.scope}` },
          { type: "mrkdwn", text: `*budget*\n$${d.budgetUsd.toFixed(2)} / day` },
          { type: "mrkdwn", text: `*ttl*\n${d.ttlHours}h` },
          { type: "mrkdwn", text: `*gates*\n${d.gates.join(" \u00b7 ") || "\u2014"}` },
          {
            type: "mrkdwn",
            text: `*signers*\n${p.signatures.length}/${p.quorum} of ${p.totalSigners}`,
          },
        ],
      },
      {
        type: "actions",
        block_id: `proposal:${p.id}`,
        elements: [
          {
            type: "button",
            action_id: "countersign_url",
            style: "primary",
            text: { type: "plain_text", text: "countersign with passkey" },
            url: countersignUrl(p, "slack", signerUserId, "countersign"),
            value: p.id,
          },
          {
            type: "button",
            action_id: "attenuate",
            text: { type: "plain_text", text: "attenuate" },
            value: p.id,
          },
          {
            type: "button",
            action_id: "deny_url",
            style: "danger",
            text: { type: "plain_text", text: "deny" },
            url: countersignUrl(p, "slack", signerUserId, "deny"),
            value: p.id,
          },
        ],
      },
    ],
  };
}

/**
 * Discord link buttons: style 5 (LINK) with a url field; user lands on the
 * countersign page in their browser. Same ceremony as Slack.
 */
export function renderDiscord(p: Proposal, signerUserId: string) {
  const d = p.draft;
  return {
    embeds: [
      {
        title: "POLICY PROPOSAL",
        description: `**${d.name}**`,
        fields: [
          { name: "scope", value: d.scope, inline: true },
          {
            name: "budget",
            value: `$${d.budgetUsd.toFixed(2)} / day`,
            inline: true,
          },
          { name: "ttl", value: `${d.ttlHours}h`, inline: true },
          { name: "gates", value: d.gates.join(" \u00b7 ") || "\u2014" },
          {
            name: "signers",
            value: `${p.signatures.length}/${p.quorum} of ${p.totalSigners}`,
          },
        ],
        color: 0xe86a3a,
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 5,
            label: "countersign with passkey",
            url: countersignUrl(p, "discord", signerUserId, "countersign"),
          },
          {
            type: 2,
            style: 2,
            label: "attenuate",
            custom_id: `attenuate:${p.id}`,
          },
          {
            type: 2,
            style: 5,
            label: "deny",
            url: countersignUrl(p, "discord", signerUserId, "deny"),
          },
        ],
      },
    ],
  };
}

/**
 * Telegram inline keyboard: the `url` button takes the user out to the
 * browser. `callback_data` is reserved for the attenuate action which does
 * not require a signature.
 */
export function renderTelegram(p: Proposal, signerUserId: string) {
  return {
    text: "```\n" + renderAscii(p) + "\n```",
    parse_mode: "MarkdownV2" as const,
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "countersign with passkey",
            url: countersignUrl(p, "telegram", signerUserId, "countersign"),
          },
          { text: "attenuate", callback_data: `attenuate:${p.id}` },
          {
            text: "deny",
            url: countersignUrl(p, "telegram", signerUserId, "deny"),
          },
        ],
      ],
    },
  };
}
