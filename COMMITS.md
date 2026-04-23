# COMMITS.md — chio-open-claw-plugin

OpenClaw — hosted Chio edge that lives in Slack / Discord / Telegram.
Mention `@chio`, describe the job, get a passkey-countersigned bonded
agent. Ships two artefacts per release: npm tarball and a Docker
image on GHCR. Target first ship tag: `v0.2.0`.

---

## 1. chore: scaffold hosted-edge package with Dockerfile

**Body.** `package.json` (`@chio/openclaw@0.2.0`), `tsconfig.json`,
`LICENSE`, `.gitignore`, `.env.example` (Slack / Discord / Telegram
creds + `CHIO_TRUST_URL`), `bun.lock`, `Dockerfile` (context is the
monorepo parent — Docker forbids `../` in COPY, so the release
workflow lifts the context to `..` and uses
`Dockerfile: chio-open-claw-plugin/Dockerfile`). Wave 1.

**Files.**

- `package.json`, `package-lock.json`, `bun.lock`
- `tsconfig.json`
- `LICENSE`, `.gitignore`, `.env.example`
- `Dockerfile`

---

## 2. feat: three platform adapters, shared core, passkey approval flow

**Body.** Platform adapters (`src/adapters/{slack,discord,telegram}.ts`)
share `src/core/*` for intent parsing, approval-card state machine,
and M-of-N passkey countersigning (`@simplewebauthn/server`).
`src/auth/*` handles passkey registration + challenge verification.
`src/routes/*` serves OAuth callbacks (Slack, Discord) and the
`/receipts` webhook that routes trust-plane receipts back into the
originating thread. `src/storage.ts` persists approval state in
`better-sqlite3`. `src/scheduler.ts` handles shift-change rotation
and `chio, stop` revocation. Wave 1 rewrite against the host schema.

**Files.**

- `src/index.ts`, `src/config.ts`, `src/storage.ts`,
  `src/scheduler.ts`
- `src/adapters/*.ts`
- `src/core/*.ts`
- `src/auth/*.ts`
- `src/routes/*.ts`
- `src/web/*.ts`
- `templates/` — approval card renders.

---

## 3. test: unit coverage and multi-adapter smoke

**Body.** Unit tests cover intent parsing, approval-state
transitions, passkey challenge verification, and the
Slack/Discord/Telegram adapter message shapes. `smoke.sh` boots
`chio-test-harness`, stands up the OpenClaw HTTP server, and fires
synthetic `@chio run ...` messages through each adapter's
webhook, asserting a trust-plane capability issues with the
receipts webhook round-tripping signed receipts back. Wave 1 +
ST.2.x.

**Files.**

- `test/*.test.ts`
- `smoke.sh`
- `SMOKE.md`

---

## 4. feat: chio rename, CHIO_TRUST_URL env, did:chio:* subjects

**Body.** Imports + bridge construction switch to `ChioBridge`;
env var renamed from `ARC_TRUST_URL` to `CHIO_TRUST_URL` with a
legacy alias; subject DIDs standardise on `did:chio:` (ingest still
accepts `did:arc:`). Wave 5.0.

**Files.**

- `src/config.ts`
- `src/core/*.ts` — bridge client rename.
- `.env.example` — env var rename.

---

## 5. ci: lint, typecheck, and chio-backed smoke

**Body.** GitHub Actions workflow parallel to the other plugins'
ci.yml. Wave 5.1.

**Files.**

- `.github/workflows/ci.yml`

---

## 6. ci: dual-artefact SLSA L3 release — npm + GHCR Docker image

**Body.** Tag-triggered release ships two artefacts bound to the
same SLSA L3 provenance statements (distinct subjects, same ref):
(1) `npm publish --provenance @<NPM_SCOPE>/openclaw`, via the
generic SLSA generator; (2) `docker buildx` + push to
`ghcr.io/<DOCKER_OWNER>/chio-openclaw:<tag>`, via the SLSA
container generator with image digest as the subject, `cosign`
keyless signing, registry auth via `GITHUB_TOKEN`. Docker build
context is lifted to the monorepo parent so the Dockerfile can
COPY sibling repos. Wave 5.5.

**Files.**

- `.github/workflows/release.yml`

---

## 7. docs: README and hosted-edge architecture

**Body.** Documents the managed-edge install flow
(<https://openclaw.chio.co/install>), self-host flow
(`npm install && npm run build && npm start` or `docker run`),
minimum platform scopes, and the hosted-edge architecture.
Wave 5.2.

**Files.**

- `README.md`
- `SMOKE.md`
