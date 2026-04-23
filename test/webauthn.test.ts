/**
 * WebAuthn verifier boundary tests.
 *
 * We don't ship a virtual authenticator, so we can't round-trip a real
 * assertion in a pure-Node test. What we can do — and what matters — is
 * show that:
 *   1. Registration/authentication challenges persist and bind correctly.
 *   2. Forged or unbound assertions are REJECTED by the verifier layer
 *      (not silently accepted like the prior "stub" scaffold).
 *   3. Credential-owner enforcement: a passkey registered to user X cannot
 *      be asserted as user Y.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmpDir = mkdtempSync(join(tmpdir(), "openclaw-webauthn-"));
process.env.DATABASE_PATH = join(tmpDir, "db.sqlite");
process.env.WEBAUTHN_RP_ID = "localhost";
process.env.WEBAUTHN_ORIGIN = "http://localhost:8787";
process.env.WEBAUTHN_RP_NAME = "OpenClawTest";

const {
  beginRegistration,
  finishRegistration,
  beginAuthentication,
  finishAuthentication,
} = await import("../src/auth/webauthn.js");
const { putCredential } = await import("../src/storage.js");

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

test("beginRegistration returns a challenge and stores it", async () => {
  const opts = await beginRegistration({
    userId: "slack:U1",
    userHandle: "ayelet",
    platform: "slack",
  });
  assert.ok(opts.challenge, "challenge must be present");
  assert.equal(opts.rp.id, "localhost");
});

test("finishRegistration rejects response with no prior challenge", async () => {
  const res = await finishRegistration(
    { userId: "slack:neverseen", userHandle: "x", platform: "slack" },
    {
      id: "fake",
      rawId: "fake",
      type: "public-key",
      response: {
        attestationObject: "AAAA",
        clientDataJSON: "AAAA",
      },
      clientExtensionResults: {},
    } as any,
  );
  assert.equal(res.verified, false);
  assert.match(res.error ?? "", /no pending registration challenge/);
});

test("beginAuthentication issues a challenge for a user with creds", async () => {
  // Seed a fake credential for the user; we don't need a real key here —
  // only allowCredentials is populated from storage.
  putCredential({
    credentialId: "seeded-cred-1",
    publicKey: Buffer.from("fake-public-key").toString("base64url"),
    counter: 0,
    transports: null,
    userId: "slack:U-auth",
    userHandle: "ayelet",
    platform: "slack",
    createdAt: new Date().toISOString(),
  });
  const opts = await beginAuthentication({
    proposalId: "prop-1",
    userId: "slack:U-auth",
    platform: "slack",
  });
  assert.ok(opts.challenge);
  assert.ok(opts.allowCredentials?.find((c) => c.id === "seeded-cred-1"));
});

test("finishAuthentication rejects forged assertion (no pre-issued challenge)", async () => {
  const res = await finishAuthentication(
    { proposalId: "prop-no-challenge", userId: "slack:U-noch", platform: "slack" },
    {
      id: "cred-x",
      rawId: "cred-x",
      type: "public-key",
      response: {
        clientDataJSON: "AAAA",
        authenticatorData: "AAAA",
        signature: "AAAA",
        userHandle: null,
      },
      clientExtensionResults: {},
    } as any,
  );
  assert.equal(res.verified, false);
  assert.match(res.error ?? "", /no pending authentication challenge/);
});

test("finishAuthentication rejects cross-user credential reuse", async () => {
  // Two users, one seeded credential on user A.
  putCredential({
    credentialId: "shared-cred",
    publicKey: Buffer.from("pk").toString("base64url"),
    counter: 0,
    transports: null,
    userId: "slack:userA",
    userHandle: "A",
    platform: "slack",
    createdAt: new Date().toISOString(),
  });

  // Start auth as user B. This actually issues a challenge and stores it.
  await beginAuthentication({
    proposalId: "prop-xuser",
    userId: "slack:userB",
    platform: "slack",
  });

  // User B tries to use user A's credential.
  const res = await finishAuthentication(
    { proposalId: "prop-xuser", userId: "slack:userB", platform: "slack" },
    {
      id: "shared-cred",
      rawId: "shared-cred",
      type: "public-key",
      response: {
        clientDataJSON: "AAAA",
        authenticatorData: "AAAA",
        signature: "AAAA",
        userHandle: null,
      },
      clientExtensionResults: {},
    } as any,
  );
  assert.equal(res.verified, false);
  assert.match(res.error ?? "", /credential owner mismatch/);
});

test("finishAuthentication rejects forged signature on real challenge", async () => {
  putCredential({
    credentialId: "sig-test-cred",
    publicKey: Buffer.from("pk").toString("base64url"),
    counter: 0,
    transports: null,
    userId: "slack:forgery",
    userHandle: "forger",
    platform: "slack",
    createdAt: new Date().toISOString(),
  });
  await beginAuthentication({
    proposalId: "prop-forge",
    userId: "slack:forgery",
    platform: "slack",
  });
  // Response carries a real challenge-bound clientDataJSON in production;
  // here we pass garbage, which the verifier rejects.
  const res = await finishAuthentication(
    { proposalId: "prop-forge", userId: "slack:forgery", platform: "slack" },
    {
      id: "sig-test-cred",
      rawId: "sig-test-cred",
      type: "public-key",
      response: {
        clientDataJSON: Buffer.from('{"type":"not-an-assertion"}').toString("base64url"),
        authenticatorData: "AAAA",
        signature: "AAAA",
        userHandle: null,
      },
      clientExtensionResults: {},
    } as any,
  );
  assert.equal(res.verified, false);
  // Whatever the specific reason, it must not be "verified:true".
});
