/**
 * SQLite-backed storage for OpenClaw.
 *
 * Backs: passkey credentials, in-flight policy proposals, verified
 * countersignatures, platform team-token bindings, subscription mappings,
 * WebAuthn challenges (registration + authentication).
 *
 * Replaces the previous in-memory `Map` approach so that proposals, quorum
 * state, and registered credentials survive restart — critical because a
 * countersign URL handed to a user in Slack is useless if the in-flight
 * proposal disappears the moment the bot restarts.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

export interface StoredCredential {
  credentialId: string; // base64url
  publicKey: string; // base64url COSE key
  counter: number;
  transports: string | null; // JSON-encoded string[]
  userId: string; // platform-prefixed, e.g. "slack:U12345"
  userHandle: string;
  platform: string;
  createdAt: string;
}

export interface StoredProposal {
  id: string;
  surface: string;
  channelId: string;
  threadId: string;
  proposerId: string;
  draft: string; // JSON
  quorum: number;
  totalSigners: number;
  decision: string;
  capabilityId: string | null;
  capabilityDid: string | null;
  createdAt: string;
}

export interface StoredCountersignature {
  proposalId: string;
  credentialId: string;
  userId: string;
  userHandle: string;
  platform: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  userHandleBlob: string | null;
  verifiedAt: string;
}

export interface StoredSubscription {
  surface: string;
  channelId: string;
  threadId: string;
  agent: string;
}

export interface StoredTeamToken {
  platform: string;
  teamId: string;
  botToken: string | null;
  installPayload: string; // full OAuth payload JSON
  installedAt: string;
}

export interface StoredChallenge {
  id: string; // e.g. `reg:${userId}` or `auth:${proposalId}:${userId}`
  challenge: string;
  purpose: "registration" | "authentication";
  context: string | null; // JSON metadata
  expiresAt: number; // epoch ms
}

let db: Database.Database | null = null;

function open(): Database.Database {
  if (db) return db;
  const path = config.DATABASE_PATH;
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    // dir exists
  }
  const handle = new Database(path);
  handle.pragma("journal_mode = WAL");
  handle.pragma("foreign_keys = ON");
  migrate(handle);
  db = handle;
  return db;
}

function migrate(h: Database.Database): void {
  h.exec(`
    CREATE TABLE IF NOT EXISTS credentials (
      credential_id TEXT PRIMARY KEY,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL,
      transports TEXT,
      user_id TEXT NOT NULL,
      user_handle TEXT NOT NULL,
      platform TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials (user_id);

    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      surface TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      proposer_id TEXT NOT NULL,
      draft TEXT NOT NULL,
      quorum INTEGER NOT NULL,
      total_signers INTEGER NOT NULL,
      decision TEXT NOT NULL,
      capability_id TEXT,
      capability_did TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS countersignatures (
      proposal_id TEXT NOT NULL,
      credential_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_handle TEXT NOT NULL,
      platform TEXT NOT NULL,
      client_data_json TEXT NOT NULL,
      authenticator_data TEXT NOT NULL,
      signature TEXT NOT NULL,
      user_handle_blob TEXT,
      verified_at TEXT NOT NULL,
      PRIMARY KEY (proposal_id, credential_id),
      FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_signatures_proposal ON countersignatures (proposal_id);

    CREATE TABLE IF NOT EXISTS denials (
      proposal_id TEXT NOT NULL,
      credential_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_handle TEXT NOT NULL,
      platform TEXT NOT NULL,
      client_data_json TEXT NOT NULL,
      authenticator_data TEXT NOT NULL,
      signature TEXT NOT NULL,
      user_handle_blob TEXT,
      verified_at TEXT NOT NULL,
      PRIMARY KEY (proposal_id, credential_id)
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      surface TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      agent TEXT NOT NULL,
      PRIMARY KEY (surface, thread_id, agent)
    );
    CREATE INDEX IF NOT EXISTS idx_subs_agent ON subscriptions (agent);

    CREATE TABLE IF NOT EXISTS team_tokens (
      platform TEXT NOT NULL,
      team_id TEXT NOT NULL,
      bot_token TEXT,
      install_payload TEXT NOT NULL,
      installed_at TEXT NOT NULL,
      PRIMARY KEY (platform, team_id)
    );

    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      challenge TEXT NOT NULL,
      purpose TEXT NOT NULL,
      context TEXT,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_challenges_exp ON challenges (expires_at);

    CREATE TABLE IF NOT EXISTS countersign_tokens (
      token TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE
    );
  `);
}

// ─── credentials ────────────────────────────────────────────────────────────
export function putCredential(c: StoredCredential): void {
  const h = open();
  h.prepare(
    `INSERT INTO credentials (credential_id, public_key, counter, transports, user_id, user_handle, platform, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(credential_id) DO UPDATE SET counter = excluded.counter`,
  ).run(
    c.credentialId,
    c.publicKey,
    c.counter,
    c.transports,
    c.userId,
    c.userHandle,
    c.platform,
    c.createdAt,
  );
}

export function getCredential(credentialId: string): StoredCredential | undefined {
  const row = open()
    .prepare(`SELECT * FROM credentials WHERE credential_id = ?`)
    .get(credentialId) as Record<string, unknown> | undefined;
  return row ? rowToCredential(row) : undefined;
}

export function listCredentialsForUser(userId: string): StoredCredential[] {
  const rows = open()
    .prepare(`SELECT * FROM credentials WHERE user_id = ?`)
    .all(userId) as Record<string, unknown>[];
  return rows.map(rowToCredential);
}

export function updateCredentialCounter(credentialId: string, counter: number): void {
  open()
    .prepare(`UPDATE credentials SET counter = ? WHERE credential_id = ?`)
    .run(counter, credentialId);
}

function rowToCredential(r: Record<string, unknown>): StoredCredential {
  return {
    credentialId: String(r.credential_id),
    publicKey: String(r.public_key),
    counter: Number(r.counter),
    transports: r.transports == null ? null : String(r.transports),
    userId: String(r.user_id),
    userHandle: String(r.user_handle),
    platform: String(r.platform),
    createdAt: String(r.created_at),
  };
}

// ─── proposals ──────────────────────────────────────────────────────────────
export function putProposal(p: StoredProposal): void {
  open()
    .prepare(
      `INSERT OR REPLACE INTO proposals
        (id, surface, channel_id, thread_id, proposer_id, draft, quorum, total_signers, decision, capability_id, capability_did, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      p.id,
      p.surface,
      p.channelId,
      p.threadId,
      p.proposerId,
      p.draft,
      p.quorum,
      p.totalSigners,
      p.decision,
      p.capabilityId,
      p.capabilityDid,
      p.createdAt,
    );
}

export function getProposal(id: string): StoredProposal | undefined {
  const row = open()
    .prepare(`SELECT * FROM proposals WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToProposal(row) : undefined;
}

export function updateProposalDecision(
  id: string,
  decision: string,
  capabilityId: string | null,
  capabilityDid: string | null,
): void {
  open()
    .prepare(
      `UPDATE proposals SET decision = ?, capability_id = ?, capability_did = ? WHERE id = ?`,
    )
    .run(decision, capabilityId, capabilityDid, id);
}

export function updateProposalDraft(id: string, draftJson: string): void {
  open().prepare(`UPDATE proposals SET draft = ? WHERE id = ?`).run(draftJson, id);
}

function rowToProposal(r: Record<string, unknown>): StoredProposal {
  return {
    id: String(r.id),
    surface: String(r.surface),
    channelId: String(r.channel_id),
    threadId: String(r.thread_id),
    proposerId: String(r.proposer_id),
    draft: String(r.draft),
    quorum: Number(r.quorum),
    totalSigners: Number(r.total_signers),
    decision: String(r.decision),
    capabilityId: r.capability_id == null ? null : String(r.capability_id),
    capabilityDid: r.capability_did == null ? null : String(r.capability_did),
    createdAt: String(r.created_at),
  };
}

// ─── countersignatures / denials ────────────────────────────────────────────
export function putCountersignature(c: StoredCountersignature): boolean {
  const res = open()
    .prepare(
      `INSERT OR IGNORE INTO countersignatures
       (proposal_id, credential_id, user_id, user_handle, platform,
        client_data_json, authenticator_data, signature, user_handle_blob, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      c.proposalId,
      c.credentialId,
      c.userId,
      c.userHandle,
      c.platform,
      c.clientDataJSON,
      c.authenticatorData,
      c.signature,
      c.userHandleBlob,
      c.verifiedAt,
    );
  return res.changes > 0;
}

export function listCountersignatures(proposalId: string): StoredCountersignature[] {
  const rows = open()
    .prepare(`SELECT * FROM countersignatures WHERE proposal_id = ?`)
    .all(proposalId) as Record<string, unknown>[];
  return rows.map(rowToCountersignature);
}

export function putDenial(c: StoredCountersignature): boolean {
  const res = open()
    .prepare(
      `INSERT OR IGNORE INTO denials
       (proposal_id, credential_id, user_id, user_handle, platform,
        client_data_json, authenticator_data, signature, user_handle_blob, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      c.proposalId,
      c.credentialId,
      c.userId,
      c.userHandle,
      c.platform,
      c.clientDataJSON,
      c.authenticatorData,
      c.signature,
      c.userHandleBlob,
      c.verifiedAt,
    );
  return res.changes > 0;
}

export function listDenials(proposalId: string): StoredCountersignature[] {
  const rows = open()
    .prepare(`SELECT * FROM denials WHERE proposal_id = ?`)
    .all(proposalId) as Record<string, unknown>[];
  return rows.map(rowToCountersignature);
}

function rowToCountersignature(r: Record<string, unknown>): StoredCountersignature {
  return {
    proposalId: String(r.proposal_id),
    credentialId: String(r.credential_id),
    userId: String(r.user_id),
    userHandle: String(r.user_handle),
    platform: String(r.platform),
    clientDataJSON: String(r.client_data_json),
    authenticatorData: String(r.authenticator_data),
    signature: String(r.signature),
    userHandleBlob: r.user_handle_blob == null ? null : String(r.user_handle_blob),
    verifiedAt: String(r.verified_at),
  };
}

// ─── subscriptions ──────────────────────────────────────────────────────────
export function putSubscription(s: StoredSubscription): void {
  open()
    .prepare(
      `INSERT OR IGNORE INTO subscriptions (surface, channel_id, thread_id, agent)
       VALUES (?, ?, ?, ?)`,
    )
    .run(s.surface, s.channelId, s.threadId, s.agent);
}

export function listSubscriptionsForAgent(agent: string): StoredSubscription[] {
  const rows = open()
    .prepare(`SELECT * FROM subscriptions WHERE agent = ?`)
    .all(agent) as Record<string, unknown>[];
  return rows.map((r) => ({
    surface: String(r.surface),
    channelId: String(r.channel_id),
    threadId: String(r.thread_id),
    agent: String(r.agent),
  }));
}

export function removeSubscriptionsForAgent(agent: string): void {
  open().prepare(`DELETE FROM subscriptions WHERE agent = ?`).run(agent);
}

// ─── team tokens ────────────────────────────────────────────────────────────
export function putTeamToken(t: StoredTeamToken): void {
  open()
    .prepare(
      `INSERT OR REPLACE INTO team_tokens (platform, team_id, bot_token, install_payload, installed_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(t.platform, t.teamId, t.botToken, t.installPayload, t.installedAt);
}

export function getTeamToken(platform: string, teamId: string): StoredTeamToken | undefined {
  const row = open()
    .prepare(`SELECT * FROM team_tokens WHERE platform = ? AND team_id = ?`)
    .get(platform, teamId) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return {
    platform: String(row.platform),
    teamId: String(row.team_id),
    botToken: row.bot_token == null ? null : String(row.bot_token),
    installPayload: String(row.install_payload),
    installedAt: String(row.installed_at),
  };
}

// ─── challenges ─────────────────────────────────────────────────────────────
export function putChallenge(c: StoredChallenge): void {
  open()
    .prepare(
      `INSERT OR REPLACE INTO challenges (id, challenge, purpose, context, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(c.id, c.challenge, c.purpose, c.context, c.expiresAt);
}

export function getChallenge(id: string): StoredChallenge | undefined {
  const row = open()
    .prepare(`SELECT * FROM challenges WHERE id = ? AND expires_at > ?`)
    .get(id, Date.now()) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return {
    id: String(row.id),
    challenge: String(row.challenge),
    purpose: row.purpose as StoredChallenge["purpose"],
    context: row.context == null ? null : String(row.context),
    expiresAt: Number(row.expires_at),
  };
}

export function consumeChallenge(id: string): void {
  open().prepare(`DELETE FROM challenges WHERE id = ?`).run(id);
}

export function pruneExpiredChallenges(): void {
  open().prepare(`DELETE FROM challenges WHERE expires_at <= ?`).run(Date.now());
}

// ─── countersign tokens (one-time URL binding) ──────────────────────────────
export function putCountersignToken(
  token: string,
  proposalId: string,
  platform: string,
  userId: string,
  ttlMs: number,
): void {
  open()
    .prepare(
      `INSERT OR REPLACE INTO countersign_tokens
       (token, proposal_id, platform, user_id, expires_at, consumed)
       VALUES (?, ?, ?, ?, ?, 0)`,
    )
    .run(token, proposalId, platform, userId, Date.now() + ttlMs);
}

export function getCountersignToken(token: string): {
  proposalId: string;
  platform: string;
  userId: string;
  consumed: boolean;
} | undefined {
  const row = open()
    .prepare(
      `SELECT * FROM countersign_tokens WHERE token = ? AND expires_at > ?`,
    )
    .get(token, Date.now()) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return {
    proposalId: String(row.proposal_id),
    platform: String(row.platform),
    userId: String(row.user_id),
    consumed: Number(row.consumed) !== 0,
  };
}

export function markCountersignTokenConsumed(token: string): void {
  open()
    .prepare(`UPDATE countersign_tokens SET consumed = 1 WHERE token = ?`)
    .run(token);
}

// test-only: reset db handle (so tests can swap DATABASE_PATH)
export function _resetForTests(): void {
  if (db) {
    db.close();
    db = null;
  }
}
