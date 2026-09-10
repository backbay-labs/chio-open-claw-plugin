Historical snapshot only. Superseded by native/ACCEPTANCE.md and the r6 record. Its open issues and version pins describe earlier candidates and are not current acceptance findings.

# OpenClaw acceptance record

Current candidate includes the atomic model-request quota repair. Its full
subscription matrix is recorded in [subscription r6](evidence/2026-09-09/subscription-r6/README.md).
The earlier subscription candidate is superseded: see [native subscription qualification](evidence/2026-09-09/native-subscription/README.md)
for the r4 launcher plus the officially supported ChatGPT/Codex provider route,
its cold-installed artifact, and three passing actual host cases. The existing
[HTTP host delivery](evidence/2026-09-09/http-host-delivery/README.md) records the
underlying launcher boundary and earlier host cases.
Status remains unaccepted. The older profiles, bootstrap authority and transport
records below are historical and do not establish the current boundary.

Program status: **unaccepted**. Confidence in the bounded observations below is
high. Completion of all document 19 gates remains unresolved.

Concrete shared boundary blocker: the recorded runtime configuration contains a
bootstrap bearer capable of initializing another kernel session and obtaining
fresh authority. A host process must instead receive a credential restricted to
its retained session. The shared kernel and bridge owners are implementing that
change; the package and tests below do not inherit acceptance from it.

## Baseline

- Owning repository: `chio-open-claw-plugin`, clean `main` at
  `e9440c738477cc224c8c3f6257d3d5965cc15fb0` before this work.
- Original package: `@chio/openclaw@0.2.0`, hosted Slack/Discord/Telegram gateway.
  It has no native OpenClaw runtime plugin. Existing smoke/unit results do not
  qualify the native host.
- Native candidate: `@chio/openclaw-kernel@0.1.0` in `native/`.
- Real installed host: `OpenClaw 2026.5.20 (e510042)`, executable
  `/opt/homebrew/bin/openclaw`, package `/opt/homebrew/lib/node_modules/openclaw`.
- npm host artifact metadata, checked 2026-09-09:
  `sha512-cgshS76CxS3Vp9NGtJR2UGtVZxVR5/4rvok8DKGGL19DugAftNabsXfYajyAEiJ3dC8QTXNqF62MdQNzUnQe8Q==`.
  This registry integrity does not by itself prove the installed directory is
  byte-for-byte identical to the registry tarball.
- Native host test environment: macOS arm64, Node `25.5.0`. Final isolated host:
  Linux arm64, Node `22.23.1`, image
  `sha256:39fed560462bb68bf7f091d37f63a408a11bad9c1444e31cda88d31181fcda9e`.
  Runtime source hashes were independently extracted from that image and are
  recorded with its tested source. The later runtime-profile repair changes
  `src/profile.mjs`; it requires a new container qualification. Exact OS releases
  and cases are retained in evidence.
- Bridge candidate: `@chio/bridge@0.3.0`, bundled with SDK
  `@chio-protocol/sdk@0.1.1-rc.1`; exact archive hash is retained with the vendor
  package and release evidence. Final bridge SHA-256:
  `68b5c46638449710e3251f41aa1317f364c24138ae6cba3f45aeea51960ef3ff`.
  These candidates are not published versions.
- Final real kernel source: `04b7d366d62c886c39bc202f58ef0d44e8f5aee7`.
  Binary SHA-256: `e7539855906bd5eb7b4eb2e5a12ca0533889cf61ced3bf4adf5850b792aa6447`.
  Immutable policy SHA-256: `8c2c732d9115799b13150f7924da0e68fc1f9b2d42a2618912511d407035cc66`.
  Separate filesystem resource image:
  `sha256:0106edcb15a1c0d12d914ea0504f0e63ec85f5e6fdd3825b4d7a0d1367af3991`;
  resource volume `chio-required-agents-final-20260909`.
- Earlier `kernel-native` and initial container experiments used a mutable
  development binary whose exact pre-overwrite hash was not retained. Preserve
  them as historical bounded observations; final kernel claims use only
  `evidence/20260909/kernel-container-final` and the public provenance snapshot.

## Verified extension contract

The installed SDK's `src/plugins/tool-types.d.ts` defines optional tool factories
with trusted `agentId`, `sessionId`, `sessionKey`, and current config. The native
plugin manifest declares `contracts.tools`; `registerTool` registers behavior.
The pre-tool hook can block, but neither hook success nor an approval precheck
proves resource mediation. The plugin therefore invokes the kernel-owned tool
service and never implements protected local effects.

Authoritative current references, checked 2026-09-09:

- [Native tool registration](https://docs.openclaw.ai/plugins/building-plugins#registering-agent-tools)
- [Native plugin manifest](https://docs.openclaw.ai/plugins/manifest)
- [Tool policy and groups](https://docs.openclaw.ai/gateway/config-tools)
- [Plugin hook contract](https://docs.openclaw.ai/plugins/hooks)
- [Sandbox boundaries](https://docs.openclaw.ai/gateway/sandboxing)
- [Gateway tool-invoke API](https://docs.openclaw.ai/gateway/tools-invoke-http-api)

Current web documentation can differ from the pinned installed release. Runtime
observations and the installed version's shipped SDK/docs control this candidate.

## Action inventory for the proposed supported mode

| Host path | Enforcing point and resource owner | Candidate disposition |
| --- | --- | --- |
| `chio_call` to `read_text_file`, `write_file`, `edit_file`, `list_directory` | Kernel MCP edge validates operator-bound authority and performs resource server dispatch; separate resource container owns files | Useful real host workflow observed; scope/revocation/budget matrix incomplete |
| Native `read`, `write`, `edit`, `apply_patch` | OpenClaw global tool policy removes all native tools before inference and dispatch | Disabled; actual host forced-call and independent file/read observer cases |
| `exec`, shell aliases, shell indirection and child processes | Native runtime group denied; no shell tool advertised or dispatched | Disabled; real host command/descendant probes and native observer controls |
| `process`, background jobs | Runtime group denied | Disabled; forced host path tested; asynchronous residual process lifecycle not accepted |
| `web_fetch`, `web_search`, browser, media URLs, remote nodes | Native tools denied; only kernel transport and operator model transport remain intentional | Disabled; local request-count observer probes; full OS network isolation unresolved |
| Direct MCP/custom tools and other plugins | No `mcp.servers`; plugin allowlist only `chio-kernel`; exact tool exposure | Disabled; advertised list checked on every model request; forced custom tool probe |
| `sessions_spawn`, `sessions_send`, `subagents`, ACP | Native tools denied, ACP disabled | Disabled; forced runtime probes. Delegation is not promised by this candidate |
| Cron, heartbeat, gateway control and native commands | Cron/browser/hooks off, zero heartbeat interval, chat commands off, native tools denied | Disabled; forced tool probes. Channel-triggered jobs are outside this mode and disabled |
| Slack, Discord, Telegram and other channel ingress/egress | No configured enabled channels | Disabled; no live messages were sent |
| Restart and resumed conversations | Stable host-context operation IDs and fsynced journal; pending ownership keyed to subject/resource server across host sessions | Actual host process restart/resume read and fresh-session fence observed; unresolved dispatch needs manual reconciliation |
| Config/policy tampering | Native file/shell/gateway/plugin commands absent; runtime config revalidated; container config mounted read-only | Unit regression, forced tool paths, recorded namespace and mount observations; complete attack matrix unresolved |
| Bootstrap/skill reads and provider calls | Empty skill allowlist, skipped bootstrap, isolated workspace; model endpoint is operator configured | Model requests observed; no unrestricted native file tools |

The restricted mode promises useful controlled file workflows. It does not
promise shell development, live channel bots, scheduling or delegated agents.
Those paths remain disabled, not silently omitted from acceptance.

## Gates and remaining gaps

| Gate | Current evidence | Open requirements |
| --- | --- | --- |
| I01 | Native tarball installed with empty npm cache and unreachable registry into disposable profile; actual OpenClaw discovery and activation; final kernel/image provenance retained; generated profile refuses existing directory | Final published compatible combination and full installation matrix |
| I02 | Actual containerized OpenClaw turns write/read/edit/list via real kernel; signed completed results; independent read-only Docker observer confirms file contents | Complete acceptance scope and non-deterministic model workflow qualification |
| I03 | Forbidden kernel read/write produce signed denies and unchanged resource fixtures; native alternate tools suppressed; host uid 1000, no protected mount/socket, read-only root and config | Broader path tricks/resource fencing, complete configuration-tamper and network matrix |
| I04 | Missing plugin refuses host startup; native tools stay unavailable; bridge/kernel unreachable before call yields not_dispatched with no file change | Live kernel termination/interruption/timeout between calls and dispatch/commit cuts, malformed responses, hook crash/timeout complete matrix |
| I05 | Wrong configured capability rejected before dispatch; kernel-issued valid authority enables useful calls | Expiry, revocation, wrong principal/resource/session, escalation, aggregate budgets, pending/rejected approval, restoration |
| I06 | Bridge verifies pinned signer, authority, request and completed output; raw signed evidence retained | Real host substitution/forgery/malformed evidence tests; separate OpenClaw session authority proof |
| I07 | Restart/resume reads work; a fresh host session cannot bypass a pending authority fence; explicit operator reconciliation recorded after independently observed denial; 12 journal/caller/result/profile tests pass | Real-host cancellation, unknown-outcome reconciliation/restart and resource handoff fencing |
| I08 | Offline candidate package and new-profile generator implemented; actual CLI removal preserves restricted tool policy and refuses a new session | Published artifacts, qualified upgrade/recovery and measured overhead across required workflows |

Required missing cases are unresolved. Unit fixtures and the deterministic local
model are explicitly identified. No evidence from other hosts closes a gate here.

`candidate-lifecycle` records nine actual CLI steps including clean offline
installation, profile overwrite refusal, discovery, validation and removal.
It uses no valid authority or model provider. `authority-bootstrap-blocker.json`
records a failed fresh-session preparation, before any protected host tool call.
The revocation and 64-invocation budget scenarios are implemented in the host
runner but have not executed successfully and remain required unresolved cases.

Installed-host resolver inspection demonstrated that an exact model runtime
override superseded the required PI provider while the profile validator
accepted it. `runtime-policy-override-finding.json` retains that reproduction.
The repair rejects runtime overrides and per-agent operational/skill settings.
`runtime-profile-repair` records three actual host cases: the ordinary restricted
tool remains callable, while a Codex runtime override and per-agent skill
override each fail before a model request. This is host configuration evidence,
not a new real-kernel acceptance run.

## Evidence interpretation

`native-final-transport` records 28 actual native-host contract cases with the
final bridge. `kernel-container-final` records 10 real-host cases against the
immutable kernel and resource volume, including useful file work and a fresh
host session that remains fenced after a signed denial. The two denial fences
were released by explicit operator test actions after independent resource
observations; these are recorded interventions, not automatic recovery.

The original runner's `summary.json` has a conservative generic unresolved list
and records the macOS orchestrator environment. For the final container's actual
runtime identity, use `runtime-identity.json`, `host-os-boundary.json`,
`host-image-identity.json`, the raw commands, and the kernel provenance snapshot.
The final npm artifact installed by the harness and the archive baked into the
host image have the same SHA-256, `74d3d2432198c73216b30ec2f25e977b923db0e3e616005aed1da85789764fa4`.
Both are recorded in `evidence-index.json`. Later documentation or dependency
changes produce new package identities and do not inherit full-artifact testing.

Independent review found and drove fixes for a completed-operation race, cached
responses surviving authority changes, and pending fences being bypassed by host
session rollover. Deterministic regressions cover these mechanisms. Their tests
prove local journal behavior, not kernel resource deduplication.
