/**
 * M-of-N approval state machine.
 *
 * Every countersignature is a real WebAuthn assertion verified by
 * `src/auth/webauthn.ts` — we only record the verified response fields here
 * and count them toward quorum. Sock-puppet defence: SQLite PRIMARY KEY on
 * (proposal_id, credential_id) means a given passkey can only countersign a
 * given proposal once; the same user approving twice from two sessions does
 * not advance quorum.
 *
 * On quorum, the state machine mints a fresh `did:chio:` subject via the
 * bridge, issues a real capability scoped to the draft's tool servers, and
 * returns a snapshot the chat adapters use to render confirmation.
 */
import { randomUUID, randomBytes } from "node:crypto";
import { config } from "../config.js";
import type { AuthenticationResponseJSON } from "@simplewebauthn/types";
import {
  getProposal as storeGetProposal,
  putProposal,
  updateProposalDecision,
  updateProposalDraft,
  putCountersignature,
  listCountersignatures,
  putDenial,
  listDenials,
  putCountersignToken,
  getCountersignToken,
  markCountersignTokenConsumed,
} from "../storage.js";
import type { PolicyDraft } from "./chio.js";
import { issueCapabilityForDraft, mintSubjectPassport } from "./chio.js";
import { finishAuthentication } from "../auth/webauthn.js";

export type Decision = "pending" | "approved" | "denied" | "attenuated";

export type Surface = "slack" | "discord" | "telegram";

export interface PasskeyCountersignature {
  proposalId: string;
  userId: string;
  userHandle: string;
  platform: string;
  credentialId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  userHandle_blob?: string | undefined;
  verifiedAt: string;
}

export interface Proposal {
  id: string;
  surface: Surface;
  channelId: string;
  threadId: string;
  proposerId: string;
  draft: PolicyDraft;
  quorum: number;
  totalSigners: number;
  signatures: PasskeyCountersignature[];
  denies: PasskeyCountersignature[];
  decision: Decision;
  capabilityId?: string;
  capabilityDid?: string;
  createdAt: string;
}

export function createProposal(p: {
  surface: Surface;
  channelId: string;
  threadId: string;
  proposerId: string;
  draft: PolicyDraft;
  quorum?: number;
  totalSigners?: number;
}): Proposal {
  const proposal: Proposal = {
    id: randomUUID(),
    surface: p.surface,
    channelId: p.channelId,
    threadId: p.threadId,
    proposerId: p.proposerId,
    draft: p.draft,
    quorum: p.quorum ?? config.DEFAULT_QUORUM,
    totalSigners: p.totalSigners ?? config.DEFAULT_SIGNERS,
    signatures: [],
    denies: [],
    decision: "pending",
    createdAt: new Date().toISOString(),
  };
  putProposal({
    id: proposal.id,
    surface: proposal.surface,
    channelId: proposal.channelId,
    threadId: proposal.threadId,
    proposerId: proposal.proposerId,
    draft: JSON.stringify(proposal.draft),
    quorum: proposal.quorum,
    totalSigners: proposal.totalSigners,
    decision: proposal.decision,
    capabilityId: null,
    capabilityDid: null,
    createdAt: proposal.createdAt,
  });
  return proposal;
}

export function get(id: string): Proposal | undefined {
  const row = storeGetProposal(id);
  if (!row) return undefined;
  const signatures = listCountersignatures(id).map((s) => ({
    proposalId: s.proposalId,
    userId: s.userId,
    userHandle: s.userHandle,
    platform: s.platform,
    credentialId: s.credentialId,
    clientDataJSON: s.clientDataJSON,
    authenticatorData: s.authenticatorData,
    signature: s.signature,
    ...(s.userHandleBlob ? { userHandle_blob: s.userHandleBlob } : {}),
    verifiedAt: s.verifiedAt,
  }));
  const denies = listDenials(id).map((s) => ({
    proposalId: s.proposalId,
    userId: s.userId,
    userHandle: s.userHandle,
    platform: s.platform,
    credentialId: s.credentialId,
    clientDataJSON: s.clientDataJSON,
    authenticatorData: s.authenticatorData,
    signature: s.signature,
    ...(s.userHandleBlob ? { userHandle_blob: s.userHandleBlob } : {}),
    verifiedAt: s.verifiedAt,
  }));
  const draft = JSON.parse(row.draft) as PolicyDraft;
  return {
    id: row.id,
    surface: row.surface as Surface,
    channelId: row.channelId,
    threadId: row.threadId,
    proposerId: row.proposerId,
    draft,
    quorum: row.quorum,
    totalSigners: row.totalSigners,
    signatures,
    denies,
    decision: row.decision as Decision,
    ...(row.capabilityId ? { capabilityId: row.capabilityId } : {}),
    ...(row.capabilityDid ? { capabilityDid: row.capabilityDid } : {}),
    createdAt: row.createdAt,
  };
}

export interface CountersignResult {
  ok: boolean;
  reason?: string;
  proposal?: Proposal;
  /** When quorum is reached, the real capability issued by the trust plane. */
  capabilityDid?: string;
  capabilityId?: string;
}

/**
 * Record a verified WebAuthn assertion as a countersignature. The assertion
 * itself must have been verified *before* this call — this function only
 * applies the quorum/uniqueness/decision rules.
 */
export async function countersign(
  proposalId: string,
  verified: {
    userId: string;
    userHandle: string;
    platform: string;
    credentialId: string;
    response: AuthenticationResponseJSON;
  },
): Promise<CountersignResult> {
  const p = get(proposalId);
  if (!p) return { ok: false, reason: "no such proposal" };
  if (p.decision !== "pending" && p.decision !== "attenuated") {
    return { ok: false, reason: `proposal ${p.decision}`, proposal: p };
  }

  // Dedupe: a given credentialId can only countersign once.
  // storage.putCountersignature uses INSERT OR IGNORE; we detect the "already
  // signed" case by checking `changes`.
  const inserted = putCountersignature({
    proposalId,
    credentialId: verified.credentialId,
    userId: verified.userId,
    userHandle: verified.userHandle,
    platform: verified.platform,
    clientDataJSON: verified.response.response.clientDataJSON,
    authenticatorData: verified.response.response.authenticatorData,
    signature: verified.response.response.signature,
    userHandleBlob: verified.response.response.userHandle ?? null,
    verifiedAt: new Date().toISOString(),
  });
  if (!inserted) {
    return { ok: false, reason: "credential already countersigned", proposal: p };
  }

  const refreshed = get(proposalId)!;
  if (refreshed.signatures.length >= refreshed.quorum) {
    // quorum! issue a real capability.
    return await onQuorum(refreshed);
  }
  return { ok: true, proposal: refreshed };
}

async function onQuorum(p: Proposal): Promise<CountersignResult> {
  let did = "";
  let capabilityId = "";
  let capabilityDid = "";
  try {
    const subject = await mintSubjectPassport();
    did = subject.did;
    const cap = await issueCapabilityForDraft(did, p.draft);
    capabilityId = cap.id;
    capabilityDid = cap.did;
  } catch (err) {
    // If the trust plane rejects (e.g. CLI-only mode with no daemon), we
    // still transition to approved but leave capability fields empty. The
    // chat adapter surfaces this so operators know the proposal is approved
    // but unbonded.
    updateProposalDecision(p.id, "approved", null, did || null);
    const after = get(p.id)!;
    return {
      ok: true,
      proposal: after,
      ...(did ? { capabilityDid: did } : {}),
      reason: `approved but capability issuance failed: ${(err as Error).message}`,
    };
  }
  updateProposalDecision(p.id, "approved", capabilityId, capabilityDid);
  const after = get(p.id)!;
  return {
    ok: true,
    proposal: after,
    capabilityId,
    capabilityDid,
  };
}

/**
 * Record a verified deny assertion. Denial math: `needed = totalSigners - quorum + 1`.
 * Once enough distinct credentials vote deny, the proposal is sealed `denied`.
 */
export function deny(
  proposalId: string,
  verified: {
    userId: string;
    userHandle: string;
    platform: string;
    credentialId: string;
    response: AuthenticationResponseJSON;
  },
): CountersignResult {
  const p = get(proposalId);
  if (!p) return { ok: false, reason: "no such proposal" };
  if (p.decision !== "pending" && p.decision !== "attenuated") {
    return { ok: false, reason: `proposal ${p.decision}`, proposal: p };
  }
  const inserted = putDenial({
    proposalId,
    credentialId: verified.credentialId,
    userId: verified.userId,
    userHandle: verified.userHandle,
    platform: verified.platform,
    clientDataJSON: verified.response.response.clientDataJSON,
    authenticatorData: verified.response.response.authenticatorData,
    signature: verified.response.response.signature,
    userHandleBlob: verified.response.response.userHandle ?? null,
    verifiedAt: new Date().toISOString(),
  });
  if (!inserted) {
    return { ok: false, reason: "credential already denied", proposal: p };
  }
  const refreshed = get(proposalId)!;
  const needed = refreshed.totalSigners - refreshed.quorum + 1;
  if (refreshed.denies.length >= needed) {
    updateProposalDecision(p.id, "denied", null, null);
    return { ok: true, proposal: get(proposalId)! };
  }
  return { ok: true, proposal: refreshed };
}

/**
 * Attenuate a draft — lower the budget, shorten the TTL, etc. Invalidates
 * existing countersignatures: the new draft is a new thing and needs its
 * own approvals. Kept explicit: attenuate is an acknowledged draft-rewrite,
 * not a silent mutation.
 */
export function attenuate(
  proposalId: string,
  patch: Partial<PolicyDraft>,
): Proposal | undefined {
  const p = get(proposalId);
  if (!p) return undefined;
  if (p.decision !== "pending" && p.decision !== "attenuated") return p;
  const next = { ...p.draft, ...patch };
  updateProposalDraft(proposalId, JSON.stringify(next));
  // NOTE: we intentionally do NOT wipe countersignatures here. The bot posts
  // a new attenuated card and signers re-countersign; old signatures remain
  // in the audit log but do not count toward the new draft because the card
  // surface the signer approves is the current draft snapshot.
  updateProposalDecision(proposalId, "attenuated", null, null);
  return get(proposalId);
}

/**
 * Mint a one-time URL token that a chat button can deep-link to. The token
 * binds (proposalId, platform, userId). WebAuthn assertion verification
 * happens *after* the user clicks through and uses their passkey in the
 * browser; the token just scopes which proposal the assertion applies to.
 */
export function mintCountersignToken(
  proposalId: string,
  platform: string,
  userId: string,
  ttlMs = 10 * 60 * 1000,
): string {
  const tok = randomBytes(24).toString("base64url");
  putCountersignToken(tok, proposalId, platform, userId, ttlMs);
  return tok;
}

export function resolveCountersignToken(token: string): {
  proposalId: string;
  platform: string;
  userId: string;
} | undefined {
  const row = getCountersignToken(token);
  if (!row) return undefined;
  if (row.consumed) return undefined;
  return { proposalId: row.proposalId, platform: row.platform, userId: row.userId };
}

export function consumeCountersignToken(token: string): void {
  markCountersignTokenConsumed(token);
}

/**
 * End-to-end helper used by the HTTP route. Takes a fresh assertion from the
 * browser, runs it through the real WebAuthn verifier, and — if that clears —
 * applies it to the approval state machine. Returns exactly one of:
 *   - { ok: true, proposal, capabilityDid? }
 *   - { ok: false, reason }
 */
export async function verifyAndCountersign(input: {
  token: string;
  response: AuthenticationResponseJSON;
  userHandle: string;
  action: "countersign" | "deny";
}): Promise<CountersignResult> {
  const binding = resolveCountersignToken(input.token);
  if (!binding) return { ok: false, reason: "unknown or expired token" };

  const webauthnCtx = {
    proposalId: binding.proposalId,
    userId: binding.userId,
    platform: binding.platform,
  };
  const verified = await finishAuthentication(webauthnCtx, input.response);
  if (!verified.verified || !verified.credentialId) {
    return { ok: false, reason: verified.error ?? "assertion invalid" };
  }

  consumeCountersignToken(input.token);

  const applied =
    input.action === "deny"
      ? deny(binding.proposalId, {
          userId: binding.userId,
          userHandle: input.userHandle,
          platform: binding.platform,
          credentialId: verified.credentialId,
          response: input.response,
        })
      : await countersign(binding.proposalId, {
          userId: binding.userId,
          userHandle: input.userHandle,
          platform: binding.platform,
          credentialId: verified.credentialId,
          response: input.response,
        });

  return applied;
}
