/**
 * GET  /countersign           — serves the static WebAuthn page.
 * POST /countersign/challenge — issues a challenge for a bound token.
 * POST /countersign/verify    — verifies the assertion + updates approval.
 *
 * The static page runs `navigator.credentials.get({...})` in the browser
 * and POSTs the authentication response here for server-side verification.
 */
import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { AuthenticationResponseJSON } from "@simplewebauthn/types";
import {
  resolveCountersignToken,
  verifyAndCountersign,
} from "../core/approval.js";
import { beginAuthentication } from "../auth/webauthn.js";

export function countersignRouter() {
  const app = new Hono();

  app.get("/countersign", async (c) => {
    const token = c.req.query("token");
    const proposal = c.req.query("proposal");
    const platform = c.req.query("platform");
    const user = c.req.query("user");
    const action = c.req.query("action") ?? "countersign";
    if (!token || !proposal || !platform || !user) {
      return c.text("missing required params", 400);
    }
    const binding = resolveCountersignToken(token);
    if (!binding) return c.text("expired or unknown token", 410);

    const html = await loadHtml("countersign.html");
    return c.html(
      html
        .replace(/__TOKEN__/g, token)
        .replace(/__PROPOSAL__/g, proposal)
        .replace(/__PLATFORM__/g, platform)
        .replace(/__USER__/g, user)
        .replace(/__ACTION__/g, action),
    );
  });

  app.post("/countersign/challenge", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      token?: string;
    } | null;
    if (!body?.token) return c.json({ error: "missing token" }, 400);
    const binding = resolveCountersignToken(body.token);
    if (!binding) return c.json({ error: "unknown or expired token" }, 410);
    const options = await beginAuthentication({
      proposalId: binding.proposalId,
      userId: binding.userId,
      platform: binding.platform,
    });
    return c.json(options);
  });

  app.post("/countersign/verify", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      token?: string;
      action?: "countersign" | "deny";
      userHandle?: string;
      response?: AuthenticationResponseJSON;
    } | null;
    if (!body?.token || !body?.response) {
      return c.json({ error: "missing token or response" }, 400);
    }
    const result = await verifyAndCountersign({
      token: body.token,
      response: body.response,
      userHandle: body.userHandle ?? "unknown",
      action: body.action === "deny" ? "deny" : "countersign",
    });
    if (!result.ok) {
      return c.json({ error: result.reason ?? "verification failed" }, 401);
    }
    const after = result.proposal!;
    return c.json({
      ok: true,
      proposalId: after.id,
      decision: after.decision,
      signers: after.signatures.length,
      quorum: after.quorum,
      ...(result.capabilityDid
        ? { capabilityDid: result.capabilityDid }
        : {}),
      ...(result.capabilityId ? { capabilityId: result.capabilityId } : {}),
    });
  });

  return app;
}

async function loadHtml(name: string): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  // dev (tsx): src/routes/*.ts → ../web/*.html
  // compiled:  dist/routes/*.js → ../../src/web/*.html (since tsc does not
  //            copy .html files into dist)
  const candidates = [
    join(here, "..", "web", name),
    join(here, "..", "..", "src", "web", name),
  ];
  for (const c of candidates) {
    try {
      return await readFile(c, "utf8");
    } catch {
      // try next
    }
  }
  throw new Error(
    `could not locate ${name}; tried: ${candidates.join(", ")}`,
  );
}
