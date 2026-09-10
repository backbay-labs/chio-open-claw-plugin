# Chio for the native OpenClaw agent

Run a one-shot OpenClaw agent against an approved remote filesystem. The
`chio_call` tool sends each request to the Chio kernel; the resource owner
performs the operation and the integration verifies the returned evidence.

[Overview](https://github.com/backbay-labs/chio-open-claw-plugin) · [Install](#build-and-install) ·
[Run](#run-a-file-workflow) · [Boundary](#enforcement-boundary) ·
[Recovery](#recovery-upgrade-and-removal) · [Acceptance](ACCEPTANCE.md)

**Candidate scope:** `@chio/openclaw-kernel@0.1.0` targets OpenClaw `2026.5.20`
with its PI runtime. The [recorded Linux arm64 runs](https://github.com/backbay-labs/chio-open-claw-plugin/blob/main/native/evidence/2026-09-10/static-kernel-native/README.md)
use Node `22.23.1` and PI `0.75.4`. These are bounded local observations, not
full I01-I08 acceptance or a published compatible release. A source rebuild,
including README changes, produces a new archive identity and does not inherit
the frozen candidate's acceptance evidence.

## Supported scope

The prepared gateway exposes an explicit tool inventory. The filesystem
candidate uses these operations:

| Remote tool | Example `arguments` |
| --- | --- |
| `read_text_file` | `{ "path": "/workspace/approved.txt" }` |
| `write_file` | `{ "path": "/workspace/approved.txt", "content": "Draft" }` |
| `edit_file` | `{ "path": "/workspace/approved.txt", "edits": [{ "oldText": "Draft", "newText": "Ready" }] }` |
| `list_directory` | `{ "path": "/workspace" }` |

Pass the operation as `chio_call`'s `tool` and the object as its `arguments`.
Preserve remote paths exactly. The kernel's capability and policy determine
which of these requests the caller may execute.

Native file and shell/process tools, direct network access, browser tools,
other MCP/custom tools, skill discovery, delegation, channels, automation,
administrative commands and conversation resume are disabled in this mode.
The plugin allowlist contains Chio and, for subscription inference, OpenClaw's
bundled `openai` provider. A fresh one-shot invocation may reuse valid retained
authority after reconciliation; it is not a resumed conversation.

## Build and install

Prerequisites: Node.js 22 or later, npm, Git, and Docker for the host image.
The [Dockerfile](docker/Dockerfile) pins the base image and OpenClaw version.
Image construction downloads those upstream inputs; the packaged adapter's
consumer installation is offline.

From a new clone of this repository, enter `native/` and build the adapter:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test
chio_candidate="$(mktemp -d "${TMPDIR:-/tmp}/chio-openclaw.XXXXXX")"
npm run pack:release -- "$chio_candidate/artifacts"
```

The packer creates `chio-openclaw-kernel-0.1.0.tgz` and its `.sha256` sidecar.
It bundles the committed Chio dependencies without modifying the source
manifest or requiring sibling repositories. Keep the archive and checksum
together, and record the source commit used to build them.

Install into a separate consumer and build its host image:

```sh
npm install --prefix "$chio_candidate/consumer" --ignore-scripts --offline \
  --no-audit --no-fund --cache "$chio_candidate/empty-cache" \
  "$chio_candidate/artifacts/chio-openclaw-kernel-0.1.0.tgz"
chio_plugin="$chio_candidate/consumer/node_modules/@chio/openclaw-kernel"
node "$chio_plugin/scripts/build-container.mjs" \
  chio-openclaw-host:local-candidate \
  "$chio_candidate/artifacts/chio-openclaw-kernel-0.1.0.tgz"
chio_image="$(docker image inspect --format '{{.Id}}' chio-openclaw-host:local-candidate)"
```

The image builder verifies the archive against its sidecar before building.
The launcher requires the resulting immutable `sha256:...` image ID, not a
mutable tag. A checksum records byte identity; qualifying those bytes and their
source is covered by [release qualification](https://github.com/backbay-labs/chio-open-claw-plugin/blob/main/docs/RELEASE-QUALIFICATION.md).

## Prepare operator authority

Protected execution requires a compatible Chio kernel and a separately
confined resource service. The original public CLI `0.1.0` lacks the required
durable execution and delivery contract. Use an exact kernel/artifact pairing
from the [qualification records](https://github.com/backbay-labs/chio-open-claw-plugin/blob/main/native/evidence/2026-09-10/static-kernel-native/README.md);
compatible public delivery remains subject to the kernel's release gates.

Follow the bridge's [operator procedure](https://github.com/backbay-labs/chio-bridge/blob/main/ACCEPTANCE.md#operator-procedure)
to configure the kernel, persistent stores and resource boundary. Prepare a
private operator request with the kernel origin, distinct bootstrap/admin
credentials, trusted signer keys, selected tools and an operator-owned journal
directory. This is an operator step outside the OpenClaw container:

```sh
node "$chio_plugin/node_modules/@chio/bridge/dist/prepare-gateway.js" \
  /private/operator/request.json /private/operator/gateway.json
```

Replace the absolute example paths with private operator paths. Preparation
initializes bounded authority and discovers its permitted tools without
executing a protected tool. Keep the request, prepared configuration and journal
outside the agent boundary. The guest must have no direct kernel route or
protected resource mount. Starting the plugin alone does not provide confinement.

## Run a file workflow

Once the image and gateway are prepared, select one provider authentication
mode. For API billing, supply `OPENAI_API_KEY` in the trusted operator
environment and run:

```sh
node "$chio_plugin/scripts/protected.mjs" \
  --gateway-config /private/operator/gateway.json \
  --image "$chio_image" \
  --state-dir "$chio_candidate/file-workflow" \
  --prompt 'Use chio_call to write /workspace/approved.txt with "Draft", edit it to "Ready", read it back, and list /workspace.'
```

This workflow requires authority for all four operations and the target path.
Check the returned results and the independently owned file. If a tool is
denied, missing or fails, the task is incomplete even when the agent produces
a final answer.

For a ChatGPT/Codex subscription, authenticate with native Codex and explicitly
select its existing private cache instead:

```sh
node "$chio_plugin/scripts/protected.mjs" \
  --gateway-config /private/operator/gateway.json \
  --model-auth-file /private/native-codex-profile/auth.json \
  --image "$chio_image" \
  --state-dir "$chio_candidate/subscription-workflow" \
  --prompt 'Use chio_call to read /workspace/approved.txt.'
```

Each invocation requires a new state directory. The launcher refuses to reuse
one and does not read or modify a normal OpenClaw profile.

| Authentication | Pinned launcher selection |
| --- | --- |
| Operator `OPENAI_API_KEY` | `gpt-4.1-mini`, OpenAI API billing |
| Explicit `--model-auth-file` | `gpt-5.5`, native `openai-codex-responses`, PI runtime |

The launcher does not fall back between modes or providers. The subscription
cache must be an absolute, private, owned regular file. The parent reads its
access token and account routing identifier; it neither copies the cache into
the guest nor uses a refresh token. Refresh expired authentication through
native Codex. See OpenClaw's [OpenAI provider guide](https://docs.openclaw.ai/providers/openai)
for upstream context; this candidate's pinned source controls its actual route.

## Enforcement boundary

The trusted parent owns the gateway, journal, kernel credential and provider
credential. OpenClaw receives temporary gateway/model tokens inside a container
with a read-only root and configuration, an isolated writable state volume,
dropped capabilities, no privilege escalation, no Docker socket and no
protected filesystem mount.

The internal Docker network disables external DNS forwarding. A separate relay
exposes only fixed gateway and model routes. The model route accepts text and
inline `chio_call` functions; hosted tools, external item references, background
requests and alternate provider endpoints are rejected. The model requests one
tool per turn; the resource owner's delivery fence also governs overlapping
calls.

Native agent, session and tool-call identities bind the request. The gateway
and kernel bind its operator principal, capability, resource and exact
arguments. The guest verifies signed decisions and received result bytes. The
trusted model relay acknowledges completed delivery only when OpenClaw includes
that result in its native tool history, before the next model request. The
guest has no acknowledgement RPC. An uncertain outcome remains uncertain;
the launcher never silently redispatches it.

## Outcomes and run records

The private run directory contains `launch.json`, native stdout/stderr, model
relay observations and, when terminal classification completes, `terminal.json`.
Configuration and records can contain temporary guest tokens and tool content;
share evidence through an explicit file allowlist.

| Launcher exit | Meaning |
| --- | --- |
| `0` | Normal completion; still compare the requested work with verified results and independent resource observations. |
| `2` | Unresolved execution, delivery or cleanup. Preserve state and reconcile before more protected work. |
| `3` | Protected work incomplete, including a denied or failed tool. |
| `4` | Awaiting an exact operator approval. |

Other startup/host failures may return another nonzero status. The
[bridge approval procedure](https://github.com/backbay-labs/chio-bridge/blob/main/ACCEPTANCE.md#explicit-approval-proposals)
binds a decision to the retained request. Approval does not prove execution or
delivery. Unknown dispatched work cannot be converted into a new proposal.

## Recovery, upgrade and removal

Stop host admission on unresolved delivery. Preserve the original gateway
configuration, journal, kernel database and independent resource observations.
Use the bridge's [recovery procedure](https://github.com/backbay-labs/chio-bridge/blob/main/ACCEPTANCE.md#recovery-upgrade-and-removal)
with the original authority:

1. Inspect `status`. Use `recover-lock` only after the recorded owner process
   is proved dead; it removes a stale process lock, not an uncertain outcome.
2. For a verified completion already retained in the journal,
   `delivery-export CONFIG REQUEST_ID NEW_PRIVATE_FILE` exports that original
   result without dispatch. Read it and compare the resource, then run
   `delivery-acknowledge CONFIG RECEIVED_FILE`.
3. If the owner completed the operation but its result never reached the
   journal, use the separately qualified bridge operator's
   [`owner-result-import` procedure](https://github.com/backbay-labs/chio-bridge).
   The final native evidence pins a separate recovery archive; the adapter's
   frozen bundled bridge does not provide that command.

An unknown operation without verified terminal evidence remains fenced. Never
erase its journal, replace expired authority or invent a new request to repeat
uncertain work. After exact recovery, a fresh host may use the retained
configuration while its session and authority remain valid.

Upgrade into a separate installed package and checksum-identified image. Stop
admission and reconcile in-flight work first, retain old configuration/journals,
then qualify the new kernel/plugin pairing before switching. Removal starts
with stopping the host, revoking authority and preserving evidence. Remove only
the recorded isolated package, containers and volumes once unresolved outcomes
are reconciled; shared images and other profiles need separate ownership checks.

The cleanup watchdog starts before resource creation and checks recorded image
and network ownership. Normal exit removes agent/relay containers and their
network; state and control volumes named in `launch.json` remain for recovery.
After a crash, inspect the watchdog's records and stop only the recorded owned
containers. Failed inventory or cleanup remains unresolved. Cleanup never
acknowledges or redispatches work, and the recorded crash cutpoints do not prove
every possible creation-time schedule.

For exact tested cutpoints, archive identities, retained failures and upgrade/
removal observations, see the [native acceptance record](ACCEPTANCE.md) and
[later static-kernel evidence](https://github.com/backbay-labs/chio-open-claw-plugin/blob/main/native/evidence/2026-09-10/static-kernel-native/README.md).
Legacy profile/bootstrap and direct container procedures remain unqualified for
this protected boundary.
