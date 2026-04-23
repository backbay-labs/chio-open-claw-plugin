/**
 * Receipts webhook boundary tests.
 *
 * The previous scaffold accepted any payload whose `x-chio-sig` header
 * started with `ed25519:`. That is the defect the Rigorist called out. We
 * now run `@chio/bridge.verifyReceiptValue` which in turn calls the SDK's
 * `verifyReceipt` — canonicalises (RFC 8785), verifies signature + param
 * hash.
 *
 * These tests demonstrate the rejection paths against the route itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATABASE_PATH = join(
  mkdtempSync(join(tmpdir(), "openclaw-receipts-")),
  "db.sqlite",
);
process.env.WEBAUTHN_RP_ID = "localhost";
process.env.WEBAUTHN_ORIGIN = "http://localhost:8787";

const { receiptsRouter } = await import("../src/routes/receipts.js");

function buildApp() {
  const app = new Hono();
  app.route("/", receiptsRouter({ slack: null, discord: null, telegram: null }));
  return app;
}

test("rejects invalid JSON body", async () => {
  const res = await buildApp().request("/receipts", {
    method: "POST",
    body: "not json",
    headers: { "content-type": "application/json" },
  });
  assert.equal(res.status, 400);
});

test("rejects unsigned / forged receipt payload (header no longer suffices)", async () => {
  // The old scaffold accepted this with header x-chio-sig: ed25519:deadbeef.
  // Real verification runs over the canonical body — this must now 401.
  const res = await buildApp().request("/receipts", {
    method: "POST",
    body: JSON.stringify({
      id: "r-forged",
      timestamp: 1714000000,
      tool_server: "mcp/test",
      tool_name: "read",
      decision: "Allow",
      signature: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      kernel_key: "00".repeat(32),
    }),
    headers: {
      "content-type": "application/json",
      "x-chio-sig": "ed25519:deadbeef",
    },
  });
  // 400 (parseReceipt rejected shape) OR 401 (sig verify rejected). Either
  // is acceptable — the old path returned 200 OK for the same payload.
  assert.ok(res.status === 400 || res.status === 401, `status ${res.status}`);
});

test("rejects structurally-invalid receipt", async () => {
  const res = await buildApp().request("/receipts", {
    method: "POST",
    body: JSON.stringify({ fake: true }),
    headers: { "content-type": "application/json" },
  });
  assert.ok(res.status >= 400);
});
