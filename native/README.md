# Native OpenClaw kernel integration

Status: implementation candidate, not accepted or published. This package
registers `chio_call` in the actual OpenClaw agent runtime. The parent
repository's hosted chat gateway is a separate product.

The supported candidate runs OpenClaw `2026.5.20` (`e510042`) as a one-shot
local agent in a pinned Docker image, through an operator-owned HTTP launcher.
Remote write, edit, read and list execute at the Chio resource owner. Native
tools, other plugins, direct MCP, channels, automation, delegation, browser,
skill discovery and administrative commands are disabled. The fixed model
relay supports OpenAI API billing or explicitly selected ChatGPT/Codex
subscription authentication and requests one tool per turn. Overlapping calls remain
subject to the resource owner's delivery fence.

## Boundary

The trusted launcher retains the kernel credential, journal and model credential.
The guest receives only ephemeral gateway and model tokens. Its root and
configuration are read-only; it has an isolated state volume, no capabilities,
Docker socket or protected resource mount. Its Docker network is internal and
external DNS forwarding is disabled. A separate relay exposes only the fixed
gateway and model routes. The model relay accepts text and inline `chio_call`
functions, and rejects hosted tools, references and background requests.

Host agent, session and tool-call identities bind each RPC. The gateway and
kernel bind the operator principal, capability, resource and exact request.
The guest verifies signed decisions and received result bytes before returning
the full result to OpenClaw. The trusted model relay acknowledges only after
OpenClaw includes that result in native tool history, before the next model
turn. There is no guest acknowledgement RPC. Unknown outcomes are never
automatically retried. Profile
deletion cannot erase the operator journal or kernel fence.

| Tool | Arguments |
| --- | --- |
| `read_text_file` | `{ "path": "/workspace/approved.txt" }` |
| `write_file` | `{ "path": "/workspace/approved.txt", "content": "text" }` |
| `edit_file` | `{ "path": "/workspace/approved.txt", "edits": [{ "oldText": "old", "newText": "new" }] }` |
| `list_directory` | `{ "path": "/workspace" }` |

Pass these as `chio_call`'s `tool` and `arguments`. Preserve remote paths exactly.
The kernel's capability and policy decide which actions are permitted.

## Build and install an isolated candidate

Node 22 or later and Docker are required. Chio dependencies are vendored by
archive hash and bundled. Public Node and OpenClaw pins are in `docker/Dockerfile`.

```sh
npm ci --ignore-scripts --offline
npm test
node scripts/pack-release.mjs /absolute/new/artifacts
npm install --prefix /absolute/new/consumer --ignore-scripts --offline \
  --no-audit --no-fund /absolute/new/artifacts/chio-openclaw-kernel-0.1.0.tgz
node /absolute/new/consumer/node_modules/@chio/openclaw-kernel/scripts/build-container.mjs \
  chio-openclaw-host:qualified-candidate \
  /absolute/new/artifacts/chio-openclaw-kernel-0.1.0.tgz
docker image inspect --format '{{.Id}}' chio-openclaw-host:qualified-candidate
```

Record artifact hashes. Prepare a private gateway config with the bundled
bridge's `chio-prepare-gateway` procedure and a compatible kernel resource
service. The original public Chio CLI `0.1.0` lacks this contract; use the exact
candidate binary identity in the acceptance record. Issuance runs outside the
agent. For API billing, keep `OPENAI_API_KEY` only in the operator environment:

```sh
node /absolute/new/consumer/node_modules/@chio/openclaw-kernel/scripts/protected.mjs \
  --gateway-config /private/operator/gateway.json \
  --image sha256:REPLACE_WITH_RECORDED_IMAGE_ID \
  --state-dir /absolute/new/run-records \
  --prompt 'Use chio_call to read /workspace/approved.txt.'
```

For the supported ChatGPT/Codex subscription route, authenticate with native
Codex first, then explicitly select its private auth cache:

```sh
node /absolute/new/consumer/node_modules/@chio/openclaw-kernel/scripts/protected.mjs \
  --gateway-config /private/operator/gateway.json \
  --model-auth-file /private/native-codex-profile/auth.json \
  --image sha256:REPLACE_WITH_RECORDED_IMAGE_ID \
  --state-dir /absolute/new/subscription-run-records \
  --prompt 'Use chio_call to read /workspace/approved.txt.'
```

`--model-auth-file` selects `gpt-5.5` and OpenClaw's native
`openai-codex-responses` transport with PI explicitly pinned. The protected
profile enables only Chio and OpenClaw's bundled `openai` provider plugin; native
agent tools remain disabled. API billing uses
`gpt-4.1-mini`; the launcher never falls back between auth modes or providers.
The parent reads only the existing access token and account routing identifier.
It does not copy the cache into the guest or use a refresh token. Authenticate
or refresh through native Codex if the provider rejects expired credentials.
The cache must be an absolute, private, owned regular file. No normal OpenClaw
profile is read or modified.

The guest's native Codex transport receives a temporary local relay credential
with a placeholder account. Only the parent substitutes the actual account
credential, at the fixed ChatGPT Codex Responses endpoint. Hosted tools, account
item references, background work and other provider routes remain unavailable.
Tool results must appear in native Responses history before the trusted parent
acknowledges delivery and permits the next model request.

OpenClaw documents subscription authentication and the explicit PI route in its
[OpenAI provider guide](https://docs.openclaw.ai/providers/openai) and
[OAuth guide](https://docs.openclaw.ai/concepts/oauth). The installed `2026.5.20`
provider and OpenClaw Responses transport sources control this pinned candidate; newer web
documentation describes additional runtime and auth-store changes.

The launcher refuses existing record directories. It streams configuration to
a Docker volume; no host filesystem share or private sibling is needed. The
record directory includes ephemeral guest tokens: export evidence by an
explicit file allowlist. Exit 2 is unresolved, 3 is protected work incomplete,
and 4 is awaiting approval. Exit 0 still requires comparison with requested
work and independent resource observations. Legacy profile/bootstrap and direct
container procedures remain unqualified for this boundary.

## Recovery, upgrade and removal

Stop the host on unresolved delivery. Preserve the gateway config, journal,
kernel database and resource observations. The bundled bridge operator command
`delivery-export CONFIG REQUEST_ID NEW_PRIVATE_FILE` obtains the verified
original outcome without dispatch. Read it and inspect the resource, then run
`delivery-acknowledge CONFIG RECEIVED_FILE`. Use `recover-lock` only after its
recorded owner process is dead. An unknown dispatch without terminal evidence
remains fenced. Never remove journals or invent authority to repeat it.

A new one-shot host can use the same prepared config after exact recovery,
while authority remains valid. Conversation resume and background work are
disabled. Never replace expired authority to recover an uncertain operation.
Upgrade into a separate package and hashed image after its acceptance checks.
Keep old journals and resolve uncertain operations before switching authority.

Normal exit removes the launcher's relay and network, retaining the state and
control volumes named in `launch.json`. After a crash, stop only those recorded
containers before recovery. For removal, revoke authority and preserve evidence,
then remove only the recorded isolated containers, volumes, image and package
when no unresolved outcome remains. Final lifecycle qualification is still
required; these procedures do not establish I08 acceptance.

A private cleanup watchdog observes the launcher's pipe lifetime. At the tested
post-dispatch SIGKILL cutpoint, it removes only the recorded agent/relay
containers and their empty network after verifying image and network identity.
State and control volumes remain for operator recovery. Cleanup has bounded
retries and records failure explicitly; earlier creation-time crash cutpoints
still require separate qualification. The watchdog does not acknowledge or
redispatch protected operations.


The trusted cleanup watchdog now starts and acknowledges readiness before the
launcher creates its network, state volume or relay container. Startup crashes
therefore retain an exact ownership manifest and a live cleanup process. Failed
Docker inventory remains unresolved. In-flight Docker creation and watchdog
failure schedules beyond the recorded cutpoints still require qualification;
container absence after one observation is not a claim about an unknown delayed
creation. State and control volumes remain available for operator inspection.
