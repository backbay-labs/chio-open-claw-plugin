# Native OpenClaw acceptance record

Status: **qualification candidate, not published or accepted**. Confidence in
the recorded bounded observations is high. Document 19 requires six accepted
hosts and I01-I08. The current record is [subscription r6](evidence/2026-09-09/subscription-r6/README.md).
The [historical snapshot](evidence/2026-09-09/subscription-r6/historical-acceptance-pre-r6.md)
is preserved; its version pins and open issues do not describe the current candidate.

## Exact candidate

| Component | Identity |
| --- | --- |
| Native integration | `@chio/openclaw-kernel@0.1.0`, runtime commit `f6627ae` |
| Archive SHA-256 | `a79dbffa8356a608f22db847e100d1989cb7ff322ab1315144774decb2b13ab4` |
| Host | OpenClaw `2026.5.20` (`e510042`), PI `0.75.4`, Linux arm64, Node `22.23.1` |
| Host image | `sha256:7f925d68ced724f4a6314ab76dc117e9000515ba62149ee971a11c510be6637f` |
| Kernel SHA-256 | `33dd1dea21a4ca5ecddeab4f30f6b06b0b90c513f0987aef552b0633d9da1e25` |
| Resource image | `sha256:188cb84d5d0bb4063d4ce5a3b9c3832445a5acda5604911cda80a9136d1850a0` |
| Runtime bridge | Bundled `@chio/bridge@0.3.0`, archive prefix `7d9e34f7408a`, bundled SDK `0.1.1-rc.1` |
| Recovery operator archive | Separate bridge SHA-256 `02a0e4ad4e61ffb989302cae8774a9ae9ab8f647473f1926d1e671673169a37b` |
| Live inference | OpenClaw `openai-codex`, `gpt-5.5`, PI, native Responses SSE, explicit ChatGPT subscription cache |

Exact archive/installed source comparisons, cold installations, commands,
configuration hashes, operating environment and raw observations are retained.
Later evidence/test/documentation commits do not change the frozen archive.
The original `@chio/openclaw@0.2.0` hosted chat gateway remains a separate product.

## Supported mode and action inventory

This mode is a one-shot local OpenClaw agent performing controlled remote file
work through `chio_call`. The Chio filesystem resource owner performs effects.
The native agent has no protected resource mount, Docker socket, operator file
or credential. The trusted parent retains the scoped kernel credential, journal
and model credential; the guest receives temporary local relay tokens only.

The agent runs as UID 1000 with read-only root/configuration, all capabilities
dropped, `no-new-privileges`, internal network and no external DNS. The isolated
writable state volume holds its conversation. Fixed gateway and text-only model
routes are the only relayed paths. The parent acknowledges a completed result
only after it appears in the actual native tool history. A precheck never grants
unrestricted execution and the guest has no acknowledgement RPC.

| Surface | Enforcing point and disposition |
| --- | --- |
| `chio_call` write/edit/read/list | Kernel checks principal, session, capability, scope, resource, exact request and policy; separate resource server executes; independent audit and file observer |
| Native file tools, patches | Explicit native policy removes them; OS also denies protected/config/plugin access |
| Shell, process, git, background jobs | Runtime tools disabled; descendants retain the same OS boundary |
| Network, browser, search, media, remote nodes | Native tools disabled; internal network blocks direct host TCP and external DNS; fixed text model and kernel routes only |
| Other MCP/custom tools, plugins, skills | No direct MCP servers; empty skills; Chio and pinned bundled `openai` inference provider only |
| Delegation, subagents, ACP, session sending | Tools and ACP disabled |
| Channels, messages, cron, heartbeat | No channels; hooks/cron off; heartbeat zero; no live platform messages sent |
| Configuration, policy and plugin tampering | Administrative commands disabled; configuration/plugin code read-only; operator files absent |
| Restart and recovery | New isolated host under retained authority; unknown/unacknowledged states stay fenced; explicit signed-original-result recovery does not repeat writes |
| Conversation resume and persistent services | Disabled in the one-shot mode; new native invocation is tested separately |

The mode promises useful file workflows. It does not promise unrestricted coding
shells, channel bots, scheduling or delegated agents. Those surfaces are disabled.

Upstream contracts: [native tools](https://docs.openclaw.ai/plugins/building-plugins#registering-agent-tools),
[manifest](https://docs.openclaw.ai/plugins/manifest),
[tool policy](https://docs.openclaw.ai/gateway/config-tools),
[sandboxing](https://docs.openclaw.ai/gateway/sandboxing),
[OpenAI provider](https://docs.openclaw.ai/providers/openai) and
[OAuth](https://docs.openclaw.ai/concepts/oauth). Pinned installed source and
actual behavior control where current web documentation differs.

## Gate observations

| Gate | Current bounded evidence |
| --- | --- |
| I01 | Exact archive installed offline with empty cache and unreachable registry; real pinned host activation; no private sibling dependency in the installed runtime |
| I02 | Live native subscription completes write/edit/read/list with four verified deliveries and independently observed results; missing-file read truthfully returns signed completed tool error, exit 3 |
| I03 | Real forbidden read/write denied before resource dispatch; actual container parent/descendant probes cannot access resource/operator/socket/config/plugin/direct TCP; trusted relay network positive control succeeds |
| I04 | Kernel absent, killed, malformed, timed out and selected route refused prevent new effects; missing plugin, executor crash and silent omission refuse work; startup and post-effect cleanup recorded |
| I05 | Capability and credential expiry separately tested; revocation before/during work; wrong principal/session/resource; escalation; aggregate budget; pending/missing/substituted/rejected approvals; exact approved replay and fresh-authority restoration |
| I06 | Foreign receipt, signer, request and result substitution rejected; forged owner import rejected; original signed result recovered without dispatch; delivery binds native history |
| I07 | Pre-dispatch/post-effect cancellation, response loss, gateway SIGKILL, retained-authority restart, concurrent owners, explicit recovery and client journal EIO before/after effect; supplemental parallel fixture tracked separately |
| I08 | Cold install, retained-state upgrade, explicit recovery, revocation and scoped removal observed; required public release gates remain open |

The current record retains each failed attempt and selected fault cutpoint.
Client journal EIO does not prove kernel receipt-store or signing behavior; those
require distinct program evidence. Native durations include inference and do
not measure incremental Chio overhead without a matched baseline.

The r6 quota repair closes an independently reproduced race: v5 forwarded 110
concurrent requests under a budget of 100; the unchanged reproducer observes
100 forwards and 10 rejections on r6. v5 is superseded, including where it is
explicitly used as an old-package lifecycle fixture. These local technical
observations imply neither publication, independent adoption nor novelty.
