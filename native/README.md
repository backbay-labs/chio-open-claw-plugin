# Native OpenClaw kernel integration

Status: implementation candidate, not an accepted or published integration.
The parent repository's `@chio/openclaw` chat gateway remains a separate product.
This package registers `chio_call` inside the actual OpenClaw agent runtime.

The recorded bridge candidate still places a bootstrap bearer in the runtime.
That bearer can create another kernel session and fresh capability. Qualification
is blocked until runtime credentials are restricted to the issued session; do
not promote this candidate as a complete mediation boundary.

The pinned host under test is OpenClaw `2026.5.20` (`e510042`), using its PI
runtime. Native tools, other plugins, direct MCP servers, channels, automation,
delegation, browser access, skill loading and administrative chat commands are
disabled in this candidate mode. Useful file workflows execute at a separately
configured Chio MCP resource owner. No local tool implementation runs after an
authorization precheck.

## Boundary and claims

`chio_call` accepts only a tool name and arguments. The plugin takes agent ID,
session ID, session key and tool-call ID from OpenClaw's runtime context. Their
digest identifies the operation. Operator configuration separately pins the
kernel subject, capability, server, session and trusted signer. The bridge
verifies that kernel authority before dispatch and checks signed request/result
evidence afterward. The host session digest is not a separate kernel-authenticated
principal; session-scoped capability issuance remains an acceptance requirement.

The bridge dispatches through Chio's MCP HTTP edge. A successful authorization
alone does not produce a completed result. Signed denial may occur after an
output guard, so denial alone does not prove prevention. Independent resource
observations are required by the acceptance record.

The plugin writes and fsyncs a pending operation before dispatch. Unknown
outcomes and signed denials fence the subject and resource server across all
host sessions in this profile. It does not retry them.
Only a verified completed result or a known pre-dispatch failure releases that
fence. Operator authority is included in the persisted request hash, so a
credential or signer change cannot replay an old cached response. The operator
must reconcile the resource and kernel record before recovering fenced work.

The filesystem resource service used by this candidate exposes:

| Tool | Arguments |
| --- | --- |
| `read_text_file` | `{ "path": "/workspace/approved.txt" }` |
| `write_file` | `{ "path": "/workspace/approved.txt", "content": "text" }` |
| `edit_file` | `{ "path": "/workspace/approved.txt", "edits": [{ "oldText": "old", "newText": "new" }] }` |
| `list_directory` | `{ "path": "/workspace" }` |

Pass these as `chio_call`'s `tool` and `arguments`. The kernel's issued capability
and policy decide which files and operations are permitted.

Native host tool policy prevents plugin omission from restoring unrestricted
tools. That policy complements resource isolation. The host must have no direct
protected workspace mount, resource credential bypass, privileged container
capability or Docker socket. The native macOS tests establish host dispatch
behavior; they do not establish that OS isolation.

## Build the installable candidate

Node 22 or later is required. The source vendors the exact bridge candidate
tarball. No private sibling checkout is used during installation.

```sh
npm ci --ignore-scripts --offline
npm test
node scripts/pack-release.mjs ./artifacts
```

The packaging script copies dependencies into a temporary stage, replaces local
dependency paths with exact bundled versions, writes a SHA-256 sidecar, and
preserves source package metadata. Do not use plain `npm pack` for delivery.

OpenClaw's archive installer attempts a new dependency installation even when
the archive already contains dependencies. Because bridge `0.3.0` is not yet
published, that path currently fails with npm `E404`. The supported candidate
procedure installs the self-contained npm archive into the isolated profile,
then links that installed package through OpenClaw's documented plugin command.

## Isolated profile installation

Obtain the operator-issued Chio execution configuration first: endpoint,
bearer, kernel subject public key, capability ID, resource server ID, trusted
receipt signer, and the kernel session bound to that authority. Also choose an
OpenAI-compatible model endpoint. These credentials and the resource service
are not supplied by this plugin.

Use a new absolute path for `PROFILE`. Keep model and Chio bearer values in
environment variables supplied by the operator. Do not point this at the normal
OpenClaw state directory.

```sh
PROFILE=/absolute/path/to/chio-openclaw-profile
node scripts/create-profile.mjs \
  --directory "$PROFILE" \
  --endpoint https://kernel.example \
  --token-env CHIO_KERNEL_TOKEN \
  --subject-key "$CHIO_SUBJECT_KEY" \
  --capability-id "$CHIO_CAPABILITY_ID" \
  --server-id workspace \
  --trusted-signer "$CHIO_TRUSTED_SIGNER" \
  --kernel-session-id "$CHIO_KERNEL_SESSION_ID" \
  --model-base-url https://model.example/v1 \
  --model-key-env CHIO_MODEL_KEY \
  --model-id operator-selected-model

npm install --prefix "$PROFILE/packages" --ignore-scripts --offline \
  --no-audit --no-fund ./artifacts/chio-openclaw-kernel-0.1.0.tgz

OPENCLAW_HOME="$PROFILE/home" \
OPENCLAW_STATE_DIR="$PROFILE/state" \
OPENCLAW_CONFIG_PATH="$PROFILE/openclaw.install.json" \
  openclaw plugins install --link \
  "$PROFILE/packages/node_modules/@chio/openclaw-kernel"
```

The profile records that kernel-issued session and the installed package path.
Select the generated
`openclaw.json` for subsequent commands. Validate and inspect before a session:

```sh
export OPENCLAW_HOME="$PROFILE/home"
export OPENCLAW_STATE_DIR="$PROFILE/state"
export OPENCLAW_CONFIG_PATH="$PROFILE/openclaw.json"
openclaw config validate
openclaw plugins inspect chio-kernel --runtime --json
openclaw agent --local --agent main --session-id "$OPENCLAW_TEST_SESSION" \
  --message 'Use chio_call to read and edit the operator-approved file.' --json
```

For the container candidate, configure kernel and model URLs that are reachable
from the container, then create a separate read-only runtime configuration:

```sh
node scripts/build-container.mjs
node scripts/container-config.mjs "$PROFILE/openclaw.json" "$PROFILE/container.json"
docker volume create chio-openclaw-state
docker run --rm --network none --read-only --user 0:0 \
  --mount type=volume,src=chio-openclaw-state,dst=/state \
  --entrypoint node chio-openclaw-host:20260909 \
  -e 'const f=require("node:fs");f.chownSync("/state",1000,1000);f.chmodSync("/state",448)'
docker run --rm --read-only --cap-drop ALL \
  --security-opt no-new-privileges --user 1000:1000 --pids-limit 128 \
  --memory 2g --tmpfs /tmp:rw,nosuid,nodev,size=256m \
  --mount type=volume,src=chio-openclaw-state,dst=/state \
  --mount "type=bind,src=$PROFILE/container.json,dst=/config/openclaw.json,readonly" \
  --env CHIO_KERNEL_TOKEN --env CHIO_MODEL_KEY \
  chio-openclaw-host:20260909 agent --local --agent main \
  --session-id "$OPENCLAW_TEST_SESSION" --message 'Read the approved file with chio_call.' --json
```

Use a distinct state volume for each operator profile and preserve it across
restarts. The host container receives no protected workspace or Docker socket.
The image is built from the exact Node base digest in `docker/Dockerfile` and
OpenClaw `2026.5.20`. Record its image ID when promoting a candidate.
For Docker Desktop/Colima local acceptance, `docker/proxy.mjs` forwards only the
fixed local test model and kernel ports. The test harness configures it; it is
not a general URL proxy. See `ACCEPTANCE.md` for the bounded results.

## Recovery, upgrade and removal

For a pending journal file, stop that host session. Use its recorded request ID
to inspect the kernel ledger, receipt and resource state independently. Preserve
the pending file and observations. If the outcome is still unknown, keep the
session fenced. Do not delete the journal or manufacture a fresh operation ID to
repeat the effect. After the operator establishes the terminal state, move that
specific pending record into an audit archive and resume with fresh valid
authority. There is no automatic reconciliation claim in this candidate.

Upgrade into a second isolated profile using a newly hashed archive and the
new version's acceptance instructions. Reissue authority rather than copying
live bearer credentials blindly. Keep old session journals and resource
observations. Never upgrade in the middle of an unresolved dispatch.

For removal, stop the isolated host, revoke its kernel authority, preserve
receipt/journal evidence, and run `openclaw plugins uninstall chio-kernel` with
the isolated environment above. Remove only this profile's installed npm
package after uninstall. A removed plugin leaves the restrictive tool policy
in place; the host must refuse new tool sessions.

## Reproduce current evidence

```sh
npm test
node test/runbook.mjs ./artifacts/chio-openclaw-kernel-0.1.0.tgz
node test/real-host.mjs
CHIO_KERNEL_CONFIG=/operator/private/openclaw-gateway.json \
  CHIO_LIVE_ONLY=1 node test/real-host.mjs
CHIO_HOST_CONTAINER=1 CHIO_KERNEL_CONFIG=/operator/private/openclaw-gateway.json \
  CHIO_RESOURCE_VOLUME=operator-designated-test-volume \
  CHIO_LIVE_ONLY=1 node test/real-host.mjs
```

The host test uses the installed OpenClaw executable and an explicit deterministic
local model provider to force actual tool calls. It retains commands, provider
requests, host output and resource observations in a disposable directory. It
does not claim model quality, independent adoption, or completion of I01-I08.
The private live configuration contains `execution` (bridge options) and `tools`
(resource descriptors). Its bearer is passed only through an environment
variable, never copied into the retained evidence.

Dedicated authority cases use `CHIO_AUTHORITY_CASE=revoke` or `budget` with
`CHIO_OPERATOR_HELPER` and `CHIO_OPERATOR_FILE` identifying the operator's
per-capability control tool. Revocation also requires
`CHIO_RESTORE_KERNEL_CONFIG` for an independently issued fresh grant. Use a new
capability for each case. The budget case assumes exactly 64 aggregate allowed
invocations and attempts 65 sequential writes through one actual host turn.
These cases are implemented but remain unresolved while fresh authority
preparation fails; their code alone is not passing evidence.
