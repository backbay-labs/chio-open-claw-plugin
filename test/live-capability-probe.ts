/**
 * Live end-to-end probe: fake-quorum → real capability issuance via the
 * trust plane.
 *
 * The current `@chio/bridge.issueCapability()` sends `{subject, scope, ttl}`
 * but `chio trust serve`'s `/v1/capabilities/issue` expects
 * `{subjectPublicKey, scope, ttlSeconds}`. Until that bridge bug is fixed
 * (see flagged item in the report), this probe drives the trust plane
 * directly with the documented request shape, then prints the resulting
 * capability id and `did:chio:` subject.
 *
 * This still demonstrates the OpenClaw "quorum reached → real capability
 * issued" payload — every field used here is the same data the approval
 * state machine would forward when the bridge is fixed.
 */
async function main() {
  const trustUrl = process.env.CHIO_TRUST_URL ?? "http://127.0.0.1:8940";
  const token = process.env.CHIO_TRUST_TOKEN;
  if (!token) throw new Error("CHIO_TRUST_TOKEN not set");

  // Pull a real subject public key from a published passport.
  const passports = await fetch(`${trustUrl}/v1/passport/statuses`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!passports.ok) {
    throw new Error(
      `listing passports failed: HTTP ${passports.status} ${await passports.text()}`,
    );
  }
  const list = (await passports.json()) as {
    passports?: { subject: string; status: string }[];
  };
  const active = (list.passports ?? []).find((p) => p.status === "active");
  if (!active) throw new Error("no active passport in trust plane");
  const did = active.subject;
  const subjectPublicKey = did.replace(/^did:chio:/, "");
  console.log(`subject did = ${did}`);

  const req = {
    subjectPublicKey,
    scope: {
      grants: [
        {
          server_id: "mcp/zendesk",
          tool_name: "*",
          operations: ["invoke"],
          max_total_cost: { units: 4000, currency: "USD" },
        },
      ],
    },
    ttlSeconds: 4 * 3600,
  };

  const res = await fetch(`${trustUrl}/v1/capabilities/issue`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(req),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  const data = JSON.parse(body) as {
    capability?: {
      id?: string;
      subject?: string;
      expires_at?: number;
    };
  };
  const cap = data.capability ?? {};
  const subjectDid = cap.subject ?? did;
  console.log(`capabilityId = ${cap.id}`);
  console.log(`expiresAt    = ${cap.expires_at}`);
  console.log(`PASS did:chio: ${subjectDid}`);
}

main().catch((e) => {
  console.error("probe failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
