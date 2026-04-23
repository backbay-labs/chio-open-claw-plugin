/**
 * Thin wrapper around `@chio/bridge`.
 *
 * The bridge is the library surface that talks to arc's trust plane (issue
 * capabilities, verify receipts, revoke passports). We expose the subset
 * OpenClaw needs and keep a lazy singleton so the rest of the plugin can
 * call `chio.issueCapability(...)` without plumbing.
 *
 * Construction:
 *   - `ChioBridge.fromDaemon({trustUrl, token, receiptDbPath})` for full
 *     wire-up (capability issuance, status, receipts, evidence export).
 *   - `ChioBridge.fromCli()` when the plugin runs next to the arc CLI but
 *     without a trust plane — still gives us policy lint + local passport.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ChioBridge,
  verifyReceiptValue,
  type ChioReceipt,
  type CapabilityToken,
  type CapabilityScope,
} from "@chio/bridge";
import { config } from "../config.js";

let bridge: ChioBridge | undefined;

function getBridge(): ChioBridge {
  if (bridge) return bridge;
  if (config.CHIO_TRUST_TOKEN) {
    bridge = ChioBridge.fromDaemon({
      trustUrl: config.CHIO_TRUST_URL,
      token: config.CHIO_TRUST_TOKEN,
      ...(config.CHIO_MCP_EDGE_URL ? { mcpEdgeUrl: config.CHIO_MCP_EDGE_URL } : {}),
      ...(config.CHIO_RECEIPT_DB ? { receiptDbPath: config.CHIO_RECEIPT_DB } : {}),
    });
  } else {
    bridge = ChioBridge.fromCli();
  }
  return bridge;
}

export interface PolicyDraft {
  name: string;
  scope: string;
  budgetUsd: number;
  ttlHours: number;
  gates: string[];
  toolServers: string[];
}

export interface IssuedCapability {
  id: string;
  did: string;
  subject: string;
  expiresAt: string;
  token: CapabilityToken;
}

/**
 * Issue a capability for an approved policy proposal.
 *
 * The proposal-scope translation is deliberately simple: we grant the
 * specified tool_servers with a total-budget cap, for the TTL window.
 * The real bridge takes the scope + ttl and POSTs it to
 * `/v1/capabilities/issue` on the trust plane, returning a real signed
 * `CapabilityToken` with a `did:chio:` subject.
 */
export async function issueCapabilityForDraft(
  subjectDid: string,
  draft: PolicyDraft,
): Promise<IssuedCapability> {
  // chio's MonetaryAmount uses (units, currency) where units is the smallest
  // denomination (cents for USD). Avoid floats — convert to integer cents.
  const cents = Math.round(draft.budgetUsd * 100);
  const scope: CapabilityScope = {
    grants: draft.toolServers.map((serverId) => ({
      server_id: serverId,
      tool_name: "*",
      operations: ["invoke"],
      max_total_cost: { units: cents, currency: "USD" } as unknown as number,
    })),
  };
  const ttl = `${Math.max(1, Math.floor(draft.ttlHours))}h`;
  const token = await getBridge().issueCapability({
    subject: subjectDid,
    scope,
    ttl,
  });

  const tk = token as CapabilityToken & {
    id?: string;
    subject?: string;
    expires_at?: string | number;
  };
  const expiresAt =
    typeof tk.expires_at === "number"
      ? new Date(tk.expires_at * 1000).toISOString()
      : typeof tk.expires_at === "string"
        ? tk.expires_at
        : "";
  return {
    id: String(tk.id ?? ""),
    did: subjectDid,
    subject: String(tk.subject ?? subjectDid),
    expiresAt,
    token,
  };
}

/**
 * Mint a fresh subject passport the first time a proposal reaches quorum.
 *
 * The trust plane requires a `did:chio:` subject before it will issue a
 * capability. When the bridge is in daemon mode and has a receipt DB,
 * `createPassport()` walks the real chio CLI flow:
 *   `chio passport create --subject-public-key ... --output ... --signing-seed-file ...`
 *   → `POST {trustUrl}/v1/passport/statuses`
 * and returns the published `did:chio:{subject}`. In CLI-only mode it still
 * mints the passport locally; capability issuance will be skipped but a
 * well-formed DID is still produced for audit + deep links.
 */
export async function mintSubjectPassport(): Promise<{ did: string; passportId?: string }> {
  const b = getBridge();
  const passport = await b.createPassport();
  return {
    did: passport.did,
    ...(passport.passportId ? { passportId: passport.passportId } : {}),
  };
}

export async function revoke(didOrPassportId: string): Promise<void> {
  await getBridge().revoke(didOrPassportId);
}

export async function listReceiptsForAgent(
  _agent: string,
  limit = 50,
): Promise<ChioReceipt[]> {
  return getBridge().receipts({ limit });
}

export function verifyReceiptJson(value: unknown): boolean {
  try {
    return verifyReceiptValue(
      typeof value === "string" ? value : (value as ChioReceipt),
    );
  } catch {
    return false;
  }
}

/**
 * Best-effort policy lint: writes a temp YAML file and asks the bridge to
 * parse+lint via `@chio/bridge.lintPolicy`. Returns the issues flat. The
 * approval state machine does not block on warnings; errors are surfaced
 * into the approval card so signers see what the policy draft is missing.
 */
export async function lintDraft(draft: PolicyDraft): Promise<{
  errors: { path: string; message: string }[];
  warnings: { path: string; message: string }[];
}> {
  const b = getBridge();
  const yaml = draftToHushspec(draft);
  const dir = join(tmpdir(), `openclaw-lint-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${draft.name}.yaml`);
  await writeFile(path, yaml, "utf8");
  try {
    const spec = await b.loadPolicy(path);
    const report = await b.lintPolicy(spec);
    return {
      errors: report.errors.map((e) => ({ path: e.path, message: e.message })),
      warnings: report.warnings.map((e) => ({
        path: e.path,
        message: e.message,
      })),
    };
  } catch (e) {
    return {
      errors: [{ path: "$", message: (e as Error).message }],
      warnings: [],
    };
  }
}

export function draftToHushspec(draft: PolicyDraft): string {
  // Minimal HushSpec 0.1.0 that arc-policy's deny_unknown_fields parser
  // actually accepts. Stick to real rule keys: tool_access, egress,
  // forbidden_paths, path_allowlist.
  const allow = draft.toolServers.map((s) => `          - ${s}/*`).join("\n");
  return `hushspec: "0.1.0"
name: ${JSON.stringify(draft.name)}
description: ${JSON.stringify(draft.scope)}
rules:
  tool_access:
    enabled: true
    default: block
    allow:
${allow || "          - []"}
  egress:
    enabled: true
    default: block
    allow: []
metadata:
  budget_usd: ${draft.budgetUsd}
  ttl_hours: ${draft.ttlHours}
  gates: ${JSON.stringify(draft.gates)}
`;
}

export function _resetBridgeForTests(): void {
  bridge = undefined;
}
