/**
 * Real WebAuthn ceremonies via @simplewebauthn/server.
 *
 * Spec: https://www.w3.org/TR/webauthn-3/
 *
 * Flow summary (countersign):
 *   1. User clicks "Countersign" in chat. Card contains a one-time URL
 *      {OPENCLAW_PUBLIC_URL}/countersign?proposal=<id>&platform=slack
 *        &user=<platform-user>&token=<one-time>.
 *   2. /countersign serves a static HTML page that calls generateAuthChallenge
 *      via GET /countersign/challenge?... and invokes navigator.credentials.get.
 *   3. Browser produces an AuthenticatorAssertionResponse (clientDataJSON,
 *      authenticatorData, signature, userHandle). Page POSTs the response to
 *      /countersign/verify.
 *   4. Server calls verifyCountersignAssertion which wraps
 *      @simplewebauthn/server.verifyAuthenticationResponse — real ed25519 or
 *      EC2 (COSE) signature verification against the stored public key.
 *   5. On success, approval.ts records the countersignature and checks quorum.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/types";
import { config } from "../config.js";
import {
  consumeChallenge,
  getChallenge,
  getCredential,
  listCredentialsForUser,
  putChallenge,
  putCredential,
  updateCredentialCounter,
} from "../storage.js";

const REGISTRATION_TTL_MS = 5 * 60 * 1000;
const AUTHENTICATION_TTL_MS = 5 * 60 * 1000;

export interface RegistrationContext {
  userId: string;
  userHandle: string;
  platform: string;
}

export async function beginRegistration(
  ctx: RegistrationContext,
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const userIdBytes = new TextEncoder().encode(ctx.userId);
  const existing = listCredentialsForUser(ctx.userId).map((c) => ({
    id: c.credentialId,
    transports: (c.transports
      ? (JSON.parse(c.transports) as AuthenticatorTransportFuture[])
      : undefined) as AuthenticatorTransportFuture[] | undefined,
  }));

  const options = await generateRegistrationOptions({
    rpName: config.WEBAUTHN_RP_NAME,
    rpID: config.WEBAUTHN_RP_ID,
    userID: userIdBytes,
    userName: ctx.userHandle,
    userDisplayName: ctx.userHandle,
    attestationType: "none",
    excludeCredentials: existing,
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
  });

  putChallenge({
    id: `reg:${ctx.userId}`,
    challenge: options.challenge,
    purpose: "registration",
    context: JSON.stringify(ctx),
    expiresAt: Date.now() + REGISTRATION_TTL_MS,
  });

  return options;
}

export async function finishRegistration(
  ctx: RegistrationContext,
  response: RegistrationResponseJSON,
): Promise<{ verified: boolean; credentialId?: string; error?: string }> {
  const stored = getChallenge(`reg:${ctx.userId}`);
  if (!stored || stored.purpose !== "registration") {
    return { verified: false, error: "no pending registration challenge" };
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: config.WEBAUTHN_ORIGIN,
      expectedRPID: config.WEBAUTHN_RP_ID,
      requireUserVerification: true,
    });
  } catch (err) {
    return { verified: false, error: (err as Error).message };
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { verified: false, error: "registration did not verify" };
  }

  const info = verification.registrationInfo;
  // @simplewebauthn v11 shape: { credential: { id, publicKey, counter, transports }, ... }
  const cred = info.credential;
  const credentialId = cred.id; // base64url string in v11
  const publicKey = Buffer.from(cred.publicKey).toString("base64url");

  putCredential({
    credentialId,
    publicKey,
    counter: cred.counter,
    transports: cred.transports ? JSON.stringify(cred.transports) : null,
    userId: ctx.userId,
    userHandle: ctx.userHandle,
    platform: ctx.platform,
    createdAt: new Date().toISOString(),
  });
  consumeChallenge(`reg:${ctx.userId}`);

  return { verified: true, credentialId };
}

export interface AuthenticationContext {
  proposalId: string;
  userId: string;
  platform: string;
}

export async function beginAuthentication(
  ctx: AuthenticationContext,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const userCreds = listCredentialsForUser(ctx.userId);
  const options = await generateAuthenticationOptions({
    rpID: config.WEBAUTHN_RP_ID,
    userVerification: "required",
    allowCredentials: userCreds.map((c) => ({
      id: c.credentialId,
      transports: c.transports
        ? (JSON.parse(c.transports) as AuthenticatorTransportFuture[])
        : undefined,
    })),
  });

  putChallenge({
    id: `auth:${ctx.proposalId}:${ctx.userId}`,
    challenge: options.challenge,
    purpose: "authentication",
    context: JSON.stringify(ctx),
    expiresAt: Date.now() + AUTHENTICATION_TTL_MS,
  });

  return options;
}

export interface VerifiedAssertion {
  verified: boolean;
  credentialId?: string;
  error?: string;
}

export async function finishAuthentication(
  ctx: AuthenticationContext,
  response: AuthenticationResponseJSON,
): Promise<VerifiedAssertion> {
  const stored = getChallenge(`auth:${ctx.proposalId}:${ctx.userId}`);
  if (!stored || stored.purpose !== "authentication") {
    return { verified: false, error: "no pending authentication challenge" };
  }

  const credentialRecord = getCredential(response.id);
  if (!credentialRecord) {
    return { verified: false, error: "unknown credential" };
  }
  if (credentialRecord.userId !== ctx.userId) {
    // Prevent cross-user credential reuse — a passkey registered to one
    // Slack user cannot be used to sign as another.
    return { verified: false, error: "credential owner mismatch" };
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: config.WEBAUTHN_ORIGIN,
      expectedRPID: config.WEBAUTHN_RP_ID,
      credential: {
        id: credentialRecord.credentialId,
        publicKey: Buffer.from(credentialRecord.publicKey, "base64url"),
        counter: credentialRecord.counter,
        transports: credentialRecord.transports
          ? (JSON.parse(credentialRecord.transports) as AuthenticatorTransportFuture[])
          : undefined,
      },
      requireUserVerification: true,
    });
  } catch (err) {
    return { verified: false, error: (err as Error).message };
  }

  if (!verification.verified) {
    return { verified: false, error: "assertion did not verify" };
  }

  updateCredentialCounter(
    credentialRecord.credentialId,
    verification.authenticationInfo.newCounter,
  );
  consumeChallenge(`auth:${ctx.proposalId}:${ctx.userId}`);

  return { verified: true, credentialId: credentialRecord.credentialId };
}
