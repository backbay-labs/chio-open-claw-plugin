/**
 * Approval state machine tests.
 *
 * We bypass WebAuthn assertion verification at the approval-machine tier
 * (the goal here is to exercise quorum math, duplicate-credential rejection,
 * attenuate semantics). The WebAuthn verifier is covered in webauthn.test.ts.
 *
 * Capability issuance talks to the live bridge; in CLI-only mode (no
 * CHIO_TRUST_TOKEN), issueCapability throws NotInitializedError. The
 * approval state machine catches that and still marks the proposal approved,
 * leaving capabilityId empty — which is the correct offline behaviour.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Pick a throwaway DB before loading any module that uses it.
const tmpDir = mkdtempSync(join(tmpdir(), "openclaw-approval-"));
process.env.DATABASE_PATH = join(tmpDir, "db.sqlite");
process.env.WEBAUTHN_RP_ID = "localhost";
process.env.WEBAUTHN_ORIGIN = "http://localhost:8787";
// No CHIO_TRUST_TOKEN: forces the bridge into CLI-only mode so
// issueCapability throws gracefully.
delete process.env.CHIO_TRUST_TOKEN;

const { createProposal, countersign, deny, get, attenuate } = await import(
  "../src/core/approval.js"
);

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function draft() {
  return {
    name: "backfill",
    scope: "mcp/zendesk",
    budgetUsd: 40,
    ttlHours: 4,
    toolServers: ["mcp/zendesk"],
    gates: ["refund > $100 => human"],
  };
}

function fakeAssertion(id: string) {
  return {
    id,
    rawId: id,
    type: "public-key" as const,
    response: {
      clientDataJSON: "eyJ0eXAiOiJ0ZXN0In0",
      authenticatorData: "YXV0aA",
      signature: "c2ln",
      userHandle: null,
    },
    clientExtensionResults: {},
  };
}

test("quorum 2-of-3: two distinct credentials approve → proposal approved", async () => {
  const p = createProposal({
    surface: "slack",
    channelId: "C1",
    threadId: "T1",
    proposerId: "slack:U1",
    draft: draft(),
    quorum: 2,
    totalSigners: 3,
  });

  const r1 = await countersign(p.id, {
    userId: "slack:U1",
    userHandle: "U1",
    platform: "slack",
    credentialId: "cred-A",
    response: fakeAssertion("cred-A") as any,
  });
  assert.equal(r1.ok, true);
  assert.equal(r1.proposal?.decision, "pending");

  const r2 = await countersign(p.id, {
    userId: "slack:U2",
    userHandle: "U2",
    platform: "slack",
    credentialId: "cred-B",
    response: fakeAssertion("cred-B") as any,
  });
  assert.equal(r2.ok, true);
  // CLI-only mode: capability issuance fails, but the state machine still
  // transitions to approved. That's what the real bridge does without a
  // daemon, and is the correct fail-safe for the approval boundary.
  assert.equal(r2.proposal?.decision, "approved");
});

test("sock-puppet defence: same credentialId cannot approve twice", async () => {
  const p = createProposal({
    surface: "slack",
    channelId: "C1",
    threadId: "T2",
    proposerId: "slack:U1",
    draft: draft(),
    quorum: 3,
    totalSigners: 4,
  });

  const first = await countersign(p.id, {
    userId: "slack:U1",
    userHandle: "U1",
    platform: "slack",
    credentialId: "cred-DUP",
    response: fakeAssertion("cred-DUP") as any,
  });
  assert.equal(first.ok, true);
  const after1 = get(p.id)!;
  assert.equal(after1.signatures.length, 1);

  const dup = await countersign(p.id, {
    userId: "slack:U1",
    userHandle: "U1",
    platform: "slack",
    credentialId: "cred-DUP",
    response: fakeAssertion("cred-DUP") as any,
  });
  assert.equal(dup.ok, false, "duplicate credentialId must be rejected");
  const after2 = get(p.id)!;
  assert.equal(
    after2.signatures.length,
    1,
    "counter must not advance on duplicate",
  );
  assert.equal(after2.decision, "pending");
});

test("deny quorum: 2 denies on a 2-of-3 (totalSigners=3) seal as denied", () => {
  const p = createProposal({
    surface: "slack",
    channelId: "C1",
    threadId: "T3",
    proposerId: "slack:U1",
    draft: draft(),
    quorum: 2,
    totalSigners: 3,
  });

  const d1 = deny(p.id, {
    userId: "slack:U1",
    userHandle: "U1",
    platform: "slack",
    credentialId: "cred-D1",
    response: fakeAssertion("cred-D1") as any,
  });
  assert.equal(d1.ok, true);
  assert.equal(d1.proposal?.decision, "pending");

  const d2 = deny(p.id, {
    userId: "slack:U2",
    userHandle: "U2",
    platform: "slack",
    credentialId: "cred-D2",
    response: fakeAssertion("cred-D2") as any,
  });
  assert.equal(d2.ok, true);
  assert.equal(
    d2.proposal?.decision,
    "denied",
    "2 denies on 2-of-3 totalSigners=3 => needed=totalSigners-quorum+1=2",
  );
});

test("attenuate lowers draft + flips to attenuated", () => {
  const p = createProposal({
    surface: "slack",
    channelId: "C1",
    threadId: "T4",
    proposerId: "slack:U1",
    draft: draft(),
  });
  const after = attenuate(p.id, { budgetUsd: 10 });
  assert.ok(after);
  assert.equal(after!.decision, "attenuated");
  assert.equal(after!.draft.budgetUsd, 10);
});
