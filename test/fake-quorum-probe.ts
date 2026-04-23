/**
 * Fake-quorum end-to-end probe.
 *
 * Not a unit test — an operational smoke that runs against the live
 * chio-test-harness trust plane. It exercises the real bridge path:
 *   1. Create a proposal.
 *   2. Inject two verified-looking countersignatures (bypassing the
 *      browser WebAuthn handoff — the verifier path is covered by
 *      webauthn.test.ts; here we're showing that quorum triggers a real
 *      capability issuance).
 *   3. Assert the resulting `did:chio:…` shape.
 *
 * Run:
 *   source ../chio-test-harness/bin/env.sh
 *   CHIO_TRUST_TOKEN="$CHIO_TOKEN" \
 *   CHIO_RECEIPT_DB="$CHIO_HARNESS_DIR/var/receipts.sqlite" \
 *   DATABASE_PATH=/tmp/openclaw-probe.sqlite \
 *   tsx test/fake-quorum-probe.ts
 */
import { randomUUID } from "node:crypto";

async function main() {
  const { createProposal, countersign } = await import(
    "../src/core/approval.js"
  );

  const draft = {
    name: `probe_${Date.now()}`,
    scope: "mcp/zendesk",
    budgetUsd: 40,
    ttlHours: 4,
    toolServers: ["mcp/zendesk"],
    gates: ["refund > $100 => human"],
  };

  const p = createProposal({
    surface: "slack",
    channelId: "C-probe",
    threadId: "T-probe",
    proposerId: "slack:proposer",
    draft,
    quorum: 2,
    totalSigners: 3,
  });

  const fake = (id: string) => ({
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
  });

  const sig1 = await countersign(p.id, {
    userId: `slack:a-${randomUUID()}`,
    userHandle: "A",
    platform: "slack",
    credentialId: `cred-${randomUUID()}`,
    response: fake("c1") as any,
  });
  console.log("sig1:", sig1.ok, sig1.proposal?.decision);

  const sig2 = await countersign(p.id, {
    userId: `slack:b-${randomUUID()}`,
    userHandle: "B",
    platform: "slack",
    credentialId: `cred-${randomUUID()}`,
    response: fake("c2") as any,
  });
  console.log("sig2:", sig2.ok, sig2.proposal?.decision);
  console.log("capabilityId:", sig2.capabilityId);
  console.log("capabilityDid:", sig2.capabilityDid);
  if (sig2.reason) console.log("reason:", sig2.reason);

  if (!sig2.capabilityDid && !sig2.capabilityId) {
    console.error("NO did:chio issued — see `reason` above");
    process.exit(2);
  }
  console.log(
    `PASS did:chio: ${sig2.capabilityDid ?? sig2.proposal?.capabilityDid}`,
  );
}

main().catch((e) => {
  console.error("probe failed:", e);
  process.exit(1);
});
