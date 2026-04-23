/**
 * GET  /register                — serves the registration HTML.
 * POST /register/challenge      — issues a registration challenge.
 * POST /register/verify         — verifies + stores the passkey.
 *
 * Kicked off by an `@chio, register my passkey` message in chat. The chat
 * adapter replies with a one-time URL (a registration token bound to the
 * platform user); the browser runs the ceremony and the public key lands
 * in SQLite. From then on the user can countersign proposals.
 */
import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import type { RegistrationResponseJSON } from "@simplewebauthn/types";
import {
  beginRegistration,
  finishRegistration,
  type RegistrationContext,
} from "../auth/webauthn.js";
import { putChallenge, getChallenge, consumeChallenge } from "../storage.js";

interface RegistrationBinding {
  userId: string;
  userHandle: string;
  platform: string;
}

export function mintRegistrationToken(ctx: RegistrationBinding): string {
  const token = randomBytes(24).toString("base64url");
  putChallenge({
    id: `regtok:${token}`,
    challenge: "",
    purpose: "registration",
    context: JSON.stringify(ctx),
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  return token;
}

export function resolveRegistrationToken(
  token: string,
): RegistrationBinding | undefined {
  const entry = getChallenge(`regtok:${token}`);
  if (!entry || !entry.context) return undefined;
  try {
    return JSON.parse(entry.context) as RegistrationBinding;
  } catch {
    return undefined;
  }
}

export function registerRouter() {
  const app = new Hono();

  app.get("/register", async (c) => {
    const token = c.req.query("token");
    if (!token) return c.text("missing token", 400);
    const binding = resolveRegistrationToken(token);
    if (!binding) return c.text("expired or unknown token", 410);
    const html = await loadHtml("register.html");
    return c.html(
      html
        .replace(/__TOKEN__/g, token)
        .replace(/__USER__/g, binding.userHandle)
        .replace(/__PLATFORM__/g, binding.platform),
    );
  });

  app.post("/register/challenge", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      token?: string;
    } | null;
    if (!body?.token) return c.json({ error: "missing token" }, 400);
    const binding = resolveRegistrationToken(body.token);
    if (!binding) return c.json({ error: "unknown or expired token" }, 410);
    const ctx: RegistrationContext = {
      userId: binding.userId,
      userHandle: binding.userHandle,
      platform: binding.platform,
    };
    const options = await beginRegistration(ctx);
    return c.json(options);
  });

  app.post("/register/verify", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      token?: string;
      response?: RegistrationResponseJSON;
    } | null;
    if (!body?.token || !body?.response) {
      return c.json({ error: "missing token or response" }, 400);
    }
    const binding = resolveRegistrationToken(body.token);
    if (!binding) return c.json({ error: "unknown or expired token" }, 410);
    const ctx: RegistrationContext = {
      userId: binding.userId,
      userHandle: binding.userHandle,
      platform: binding.platform,
    };
    const res = await finishRegistration(ctx, body.response);
    if (!res.verified) {
      return c.json({ error: res.error ?? "registration failed" }, 401);
    }
    consumeChallenge(`regtok:${body.token}`);
    return c.json({ ok: true, credentialId: res.credentialId });
  });

  return app;
}

async function loadHtml(name: string): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
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
