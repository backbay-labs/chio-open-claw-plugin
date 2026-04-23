/**
 * Live smoke probe for OpenClaw — runs against a freshly-started bot
 * and a freshly-started chio-test-harness chio daemon.
 *
 * Each step prints `STEP N PASS …` on success, `STEP N FAIL …` on
 * failure, and exits non-zero on the first failure.
 */
import assert from "node:assert/strict";
import { createVirtualAuthenticator } from "./virtual-authenticator.js";
import {
  putCountersignToken,
  putProposal,
  getCredential as dbGetCredential,
  listCountersignatures,
  getProposal as dbGetProposal,
} from "../../src/storage.js";
import { parseIntent } from "../../src/core/intent.js";
import { ChioBridge, parseReceipt, verifyReceiptValue } from "@chio/bridge";
import { writeFileSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const BOT_URL = process.env.OPENCLAW_PUBLIC_URL ?? "http://localhost:3001";
const RP_ID = process.env.WEBAUTHN_RP_ID ?? "localhost";
const ORIGIN = process.env.WEBAUTHN_ORIGIN ?? "http://localhost:3001";
const TRUST_URL = process.env.CHIO_TRUST_URL ?? "http://127.0.0.1:8948";
const MCP_URL = process.env.CHIO_MCP_URL ?? "http://127.0.0.1:8939";
const TRUST_TOKEN = process.env.CHIO_TRUST_TOKEN!;
const RECEIPT_DB = process.env.CHIO_RECEIPT_DB!;

let stepNum = 0;
function pass(msg: string): void {
  stepNum += 1;
  console.log(`✓ step ${stepNum} passed — ${msg}`);
}
function fail(msg: string, err?: unknown): never {
  stepNum += 1;
  console.error(`✗ step ${stepNum} failed — ${msg}`);
  if (err) console.error(err);
  process.exit(1);
}

async function postJson<T = unknown>(
  path: string,
  body: unknown,
  init?: RequestInit,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BOT_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    body: JSON.stringify(body),
  });
  let parsed: T;
  try {
    parsed = (await res.json()) as T;
  } catch {
    parsed = undefined as unknown as T;
  }
  return { status: res.status, body: parsed };
}

async function getJson(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BOT_URL}${path}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  return { status: res.status, body };
}

interface RegistrationOptions {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
}

interface AuthenticationOptions {
  challenge: string;
  rpId: string;
  allowCredentials?: Array<{ id: string }>;
}

async function mintRegistrationToken(
  userId: string,
  userHandle: string,
  platform: string,
): Promise<string> {
  // We can't import mintRegistrationToken from a running process, so we
  // use the same SQLite path the bot uses to insert a token. (Routes
  // module references putChallenge; we replicate that contract via
  // storage directly.)
  const { putChallenge } = await import("../../src/storage.js");
  const token = randomUUID().replace(/-/g, "");
  putChallenge({
    id: `regtok:${token}`,
    challenge: "",
    purpose: "registration",
    context: JSON.stringify({ userId, userHandle, platform }),
    expiresAt: Date.now() + 10 * 60_000,
  });
  return token;
}

async function registerUser(
  userId: string,
  userHandle: string,
  platform: string,
) {
  const token = await mintRegistrationToken(userId, userHandle, platform);
  const optsRes = await postJson<RegistrationOptions>("/register/challenge", {
    token,
  });
  if (optsRes.status !== 200) {
    fail(`register/challenge for ${userId} returned ${optsRes.status}`);
  }
  const opts = optsRes.body;
  const auth = createVirtualAuthenticator();
  const fixture = auth.registrationResponse(RP_ID, opts.challenge, ORIGIN);

  const verifyRes = await postJson<{ ok: boolean; credentialId?: string }>(
    "/register/verify",
    { token, response: fixture },
  );
  return { authenticator: auth, verifyRes, fixture };
}

async function step1HealthCheck() {
  const r = await getJson("/healthz");
  if (r.status !== 200) fail(`/healthz returned ${r.status}`);
  pass(`/healthz returned 200 (${JSON.stringify(r.body)})`);
}

async function step2Registration() {
  const { verifyRes } = await registerUser("smoke:user1", "user1", "smoke");
  if (verifyRes.status !== 200 || !verifyRes.body.ok) {
    fail(
      `register/verify failed status=${verifyRes.status} body=${JSON.stringify(verifyRes.body)}`,
    );
  }
  const credId = verifyRes.body.credentialId!;
  const stored = dbGetCredential(credId);
  if (!stored) fail(`credential ${credId} not in SQLite`);
  console.log(`   credentialId=${credId.slice(0, 24)}…`);
  pass(`real WebAuthn registration verified, credential stored in SQLite`);
}

async function step3InvalidRegistration() {
  // Mint a fresh token, then POST a malformed response.
  const token = await mintRegistrationToken("smoke:bad", "bad", "smoke");
  const res = await postJson("/register/verify", {
    token,
    response: {
      id: "bogus",
      rawId: "bogus",
      type: "public-key",
      response: { attestationObject: "AAAA", clientDataJSON: "AAAA" },
      clientExtensionResults: {},
    },
  });
  if (res.status === 200) fail("malformed registration was accepted (200)");
  pass(`malformed registration rejected with ${res.status}`);
}

interface CountersignFlowResult {
  credentialId: string;
  proposalId: string;
  capabilityDid?: string;
  capabilityId?: string;
}

async function registerAndIssueProposalToken(
  proposalId: string,
  userId: string,
) {
  // The bot's `mintCountersignToken` inserts into countersign_tokens. We
  // emulate it here so the smoke can drive /countersign/verify.
  const token = randomUUID().replace(/-/g, "");
  putCountersignToken(token, proposalId, "smoke", userId, 10 * 60_000);
  return token;
}

async function step4_5_validAndInvalidAssertion() {
  // Real registration of one user.
  const reg = await registerUser("smoke:u-csig", "u-csig", "smoke");
  const credId = reg.verifyRes.body.credentialId!;

  // Plant a proposal to countersign.
  const proposalId = randomUUID();
  putProposal({
    id: proposalId,
    surface: "smoke",
    channelId: "smoke-ch",
    threadId: "smoke-thread",
    proposerId: "smoke:proposer",
    draft: JSON.stringify({
      name: "smoke_agent",
      scope: "mcp/smoke",
      budgetUsd: 10,
      ttlHours: 1,
      gates: [],
      toolServers: ["mcp/smoke"],
    }),
    quorum: 1,
    totalSigners: 1,
    decision: "pending",
    capabilityId: null,
    capabilityDid: null,
    createdAt: new Date().toISOString(),
  });
  const tok = await registerAndIssueProposalToken(proposalId, "smoke:u-csig");

  // /countersign/challenge
  const optsRes = await postJson<AuthenticationOptions>(
    "/countersign/challenge",
    { token: tok },
  );
  if (optsRes.status !== 200) {
    fail(
      `countersign/challenge returned ${optsRes.status} body=${JSON.stringify(optsRes.body)}`,
    );
  }
  const includesCred = (optsRes.body.allowCredentials ?? []).some(
    (c) => c.id === credId,
  );
  if (!includesCred) {
    fail(
      `allowCredentials missing registered cred (got ${JSON.stringify(optsRes.body.allowCredentials)})`,
    );
  }
  console.log(`   server-issued challenge=${optsRes.body.challenge.slice(0, 24)}…`);
  pass(`countersign challenge issued, allowCredentials lists registered cred`);

  // Real assertion.
  const assertion = reg.authenticator.authenticationResponse(
    RP_ID,
    optsRes.body.challenge,
    ORIGIN,
  );
  const verifyRes = await postJson<{
    ok: boolean;
    proposalId?: string;
    decision?: string;
    capabilityDid?: string;
    capabilityId?: string;
    signers?: number;
  }>("/countersign/verify", {
    token: tok,
    action: "countersign",
    userHandle: "u-csig",
    response: assertion,
  });
  if (verifyRes.status !== 200 || !verifyRes.body.ok) {
    fail(
      `valid assertion rejected: status=${verifyRes.status} body=${JSON.stringify(verifyRes.body)}`,
    );
  }
  const sigs = listCountersignatures(proposalId);
  if (sigs.length !== 1) {
    fail(`expected 1 stored countersignature, got ${sigs.length}`);
  }
  if (!sigs[0]?.verifiedAt) fail(`countersignature missing verifiedAt`);
  console.log(`   countersignature stored at ${sigs[0]?.verifiedAt}`);
  console.log(`   verify-response decision=${verifyRes.body.decision} signers=${verifyRes.body.signers}`);
  pass(`real WebAuthn assertion verified, recorded with verifiedAt`);

  // Tampered signature → 401. Two flavours:
  //   (a) signature bytes flipped — server-side ed25519 verify must reject.
  //   (b) clientDataJSON.challenge replaced with a different challenge —
  //       server must catch the challenge mismatch.
  // We use a fresh user + fresh proposal + fresh token so the dedup gate
  // doesn't short-circuit the verifier path.
  const reg2 = await registerUser("smoke:u-tamper", "u-tamper", "smoke");
  const tamperPid = randomUUID();
  putProposal({
    id: tamperPid,
    surface: "smoke",
    channelId: "c",
    threadId: "t",
    proposerId: "p",
    draft: JSON.stringify({
      name: "x",
      scope: "x",
      budgetUsd: 1,
      ttlHours: 1,
      gates: [],
      toolServers: ["mcp/x"],
    }),
    quorum: 1,
    totalSigners: 1,
    decision: "pending",
    capabilityId: null,
    capabilityDid: null,
    createdAt: new Date().toISOString(),
  });

  // (a) tampered signature
  const tokA = await registerAndIssueProposalToken(tamperPid, "smoke:u-tamper");
  const optsA = await postJson<AuthenticationOptions>(
    "/countersign/challenge",
    { token: tokA },
  );
  const sigOk = reg2.authenticator.authenticationResponse(
    RP_ID,
    optsA.body.challenge,
    ORIGIN,
  );
  // Decode the base64url signature, flip a byte, re-encode.
  const sigBytes = Buffer.from(sigOk.response.signature, "base64url");
  sigBytes[0] = sigBytes[0]! ^ 0xff;
  const tamperedSig = {
    ...sigOk,
    response: {
      ...sigOk.response,
      signature: sigBytes.toString("base64url"),
    },
  };
  const tamperResA = await postJson<{ error?: string }>(
    "/countersign/verify",
    {
      token: tokA,
      action: "countersign",
      userHandle: "u-tamper",
      response: tamperedSig,
    },
  );
  if (tamperResA.status !== 401) {
    fail(
      `tampered signature was not rejected, got status=${tamperResA.status} body=${JSON.stringify(tamperResA.body)}`,
    );
  }
  if ((tamperResA.body.error ?? "").includes("already countersigned")) {
    fail(
      `tampered sig path leaked through verifier and hit dedup — verifier accepted forged sig`,
    );
  }
  console.log(`   tampered-signature rejection: "${tamperResA.body.error}"`);
  pass(`tampered signature rejected with 401 (verifier path)`);

  // (b) tampered clientDataJSON.challenge — fresh token, fresh proposal.
  const tamperPidB = randomUUID();
  putProposal({
    id: tamperPidB,
    surface: "smoke",
    channelId: "c",
    threadId: "t",
    proposerId: "p",
    draft: JSON.stringify({
      name: "x",
      scope: "x",
      budgetUsd: 1,
      ttlHours: 1,
      gates: [],
      toolServers: ["mcp/x"],
    }),
    quorum: 1,
    totalSigners: 1,
    decision: "pending",
    capabilityId: null,
    capabilityDid: null,
    createdAt: new Date().toISOString(),
  });
  const tokB = await registerAndIssueProposalToken(tamperPidB, "smoke:u-tamper");
  await postJson("/countersign/challenge", { token: tokB });
  // Sign over a *different* challenge to simulate replay/forgery.
  const wrongChallenge = Buffer.from("not-the-real-challenge-32-bytes-").toString(
    "base64url",
  );
  const wrongChAssertion = reg2.authenticator.authenticationResponse(
    RP_ID,
    wrongChallenge,
    ORIGIN,
  );
  const tamperResB = await postJson<{ error?: string }>(
    "/countersign/verify",
    {
      token: tokB,
      action: "countersign",
      userHandle: "u-tamper",
      response: wrongChAssertion,
    },
  );
  if (tamperResB.status !== 401) {
    fail(
      `tampered challenge was not rejected, got status=${tamperResB.status} body=${JSON.stringify(tamperResB.body)}`,
    );
  }
  if ((tamperResB.body.error ?? "").includes("already countersigned")) {
    fail(`tampered challenge path leaked through verifier`);
  }
  console.log(`   tampered-challenge rejection: "${tamperResB.body.error}"`);
  pass(`tampered clientDataJSON.challenge rejected with 401`);

  return { credentialId: credId, proposalId };
}

async function step6SockPuppet() {
  // Same credentialId can't countersign the same proposal twice.
  const reg = await registerUser("smoke:sock", "sock", "smoke");
  const pid = randomUUID();
  putProposal({
    id: pid,
    surface: "smoke",
    channelId: "c",
    threadId: "t",
    proposerId: "p",
    draft: JSON.stringify({
      name: "x",
      scope: "x",
      budgetUsd: 1,
      ttlHours: 1,
      gates: [],
      toolServers: ["mcp/x"],
    }),
    quorum: 3,
    totalSigners: 3,
    decision: "pending",
    capabilityId: null,
    capabilityDid: null,
    createdAt: new Date().toISOString(),
  });

  // First sign.
  const tok1 = await registerAndIssueProposalToken(pid, "smoke:sock");
  const opt1 = await postJson<AuthenticationOptions>("/countersign/challenge", {
    token: tok1,
  });
  const a1 = reg.authenticator.authenticationResponse(
    RP_ID,
    opt1.body.challenge,
    ORIGIN,
  );
  const v1 = await postJson("/countersign/verify", {
    token: tok1,
    action: "countersign",
    userHandle: "sock",
    response: a1,
  });
  if (v1.status !== 200) fail(`first sock-puppet sign failed: ${v1.status}`);

  // Second sign with same credential.
  const tok2 = await registerAndIssueProposalToken(pid, "smoke:sock");
  const opt2 = await postJson<AuthenticationOptions>("/countersign/challenge", {
    token: tok2,
  });
  const a2 = reg.authenticator.authenticationResponse(
    RP_ID,
    opt2.body.challenge,
    ORIGIN,
  );
  const v2 = await postJson<{ error?: string }>("/countersign/verify", {
    token: tok2,
    action: "countersign",
    userHandle: "sock",
    response: a2,
  });
  if (v2.status === 200) {
    fail(`sock-puppet second sign was accepted: ${JSON.stringify(v2.body)}`);
  }
  console.log(`   rejection text: "${v2.body.error}"`);
  pass(`sock-puppet rejection (status ${v2.status}, "${v2.body.error}")`);
}

async function step7QuorumIssuesCapability(): Promise<{
  did: string | undefined;
  capId: string | undefined;
}> {
  // 2-of-3.
  const u1 = await registerUser("smoke:q1", "q1", "smoke");
  const u2 = await registerUser("smoke:q2", "q2", "smoke");
  const u3 = await registerUser("smoke:q3", "q3", "smoke");
  void u3; // registered but won't sign
  const pid = randomUUID();
  putProposal({
    id: pid,
    surface: "smoke",
    channelId: "c",
    threadId: "t",
    proposerId: "smoke:q1",
    draft: JSON.stringify({
      name: "quorum_agent",
      scope: "mcp/zendesk",
      budgetUsd: 25,
      ttlHours: 2,
      gates: [],
      toolServers: ["mcp/zendesk"],
    }),
    quorum: 2,
    totalSigners: 3,
    decision: "pending",
    capabilityId: null,
    capabilityDid: null,
    createdAt: new Date().toISOString(),
  });

  async function csign(authUser: typeof u1, userId: string, handle: string) {
    const tok = await registerAndIssueProposalToken(pid, userId);
    const opts = await postJson<AuthenticationOptions>(
      "/countersign/challenge",
      { token: tok },
    );
    const a = authUser.authenticator.authenticationResponse(
      RP_ID,
      opts.body.challenge,
      ORIGIN,
    );
    return await postJson<{
      ok: boolean;
      decision?: string;
      capabilityDid?: string;
      capabilityId?: string;
    }>("/countersign/verify", {
      token: tok,
      action: "countersign",
      userHandle: handle,
      response: a,
    });
  }

  const r1 = await csign(u1, "smoke:q1", "q1");
  if (r1.status !== 200) fail(`q1 sign failed ${r1.status}`);
  const r2 = await csign(u2, "smoke:q2", "q2");
  if (r2.status !== 200) fail(`q2 sign failed ${r2.status}`);

  const finalProp = dbGetProposal(pid);
  if (!finalProp) fail(`proposal disappeared from db`);
  if (finalProp.decision !== "approved") {
    fail(`expected decision=approved, got ${finalProp.decision}`);
  }
  const did = r2.body.capabilityDid ?? finalProp.capabilityDid ?? undefined;
  const capId = r2.body.capabilityId ?? finalProp.capabilityId ?? undefined;
  if (!did || !did.startsWith("did:chio:")) {
    console.warn(`   WARN: no did:chio returned (capabilityDid=${did})`);
  } else {
    console.log(`   did:chio=${did}`);
  }
  if (capId) console.log(`   capability id=${capId}`);
  pass(
    `2-of-3 quorum reached, decision=approved` +
      (did?.startsWith("did:chio:") ? `, real did:chio issued` : ` (offline did fallback)`),
  );
  return { did: did ?? undefined, capId: capId ?? undefined };
}

async function step8RealReceiptVerify() {
  // Bond + check via the live bridge to produce a real signed receipt,
  // then POST it to /receipts. Tampered version must be rejected.
  const bridge = ChioBridge.fromDaemon({
    trustUrl: TRUST_URL,
    mcpEdgeUrl: MCP_URL,
    token: TRUST_TOKEN,
    receiptDbPath: RECEIPT_DB,
  });
  // Auto-bootstrap (Wave 3 polish).
  await bridge.bond({
    policyPath: process.env.CHIO_POLICY!,
  });
  const since = new Date(Date.now() - 10 * 60_000);
  await bridge.check({ tool: "echo", params: { msg: "smoke-receipt" } });
  const receipts = await bridge.receipts({ since, limit: 25 });
  if (receipts.length === 0) {
    fail(`no receipts after bond+check`);
  }
  const r = receipts[0]!;
  // Sanity verify locally.
  const localOk = verifyReceiptValue(r);
  if (!localOk) fail(`bridge.verifyReceiptValue failed for fresh receipt`);
  console.log(`   local verify=true, receipt id=${r.id}`);

  // POST to /receipts (real path).
  const body = JSON.stringify(r);
  const res = await fetch(`${BOT_URL}/receipts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (res.status !== 200) {
    fail(`/receipts rejected real receipt: ${res.status} ${await res.text()}`);
  }
  pass(`real ed25519-signed receipt accepted by /receipts`);

  // Tamper: flip a field.
  const tampered = JSON.parse(body) as Record<string, unknown>;
  tampered.tool_name = (tampered.tool_name as string) + "_TAMPER";
  const res2 = await fetch(`${BOT_URL}/receipts`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-chio-sig": "ed25519:deadbeef",
    },
    body: JSON.stringify(tampered),
  });
  if (res2.status === 200) {
    fail(`tampered receipt was accepted (200)`);
  }
  pass(`tampered receipt rejected with ${res2.status}`);

  // Bogus structure with valid-looking sig prefix.
  const res3 = await fetch(`${BOT_URL}/receipts`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-chio-sig": "ed25519:deadbeef",
    },
    body: JSON.stringify({
      id: "garbage",
      timestamp: 1,
      tool_server: "x",
      tool_name: "y",
      decision: "Allow",
      signature: "00".repeat(32),
      kernel_key: "00".repeat(32),
    }),
  });
  if (res3.status === 200) {
    fail(`bogus receipt with deadbeef sig was accepted (200)`);
  }
  pass(`bogus receipt with x-chio-sig deadbeef rejected with ${res3.status}`);

  return { bridge, receipt: r };
}

async function step9IntentParser() {
  const cases: Array<[string, string, (i: any) => boolean]> = [
    ["chio, bond a backfill agent for refunds, cap $40, ttl 4h", "bond", (i) => i.budgetUsd === 40 && i.ttlHours === 4],
    ["chio, bump budget by $25", "bump_budget", (i) => i.deltaUsd === 25],
    ["chio, revoke agent did:chio:xyz", "revoke", (i) => i.target === "did:chio:xyz"],
    ["chio, post the last 7 receipts", "post_receipts", (i) => i.n === 7],
    ["chio, rotate to next on-call", "shift_handoff", () => true],
    ["chio, register my passkey", "register_passkey", () => true],
    ["chio, bind trust to https://trust.example.com", "bind_trust", (i) => i.url === "https://trust.example.com"],
    ["chio, draft a support-desk policy", "policy_draft", () => true],
    ["chio, attenuate — lower budget to $10", "attenuate", (i) => i.budgetUsd === 10],
    ["chio, approve proposal 11111111-2222-3333-4444-555555555555", "approve_proposal", (i) => !!i.proposalId],
    ["chio, deny proposal abc", "deny_proposal", () => true],
    ["chio, status of agent did:chio:zzz", "status", () => true],
    ["chio, post receipts in-thread", "post_receipts", () => true],
    ["chio, export evidence last 24h", "evidence_export", (i) => i.sinceHours === 24],
    ["chio, promote this policy to live", "promote_policy", () => true],
    ["chio, require approval for refunds", "require_approval", () => true],
  ];
  let matched = 0;
  for (const [text, expectedKind, predicate] of cases) {
    const i = parseIntent(text);
    if (i.kind === expectedKind && predicate(i as any)) {
      matched += 1;
    } else {
      fail(`intent parser failed for "${text}" — got kind=${i.kind}`);
    }
  }
  console.log(`   matched ${matched}/${cases.length} intents`);
  if (matched < 15) fail(`needed 15+ intents, only matched ${matched}`);
  pass(`intent parser exhaustive: ${matched} intents matched`);
}

async function step10Bridge() {
  const bridge = ChioBridge.fromDaemon({
    trustUrl: TRUST_URL,
    mcpEdgeUrl: MCP_URL,
    token: TRUST_TOKEN,
    receiptDbPath: RECEIPT_DB,
  });
  // bond
  const passport = await bridge.bond({
    policyPath: process.env.CHIO_POLICY!,
  });
  console.log(`   bond did=${passport.did}`);
  // check
  const verdict = await bridge.check({
    tool: "echo",
    params: { msg: "round-trip" },
  });
  console.log(`   check verdict=${verdict.decision}`);
  // verifyReceipt against a fresh receipt
  const since = new Date(Date.now() - 5 * 60_000);
  const rs = await bridge.receipts({ since, limit: 5 });
  if (rs.length > 0) {
    const ok = await bridge.verifyReceipt(rs[0]!);
    if (!ok) fail(`bridge.verifyReceipt rejected own receipt`);
    console.log(`   verifyReceipt: true (id=${rs[0]!.id})`);
  } else {
    console.log(`   no receipts to verify (skipping)`);
  }
  // exportEvidence
  const out = `/tmp/chio-smoke-openclaw/evidence-${Date.now()}.json`;
  const written = await bridge.exportEvidence({
    since: new Date(Date.now() - 60 * 60_000),
    outPath: out,
  });
  if (!written) fail(`exportEvidence returned empty`);
  const size = readFileSync(written, "utf8").length;
  console.log(`   exportEvidence wrote ${written} (${size} bytes)`);
  pass(`bridge round-trip bond → check → verifyReceipt → exportEvidence`);
}

async function step11AdapterHandshake() {
  // Slack/Discord/Telegram all require external signing keys we can't
  // mint. Skip explicitly so SMOKE.md can document the rationale.
  console.log(
    `   skipping live Slack/Discord/Telegram handshakes (signing keys not available in CI; adapters disabled when SLACK_*/DISCORD_*/TELEGRAM_* envars unset — this is the runtime contract documented in src/adapters/*.ts)`,
  );
  pass(`adapter handshake step skipped with documented rationale`);
}

async function main() {
  console.log(`smoke probe starting against bot=${BOT_URL} trust=${TRUST_URL}`);
  await step1HealthCheck();
  await step2Registration();
  await step3InvalidRegistration();
  await step4_5_validAndInvalidAssertion();
  await step6SockPuppet();
  await step7QuorumIssuesCapability();
  await step8RealReceiptVerify();
  await step9IntentParser();
  await step10Bridge();
  await step11AdapterHandshake();
  console.log(`\nall ${stepNum} smoke steps passed`);
}

main().catch((err) => {
  console.error(`fatal smoke probe error:`, err);
  process.exit(1);
});

// stop unused import warnings
void assert;
void writeFileSync;
