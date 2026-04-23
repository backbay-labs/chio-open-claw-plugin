/**
 * Minimal virtual WebAuthn authenticator for the live smoke harness.
 *
 * Drives real `@simplewebauthn/server` registration + authentication
 * verification by producing structurally-correct Ed25519 (COSE alg
 * EdDSA = -8) responses that the verifier accepts.
 *
 * This is NOT a hardware security module. It's a pure-Node fixture
 * authenticator suitable for proving the server-side ceremonies are
 * real — the same code path a browser would exercise via
 * `navigator.credentials.{create,get}` ends up at the same
 * `verifyRegistrationResponse`/`verifyAuthenticationResponse` calls.
 */
import {
  generateKeyPairSync,
  sign as cryptoSign,
  randomBytes,
  createHash,
  createPrivateKey,
} from "node:crypto";
import { encodeCBOR } from "@levischuck/tiny-cbor";

const TEXT_ENC = new TextEncoder();

function b64url(buf: Uint8Array | Buffer): string {
  return Buffer.from(buf).toString("base64url");
}

function rpIdHash(rpId: string): Buffer {
  return createHash("sha256").update(rpId).digest();
}

interface RawEdKey {
  publicRaw: Buffer; // 32 bytes
  privateRaw: Buffer; // 32 bytes seed
}

/**
 * Extract the raw 32-byte Ed25519 seed + public-key bytes from a Node
 * `KeyObject`. Node only exposes the DER-encoded form; we strip the
 * known PKCS#8 / SPKI prefixes.
 */
function extractEdRaw(): RawEdKey & { keyPair: ReturnType<typeof generateKeyPairSync<"ed25519">> } {
  const keyPair = generateKeyPairSync("ed25519");
  const pubDer = keyPair.publicKey.export({ format: "der", type: "spki" });
  const privDer = keyPair.privateKey.export({ format: "der", type: "pkcs8" });
  // SPKI for Ed25519 is 44 bytes: last 32 are the raw key.
  const publicRaw = Buffer.from(pubDer.subarray(pubDer.length - 32));
  // PKCS#8 for Ed25519 is 48 bytes: last 32 are the raw seed.
  const privateRaw = Buffer.from(privDer.subarray(privDer.length - 32));
  return { keyPair, publicRaw, privateRaw };
}

export interface VirtualAuthenticator {
  credentialId: Buffer;
  publicKeyCose: Buffer;
  registrationResponse: (
    rpId: string,
    challenge: string,
    origin: string,
  ) => RegistrationFixture;
  authenticationResponse: (
    rpId: string,
    challenge: string,
    origin: string,
  ) => AuthenticationFixture;
  signCounter: number;
}

export interface RegistrationFixture {
  id: string;
  rawId: string;
  type: "public-key";
  response: {
    attestationObject: string;
    clientDataJSON: string;
    transports?: string[];
  };
  clientExtensionResults: Record<string, never>;
}

export interface AuthenticationFixture {
  id: string;
  rawId: string;
  type: "public-key";
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string | null;
  };
  clientExtensionResults: Record<string, never>;
}

/**
 * Build a fresh virtual authenticator with a brand-new Ed25519 keypair.
 * The credentialId is a random 32-byte handle the server stores.
 */
export function createVirtualAuthenticator(): VirtualAuthenticator {
  const { keyPair, publicRaw, privateRaw } = extractEdRaw();
  void keyPair;
  const credentialId = randomBytes(32);

  // COSE_Key for Ed25519 (RFC 8152): {1: 1 (OKP), 3: -8 (EdDSA), -1: 6 (Ed25519), -2: <pub>}
  const coseMap = new Map<number, number | Uint8Array>([
    [1, 1],
    [3, -8],
    [-1, 6],
    [-2, publicRaw],
  ]);
  const publicKeyCose = Buffer.from(encodeCBOR(coseMap));

  let counter = 0;

  function buildAuthenticatorData(rpId: string, includeAttestedCred: boolean): Buffer {
    counter += 1;
    const flagsAttested = includeAttestedCred ? 0x40 : 0x00;
    // UP (0x01) + UV (0x04). Plus AT (0x40) on registration.
    const flags = 0x01 | 0x04 | flagsAttested;
    const counterBuf = Buffer.alloc(4);
    counterBuf.writeUInt32BE(counter, 0);

    const head = Buffer.concat([rpIdHash(rpId), Buffer.from([flags]), counterBuf]);

    if (!includeAttestedCred) return head;

    // Attested credential data: aaguid (16 bytes) || credIdLen (2 BE) || credId || cosePub
    const aaguid = Buffer.alloc(16); // zeros
    const credIdLen = Buffer.alloc(2);
    credIdLen.writeUInt16BE(credentialId.length, 0);
    return Buffer.concat([head, aaguid, credIdLen, credentialId, publicKeyCose]);
  }

  function buildClientDataJSON(type: string, challenge: string, origin: string): Buffer {
    // simplewebauthn validates type, challenge (base64url decode == raw),
    // and origin. crossOrigin not required.
    const obj = {
      type,
      challenge,
      origin,
      crossOrigin: false,
    };
    return Buffer.from(JSON.stringify(obj), "utf8");
  }

  function ed25519Sign(data: Buffer): Buffer {
    // Reconstruct a Node KeyObject from the raw seed: build PKCS#8 prefix.
    const PKCS8_PREFIX = Buffer.from(
      "302e020100300506032b657004220420",
      "hex",
    );
    const pkcs8 = Buffer.concat([PKCS8_PREFIX, privateRaw]);
    const key = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
    return cryptoSign(null, data, key);
  }

  function registrationResponse(
    rpId: string,
    challenge: string,
    origin: string,
  ): RegistrationFixture {
    const authData = buildAuthenticatorData(rpId, true);
    const clientDataJSON = buildClientDataJSON(
      "webauthn.create",
      challenge,
      origin,
    );

    // attestation "none": fmt:"none", attStmt:{}, authData:<bytes>
    const attestationObjectMap = new Map<string, unknown>([
      ["fmt", "none"],
      ["attStmt", new Map()],
      ["authData", authData],
    ]);
    const attestationObject = Buffer.from(encodeCBOR(attestationObjectMap));

    return {
      id: b64url(credentialId),
      rawId: b64url(credentialId),
      type: "public-key",
      response: {
        attestationObject: b64url(attestationObject),
        clientDataJSON: b64url(clientDataJSON),
        transports: ["internal"],
      },
      clientExtensionResults: {},
    };
  }

  function authenticationResponse(
    rpId: string,
    challenge: string,
    origin: string,
  ): AuthenticationFixture {
    const authData = buildAuthenticatorData(rpId, false);
    const clientDataJSON = buildClientDataJSON(
      "webauthn.get",
      challenge,
      origin,
    );
    const cdjHash = createHash("sha256").update(clientDataJSON).digest();
    const signature = ed25519Sign(Buffer.concat([authData, cdjHash]));
    return {
      id: b64url(credentialId),
      rawId: b64url(credentialId),
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        userHandle: null,
      },
      clientExtensionResults: {},
    };
  }

  return {
    credentialId,
    publicKeyCose,
    registrationResponse,
    authenticationResponse,
    signCounter: counter,
  };
}
