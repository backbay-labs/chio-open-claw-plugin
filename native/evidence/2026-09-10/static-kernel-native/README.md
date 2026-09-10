# Native OpenClaw final static-kernel observations

Status: **bounded local qualification evidence, not publication or full-program acceptance**.
Confidence is high for the exact observations below. These cases supplement the
coordinator's separate OpenClaw shared matrix and useful workflow. A hosted chat
gateway or another host's result does not establish native OpenClaw acceptance.

## Frozen inputs

- Kernel CLI `0.1.1-rc.1`, source `bafa02b06de93553cecb6f60b340f3dd8fd9b401`.
- Executed kernel SHA-256 `c03a8a711dbbd15da2c59655d9ab6d8f0068a20187363db7a78f4b5422ded93e`.
- Native OpenClaw `2026.5.20`, installed `@earendil-works/pi-*` packages `0.75.4`, Linux arm64, Node `22.23.1`.
- Host image `sha256:7f925d68ced724f4a6314ab76dc117e9000515ba62149ee971a11c510be6637f`.
- Adapter `@chio/openclaw-kernel@0.1.0`, archive SHA-256 `a79dbffa8356a608f22db847e100d1989cb7ff322ab1315144774decb2b13ab4`.
- Resource image `sha256:188cb84d5d0bb4063d4ce5a3b9c3832445a5acda5604911cda80a9136d1850a0`.
- Separate recovery operator bridge archive SHA-256 `02a0e4ad4e61ffb989302cae8774a9ae9ab8f647473f1926d1e671673169a37b`.
- Live-model cases use `gpt-5.5` through the native Codex Responses subscription
  provider. The parent uses the designated native Codex cache. Operator bearer
  credentials and subscription credentials are absent from the native guest.

The primary native, storage, budget and expiry drivers verify the selected
archive against all 1,075 regular installed files. The two-case native rerun
reuses that consumer. Lifecycle compares its consumer after each replacement.
The post-run comparison repeats the frozen current artifact check.
`verification.json` records the macOS operator, Docker engine, image identities
and actual installed host package versions. Static metadata probes launch Node
only with no network or writable root; they are not native agent tests. Their
initial incorrect package-path failures and corrected observations are retained.

The supported action inventory and operator procedure are in the
[native integration README](../../../README.md). The actual host runs in an
internal Docker network with a read-only root and config, no Docker socket,
no protected-resource mount, dropped capabilities and no privilege escalation.
Only the trusted kernel resource owner receives the protected filesystem volume.
The native model's usable protected tool surface is the explicit Chio adapter.
Excluded native file, shell/process, web, delegation, background, cron and
configuration paths remain disabled in this mode.

## Gate evidence in this record

| Gate | Completed behavior | Boundary |
| --- | --- | --- |
| I01 | Cold archived consumer byte verification; offline old/current candidate install using empty caches and a nonfunctional registry endpoint; actual image package identity. | The coordinator owns complete cold delivery and publication. This record does not infer public artifact availability. |
| I02 | Actual native positive controls, original-result recovery followed by native read, and three paired healthy reads succeed with verified delivery. | The separate complete write/edit/read/list useful workflow belongs to the coordinator's OpenClaw record. |
| I03 | Independent processes in the actual live native container, both direct and descendants, cannot read protected resources/operator config, use a Docker socket, alter config/plugin/root or connect directly to the host. The approved relay connection and isolated state remain usable. Ten exact excluded-tool results in native history produce zero dispatch, journal operations or resource changes. | Forced provider responses are supplemental native-host evidence, not live inference. Unsupported consequential modes remain disabled. |
| I04 | Lost result, gateway crash, operator cancellation, actual 40-second native plugin timeout, early launcher failure, missing watchdog and three enforcer faults preserve truthful outcomes and prevent new effects. | Missing entrypoint/omitted plugin refuse startup; a crashing executor is exercised by an actual native call. Kernel absent/killed/malformed/timeout cases are in the coordinator's matrix. |
| I05 | One original authority permits three distinct native calls and refuses the fourth. Actual kernel-issued 20-second capability binding expires in real time; the delegated credential is clamped, and expired startup causes zero dispatch. | Other identity, revocation and approval cases are in the coordinator's OpenClaw matrix. Credential-only expiry is not substituted for capability expiry. |
| I06 | Final-hop substituted result bytes are rejected before trusted delivery. Native output reports an unverified outcome and the original completed read remains unacknowledged. Separate lost-response/gateway-crash cases and lifecycle verify original signed owner-result recovery; lifecycle also exercises wrong-signer refusal across adapter replacement. | Completed but unverified effects are recorded as effects, never claimed prevented. Other evidence mutations belong to the coordinator's exact-host matrix. |
| I07 | Four dispatch/persistence cutpoints and all three real kernel SQLite cutpoints pass; same-authority native retries remain fenced after unlock and supported restart. | Original failed attempts remain failed. Fresh independent passing cases do not claim to recover their old authorities. Unknown outcomes are never silently redispatched. |
| I08 | Offline candidate upgrade retains the original configuration, journal and effect; native relaunch stays fenced; explicit signed owner-result recovery permits a native read; scoped revocation blocks relaunch; selected adapter and six exact disposable guest volumes are removed after history export. | Owner databases, protected resource/audit volumes, original config/journal, shared images and unrelated profiles remain preserved. No published legacy upgrade is inferred. |

## Source-to-observation map

Paths below are relative to `raw/`. Original text and JSON are stored as lossless
`.gz` files. `raw/files.json` maps original paths and both byte identities.

| Directory | Observations |
| --- | --- |
| `chio-final-openclaw-native-20260910` | Native tool error, lost response, cancellation, timeout, four cutpoints, three enforcer failures, two early launch failures, live-container confinement, paired reads and two supplemental native fixtures. Original failed result-substitution/gateway-crash runs, VM diagnostics and pause/resume interventions remain present. |
| `chio-final-openclaw-native-rerun-20260910` | Independent result-substitution and gateway-crash reruns after load reduction. Both pass through the unchanged installed native host. |
| `chio-final-openclaw-budget-20260910` | Original failed budget run: one verified write occurred before native host exit 137. The gate did not complete. |
| `chio-final-openclaw-budget-r2-20260910` | Fresh original authority: three allowed native calls, fourth refused; supported owner stop recorded. |
| `chio-final-openclaw-expiry-20260910` | Actual owner-DB capability binding, real expiry, refused protected startup, zero dispatch; supported owner stop recorded. |
| `chio-final-openclaw-lifecycle-20260910` | Offline v5-to-r6 candidate upgrade, original authority/effect preservation, native fence, signed recovery, revocation, six scoped volume removals, adapter uninstall and supported owner stop. |
| `chio-final-openclaw-storage-20260910` | Passing after-admission; interrupted after-receipt observation; before-admission setup failure before an authority existed. |
| `chio-final-openclaw-storage-r2-20260910` | Fresh passing after-receipt and before-admission cases. Explicit diagnostics-only helper source `27130de3c1e54293fa3203b563210f83e84161cd` and Python 3.14 are pinned in the retained driver. |
| `chio-final-openclaw-storage-after-receipt-followup-20260910` | Original-authority continuation failed during read-only SQLite observation before launching a native host. Exact failed helper process/streams plus later read-only path/mode diagnostics are retained. |
| `chio-final-openclaw-storage-after-receipt-followup-r2-20260910` | Original-authority snapshot succeeded; native launcher preflight refused because the original transport session had expired while paused. No new authority was issued. |

The OpenClaw substitution case differs from Hermes: its controlled unknown
result is forwarded in a second model turn, and the native response reports the
unverified outcome. Forged bytes are absent from exported native stdout. This
case does not export native history or exercise a separate recovery phase.
Consequently it does not prove that model progress stops; its direct observation
is rejected trusted delivery, zero ACK and a truthful unverified result.

## Storage effects and the interrupted original authority

| Passing case | Port | Fault effects | Retry and restart observation |
| --- | --- | --- | --- |
| Original after-admission | 59280 | One original write before completion persistence fails. | The same-action native retry after unlock and a new-action native request after same-owner restart cause no new dispatch or ACK. |
| Fresh after-receipt | 59282 | One original write before receipt append failure. | The same-action native retry after unlock and a new-action native request after same-owner restart cause no new dispatch or ACK. |
| Fresh before-admission | 59283 | Zero fault effects while the actual admission database is locked. | The same-action native retry after unlock and a new-action native request after same-owner restart remain fenced with no dispatch. |

Each passing case has four native invocations: positive, faulted action,
same-action retry after unlock and new-action request after restart. These are
two retries per case, six total. They use actual newly generated native call IDs,
not a forced replay of the original call ID. Every passing case first completes
one independent positive native write and one verified delivery ACK. The controller uses actual SQLite `BEGIN IMMEDIATE` and
`ROLLBACK`. Post-effect tests hold the original resource response only after an
independent observer records its effect, then forward those unchanged bytes
after acquiring the selected lock. No row, schema, clock or application source
is edited. Each passing case retains original unresolved state and resources.

The original after-receipt case at port 59278 completed its positive and fault
observations, then the snapshot helper failed. A later continuation hit SQLite
`unable to open database file` before native launch. Read-only diagnostics record
exact URI construction, DB/WAL/SHM/parent modes and ownership, Python/SQLite
versions and subsequent successful reads. The precise failing database/extended
SQLite code was not captured at the original failure, so a restoration race or
interpreter-specific cause is not asserted. The diagnostics helper repair only
retains nested process outputs; it does not change timing, assertions or runtime.

The next continuation observed the same resource and journal, but the kernel's
transport-session tombstone was `Expired`: idle expiry was approximately
07:18:27 UTC, while its delegated credential expiry was 08:02:19 UTC. The native
launcher refused before dispatch. The original config, session ID and authority
were preserved; there was no renewal or replacement. A credential TTL alone does
not establish that its transport session is live. This interrupted original
case remains unresolved; the fresh passing case does not recover it.

## VM load, failure preservation and supplemental fixtures

During the initial overlap, the shared Colima VM had 4,095,369,216 bytes of RAM.
Kernel diagnostics show global OOM kills of OpenClaw agent tasks. The original
budget/native failures returned host exit 137 during that period. A one-to-one
mapping between every killed kernel task and each host container was not
established and is not claimed. The coordinator drained completed older owners
without deleting their state. Native OpenClaw work then ran sequentially.
No VM restart was used. A paused outer-driver elapsed interval is not host
latency; exact process and pause/resume records remain in the failed run.

The supplementary two-call fixture records two exact native results: one
verified/acknowledged write, a second `not_dispatched` response, one dispatch
and an absent second file. Launcher exit 3 truthfully reports incomplete work.
The excluded-tool fixture records ten exact native unavailable-tool errors,
unchanged resource/audit and config, and zero journal records. Both use the real
native runtime with an explicitly forced local provider stream. Neither is
live inference or independent proof of complete host acceptance.

## Bounded timing and integrity

Three paired native/direct reads produce six observed control/native reads and
no file changes. Median kernel-minus-direct interval is 399.427541 ms; median
gateway-minus-direct interval is 437.152792 ms. The direct control uses same-image
MCP stdio with a tmpfs audit; native resource audit is persistent. The measured
kernel interval includes HTTP/SDK consumption, and the gateway interval includes
journal/verification/serialization. Container startup, model inference, native
plugin scheduling and delivery ACK are excluded. These three observations do
not isolate kernel cost or support a performance guarantee.

The export contains 1,049 lossless raw files and 1,051 raw checksum entries.
Every compressed file is decompressed and compared with its original bytes.
Known private-credential byte scanning finds zero matches; private config,
databases, authentication files, consumers and package caches are excluded.
Interrupted continuation directories are explicitly exported as interrupted
attempts, with actual helper process/stream records, not invented successful
native runs. Reproduce using retained driver snapshots and the frozen artifacts
with fresh ports and names. Never clear or reuse the original failed authority
to obtain a passing result. Publication and the remaining coordinator-owned
acceptance/delivery records are separate requirements.

## Final scoped owner stop

After all assigned host cases completed, the coordinator explicitly authorized
stopping the remaining 6 solely owned OpenClaw test kernels, including failed
and intentionally unknown cases. The supported helper checked each exact PID
and owner database path before signaling it. Configuration, credentials and
journal bytes were unchanged; database files, resource volumes and audit volumes
remain retained. No unknown result was recovered and no authority was renewed.
The separate `owner-drain/` export contains 15 lossless files and exact stop
commands, streams, file hashes and retained-state observations. This drain does
not change any preceding failure or acceptance assertion.
