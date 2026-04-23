/**
 * Natural-language intent parser.
 *
 * Regex-first: the common in-channel phrasings are matched directly so the
 * bot has zero LLM dependency in the happy path. When the text does not match
 * and `CHIO_LLM_URL` is configured, we POST the text to that URL and expect
 * back a JSON object shaped like `Intent`. The LLM hop is opt-in; regex
 * handles all 15 listed intents on its own.
 */
import { z } from "zod";
import { config } from "../config.js";

export const Intent = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("bond"),
    name: z.string(),
    budgetUsd: z.number().optional(),
    ttlHours: z.number().optional(),
    scope: z.string().optional(),
    toolServers: z.array(z.string()).default([]),
    raw: z.string(),
  }),
  z.object({
    kind: z.literal("bump_budget"),
    deltaUsd: z.number(),
    raw: z.string(),
  }),
  z.object({
    kind: z.literal("require_approval"),
    rule: z.string(),
    raw: z.string(),
  }),
  z.object({ kind: z.literal("revoke"), target: z.string().optional(), raw: z.string() }),
  z.object({ kind: z.literal("post_receipts"), n: z.number().default(5), raw: z.string() }),
  z.object({ kind: z.literal("move_channel"), channel: z.string(), raw: z.string() }),
  z.object({ kind: z.literal("promote_policy"), raw: z.string() }),
  z.object({ kind: z.literal("bind_trust"), url: z.string(), raw: z.string() }),
  z.object({ kind: z.literal("register_passkey"), raw: z.string() }),
  z.object({ kind: z.literal("shift_handoff"), raw: z.string() }),
  z.object({
    kind: z.literal("attenuate"),
    budgetUsd: z.number().optional(),
    ttlHours: z.number().optional(),
    raw: z.string(),
  }),
  z.object({ kind: z.literal("approve_proposal"), proposalId: z.string().optional(), raw: z.string() }),
  z.object({ kind: z.literal("deny_proposal"), proposalId: z.string().optional(), raw: z.string() }),
  z.object({ kind: z.literal("status"), target: z.string().optional(), raw: z.string() }),
  z.object({ kind: z.literal("evidence_export"), sinceHours: z.number().default(24), raw: z.string() }),
  z.object({ kind: z.literal("policy_draft"), description: z.string(), raw: z.string() }),
  z.object({ kind: z.literal("help"), raw: z.string() }),
  z.object({ kind: z.literal("unknown"), raw: z.string() }),
]);

export type Intent = z.infer<typeof Intent>;

const MONEY = /\$?(\d+(?:\.\d+)?)/;

function money(s: string): number | undefined {
  const m = s.match(MONEY);
  return m && m[1] ? Number(m[1]) : undefined;
}

function ttl(s: string): number | undefined {
  const m = s.match(/(\d+)\s*(h|hr|hour|hours|d|day|days)/i);
  if (!m || !m[1] || !m[2]) return undefined;
  const n = Number(m[1]);
  return m[2].toLowerCase().startsWith("d") ? n * 24 : n;
}

function stripAddress(raw: string): string {
  return raw
    .replace(/^\s*@?chio[,:\s]+/i, "")
    .replace(/^\s*hey\s+chio[,:\s]+/i, "")
    .trim();
}

/**
 * Parse a raw chat message into a discriminated `Intent`.
 *
 * Order matters: more-specific phrases are matched first. Every branch sets
 * `raw` so downstream UI can show the operator's original wording in the
 * approval card, the receipt, and the evidence bundle.
 */
export function parseIntent(text: string): Intent {
  const raw = text.trim();
  const stripped = stripAddress(raw);
  const t = stripped.toLowerCase();

  if (!t) return { kind: "unknown", raw };

  if (/^(help|what can you do|commands)\b/.test(t)) {
    return { kind: "help", raw };
  }

  // Passkey registration ("register my passkey", "enroll passkey").
  if (/\b(register|enroll|add)\b.*\bpasskey\b/.test(t) || /^passkey\s+(register|enroll)/.test(t)) {
    return { kind: "register_passkey", raw };
  }

  // Approve / deny a specific proposal by id — lets threads back-reference
  // pending cards from another channel.
  if (/\b(approve|countersign)\b.*\bproposal\b/.test(t)) {
    const m = stripped.match(/proposal[\s:]+([a-f0-9-]+)/i);
    return { kind: "approve_proposal", ...(m && m[1] ? { proposalId: m[1] } : {}), raw };
  }
  if (/\bdeny\b.*\bproposal\b/.test(t)) {
    const m = stripped.match(/proposal[\s:]+([a-f0-9-]+)/i);
    return { kind: "deny_proposal", ...(m && m[1] ? { proposalId: m[1] } : {}), raw };
  }

  // Revoke: "stop", "revoke", "tear down", "kill agent X".
  if (/\b(stop|revoke|kill|tear\s*down|shut\s*it\s*down)\b/.test(t)) {
    const m = stripped.match(/\b(?:agent|cap(?:ability)?|did)\s+([\w:.-]+)/i);
    return { kind: "revoke", ...(m && m[1] ? { target: m[1] } : {}), raw };
  }

  // Shift handoff: "rotate to next on-call", "shift handoff", "pass to @oncall".
  if (/\b(shift\s*(?:handoff|change)|rotate\s+(?:to\s+)?(?:next\s+)?on[\s-]?call|pass\s+to\s+oncall)\b/.test(t)) {
    return { kind: "shift_handoff", raw };
  }

  // Attenuate: "lower budget to $10", "cut ttl to 1h", "attenuate".
  if (/\battenuate\b/.test(t) || /\b(lower|cut|reduce)\b.*\b(budget|ttl)\b/.test(t)) {
    return {
      kind: "attenuate",
      ...(money(t) !== undefined ? { budgetUsd: money(t) } : {}),
      ...(ttl(t) !== undefined ? { ttlHours: ttl(t) } : {}),
      raw,
    };
  }

  // Bump budget: "bump budget by $25", "raise budget $40".
  if (
    /\bbump\b.*\bbudget\b/.test(t) ||
    /\bbudget\b.*\b(?:\+|up|raise|bump|add)\b/.test(t) ||
    /\b(raise|add)\b.*\bbudget\b/.test(t)
  ) {
    const delta = money(t) ?? 0;
    return { kind: "bump_budget", deltaUsd: delta, raw };
  }

  // Gate rule: "require approval for refunds over $100".
  if (/\brequire\b.*\bapproval\b/.test(t) || /\bgate\b/.test(t)) {
    return { kind: "require_approval", rule: stripped, raw };
  }

  // Post receipts: "post last 5 receipts", "show receipts".
  if (/\b(post|show|dump)\b.*\breceipts?\b/.test(t) || /\blast\b.*\breceipts?\b/.test(t)) {
    const m = t.match(/\b(\d+)\b/);
    return { kind: "post_receipts", n: m && m[1] ? Number(m[1]) : 5, raw };
  }

  // Move channel: "move agent to #ops-team".
  if (/\bmove\b.*\b(?:to|into)\b/.test(t)) {
    const m = stripped.match(/#([\w-]+)/);
    return { kind: "move_channel", channel: m && m[1] ? m[1] : "unknown", raw };
  }

  // Promote policy: "promote policy to live".
  if (/\bpromote\b.*(\bpolicy\b|\blive\b)/.test(t)) {
    return { kind: "promote_policy", raw };
  }

  // Bind trust plane: "bind trust to https://...".
  if (/\bbind\b.*\btrust\b/.test(t) || /\btrust\s+url\s+set\b/.test(t)) {
    const m = stripped.match(/https?:\/\/\S+/);
    return { kind: "bind_trust", url: m ? m[0] : "", raw };
  }

  // Status: "chio, status", "status of agent X".
  if (/^\s*status\b/.test(t) || /\bstatus\s+of\b/.test(t)) {
    const m = stripped.match(/\b(?:agent|did)\s+([\w:.-]+)/i);
    return { kind: "status", ...(m && m[1] ? { target: m[1] } : {}), raw };
  }

  // Evidence export: "export evidence last 24h".
  if (/\b(export|bundle)\b.*\bevidence\b/.test(t) || /\bevidence\s+(export|bundle)\b/.test(t)) {
    const m = t.match(/(\d+)\s*(h|hr|hour|hours|d|day|days)/i);
    let hours = 24;
    if (m && m[1] && m[2]) {
      hours = Number(m[1]) * (m[2].toLowerCase().startsWith("d") ? 24 : 1);
    }
    return { kind: "evidence_export", sinceHours: hours, raw };
  }

  // Draft policy: "draft a support-desk policy", "draft policy for X".
  if (/\bdraft\b.*\bpolicy\b/.test(t)) {
    return { kind: "policy_draft", description: stripped, raw };
  }

  // Bond: "bond an agent", "run X", "spin up Y", "ship Z".
  if (/\b(bond|run|ship|spin\s*up|start|launch)\b/.test(t)) {
    const nameMatch = t.match(
      /\b(?:for|to|a|an)\s+([a-z0-9_\-]+(?:\s+[a-z0-9_\-]+){0,3})/,
    );
    const name =
      nameMatch && nameMatch[1]
        ? nameMatch[1].trim().replace(/\s+/g, "_")
        : "agent";
    const toolServers: string[] = [];
    for (const m of stripped.matchAll(/\bmcp\/([\w.-]+)/gi)) {
      if (m[1]) toolServers.push(`mcp/${m[1]}`);
    }
    return {
      kind: "bond",
      name,
      ...(money(t) !== undefined ? { budgetUsd: money(t) } : {}),
      ...(ttl(t) !== undefined ? { ttlHours: ttl(t) } : {}),
      toolServers,
      raw,
    };
  }

  return { kind: "unknown", raw };
}

/**
 * Optional LLM fallback for phrasing the regex can't cover. The expected
 * response shape is the literal JSON of the `Intent` discriminated union.
 */
export async function parseIntentWithFallback(text: string): Promise<Intent> {
  const first = parseIntent(text);
  if (first.kind !== "unknown") return first;
  if (!config.CHIO_LLM_URL) return first;
  try {
    const res = await fetch(config.CHIO_LLM_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.CHIO_LLM_TOKEN
          ? { authorization: `Bearer ${config.CHIO_LLM_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return first;
    const data = (await res.json()) as unknown;
    const parsed = Intent.safeParse(data);
    return parsed.success ? parsed.data : first;
  } catch {
    return first;
  }
}
