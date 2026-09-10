# OpenClaw subscription r6 qualification

Status: **local qualification candidate, not published or fully accepted**.
All recorded passing cases below used the frozen r6 package and image except
explicitly labeled fault images and the superseded v5 upgrade fixture. No test
result from another host closes an OpenClaw gate. Program completion still
requires six accepted integrations and the required release gates.

## Identity and compatible delivery

- Package `@chio/openclaw-kernel@0.1.0`, runtime commit `f6627ae`.
- Archive SHA-256 `a79dbffa8356a608f22db847e100d1989cb7ff322ab1315144774decb2b13ab4`.
- Host image `sha256:7f925d68ced724f4a6314ab76dc117e9000515ba62149ee971a11c510be6637f`.
- OpenClaw `2026.5.20` (`e510042`), PI `0.75.4`, Linux arm64, Node `22.23.1`.
- Kernel SHA-256 `33dd1dea21a4ca5ecddeab4f30f6b06b0b90c513f0987aef552b0633d9da1e25`.
- Resource image `sha256:188cb84d5d0bb4063d4ce5a3b9c3832445a5acda5604911cda80a9136d1850a0`.
- Bundled runtime bridge archive prefix `7d9e34f7408a`, bridge `0.3.0`, bundled SDK `0.1.1-rc.1`.
- Separate recovery operator archive SHA-256 `02a0e4ad4e61ffb989302cae8774a9ae9ab8f647473f1926d1e671673169a37b`.

[Artifact comparison](artifact.json) binds each runtime file to the cold archive.
[Cold installation](cold-install.json) uses an empty npm cache, offline mode and
unreachable registry. [Container build](container-build.txt) pins the host image.
The source documentation and acceptance tests added afterward do not mutate the
frozen delivered runtime. The root candidate bundle ships the separate operator
archive and `resource-owner/export-owner-outcome.py`; owner-result import does
not rely on an undisclosed source checkout. Runtime bridge 7d9 and operator
bridge 02a0 have distinct roles and must not be conflated.

Official OpenClaw subscription support is implemented by the canonical
`openai-codex` provider and native Responses transport, with PI explicit. Live
cases use `gpt-5.5` through the fixed ChatGPT Codex Responses endpoint. The parent
reads the designated existing native Codex cache without copying it to the
container or refreshing it. Guest credentials are temporary local relay tokens.
API billing is a separate existing mode and was not newly qualified here.

## Actual host, live subscription and real kernel

| Evidence | Result and boundary |
| --- | --- |
| [Native cases](native-cases-summary.json) | Eight cases pass: useful four-operation workflow, forbidden sensitive read, forbidden write, completed tool error, lost response, substituted result, post-effect gateway SIGKILL, post-effect SIGTERM cancellation |
| [Main matrix](matrix/runs.json) | 26 suite invocations pass, including approvals, before/during-call revocation, kernel absence/kill/malformed/timeout, credential expiry, caller/session/resource mismatches, escalation, evidence substitution, explicit recovery and concurrent owner refusal |
| [Aggregate budget](budget/results.json) | Same authority writes, edits and reads with three dispatches; fourth list request denied with zero additional dispatch; session rollover does not refill budget |
| [Actual capability expiry](expired-capability) | Short-lived kernel capability verified against owner database, then expired before native dispatch; distinct from expired bearer credential |
| [Native plugin timeout](native-plugin-timeout/timeout-proof.json) | Actual 40-second native HTTP timeout, one retained original effect, no delivery ACK, same-authority fence and explicit original-result recovery |
| [Failure cutpoints](final-cutpoints/results.json) | All four pass: cancel held native call before dispatch, selected route refused while original kernel remains live, journal reservation EIO before effect, journal completion EIO after exactly one effect |
| [Alternate resource tools](alternate-resource-tools/runs.json) | Forbidden edit, sensitive dry-run edit, sensitive list, sensitive parent-segment path and forbidden-write dot alias all denied with exact native arguments, zero resource dispatch and unchanged observer |
| [Additional paths](resource-paths/results.json) and [outside-root repeat](resource-escape-rerun/results.json) | Parent-segment sensitive read and `/etc/passwd` denied before dispatch; first outside-root harness expected a later tool error and falsely failed on stronger kernel denial; corrected repeat passes |
| [Upgrade and removal](upgrade-removal/summary.json) | Empty-cache offline r6 install preserves original v5 unknown/config/journal; same-authority host stays fenced; signed original recovery and read succeed; revoked authority prevents launch; scoped removal preserves owner/resource/journal/evidence |

Raw host invocation and native histories are retained separately from wrapper
exit codes. A host exit 0 alone never means requested work completed. In the
missing-file case, native OpenClaw delivers a signed completed tool error;
the trusted parent acknowledges its delivery while reporting protected work
incomplete with exit 3. That truthful error is distinct from a denied dispatch.

Unknown outcomes stay fenced across new native host invocations. Client journal
EIO after effect leaves the owner `completed_unacknowledged`, no acknowledgement,
and no repeated write. The selected network fault targets only the second call;
the real kernel retains the same PID and remains reachable. Before-dispatch
cancellation and reservation failure produce no owner dispatch or file effect.
These are client/transport fault observations, not kernel receipt-store/signing
fault claims.

For original-result recovery, the operator first rejects a forged owner export
with `owner record lacks a trusted valid signature`. The exact signed original
record is then imported, inspected and acknowledged; the following real host
performs only a read. The observer verifies no recovery write. The separate
operator artifact is needed only for this explicit recovery procedure.

## Real native host with explicit bounded fault fixtures

[Parallel native fixture](parallel-native-fixture/summary.json) supplies two
`chio_call` items in one fixed Responses stream to the unchanged native host.
Both appear in native history with results. The first completes one verified
write; the second is `not_dispatched`, with no second resource effect. Native
exit 0 is converted to truthful wrapper exit 3, protected work incomplete. This
is supplemental parallel scheduling evidence, not live-model inference.

The [disabled-tool fixture](parallel-native-fixture/disabled-tools-r2/README.md)
correlates ten exact injected call IDs/names with native `Tool <name> not found`
errors. Resource/audit snapshots, configuration and journal remain unchanged.
The initial fixture wrongly required unsupported assistant blocks retained in
history and induced a final provider error; it remains failed in `disabled-tools/`.
The corrected fixture accepts OpenClaw's observed unsupported-tool transport
contract and ends with an explicit statement that no protected operation completed.
Its host/wrapper exit 0 records conversation completion, not useful work.

[Enforcer faults](enforcer-faults-local-base/results.json) use operator-built
derivative images of the exact immutable host. A removed plugin entrypoint
fails loading; a registered executor throws after an actual native `chio_call`;
both produce no effect. A silently empty plugin is rejected by OpenClaw before
inference with `No callable tools remain after resolving explicit tool allowlist`.
The original harness expected inference and incorrectly failed this stronger
refusal. The [corrected isolated repeat](enforcer-silent-omission-rerun/results.json)
passes; original evidence is preserved. Fault derivatives are never release
candidates. Their exact image IDs and Dockerfiles are retained.

[Startup crash](startup-crash) and [missing watchdog](missing-watchdog) prove
bounded launcher startup refusal/cleanup before native inference; they are not
useful-work or real-model acceptance. Post-effect crash/cancellation tests are
separate actual native host cases with retained original effects.

## Independent OS and resource observations

[Live container probe](container-boundary-one-read/observation.json) checks both
an independent process inside the actual running native agent container and its
descendant. Resource, operator configuration, Docker socket, configuration/plugin
writes, root writes and direct host TCP are denied. Isolated state writes work.
UID, dropped capabilities, no-new-privileges, internal network and exact mounts
are recorded. A trusted relay successfully reaches the same TCP observer,
proving that zero guest connections is a meaningful negative observation.

The [two-read correction](container-boundary-verified-resource/corrected-analysis.json)
retains an original harness false failure: optional `meta.toolSummary.calls` was
absent, but exact native JSONL proves both requested calls and the trusted parent
confirms both deliveries. The separate one-read repeat passes unchanged controls.
An earlier one-of-two model stop and a wrong missing resource fixture remain
recorded unsuccessful workload attempts; neither is promoted to useful work.

[Observer negative controls](observer-negative-controls/results.json) deliberately
use trusted operator resource access. A forbidden-file write is detected and its
original bytes restored; a sensitive resource read produces the expected audited
read entry. No agent participates in these controls. The host denial tests are
separate. This proves the observer detects the effects it claims absent.

[Credential scan](credential-scan.json) checks exact values from the private
native model cache, bootstrap/admin credentials and delegated kernel credentials
against exported evidence and retained guest volumes. Temporary local relay
tokens are intentionally excluded. Volumes removed by the tested lifecycle are
listed explicitly; their native histories were exported before removal.

## Failures retained, interventions and limits

The independently reproduced v5 model relay race forwarded 110 concurrent
requests under a budget of 100. r6 reserves quota atomically after body validation
and before awaiting forwarding. The unchanged independent regression observes
100 forwards and 10 rejections; the component suite passes 25 tests with zero
skips. No provider is contacted by that HTTP concurrency regression.

Initial v5 route, provider-enable, SSE framing and incomplete-model-workflow
failures remain in the preceding native-subscription record. A fault runner
initially used an OCI image ID as a Dockerfile FROM repository and failed before
host execution; that build log remains in `enforcer-faults/`. A task-local tag
whose immutable image ID was verified repaired the harness. None of these
failed attempts are hidden by the later passes.

Normal cases require no operator action beyond scoped preparation and launch.
Fault cases retain explicit injected cutpoints. Recovery requires original-state
inspection and acknowledgement; revocation and removal are intentional operator
actions. Upgrade uses a new consumer and current immutable image, retaining the
same original authority and unknown journal until recovery completes.

[Native durations](native-durations.json) record host-reported durations, including
inference; the useful four-tool turn took 23.664 seconds. The [launcher envelope](launcher-envelope.json) was 29.147 seconds from manifest
to terminal for that workflow, including 5.483 seconds outside the native reported
duration. This excludes post-terminal cleanup. No matched unprotected baseline
is available, so full incremental Chio overhead is not inferred.
The public/native publisher and its security/release gates are a separate open
I08 requirement. Kernel receipt-store/signing faults require distinct program
records. Local qualification does not establish publication, adoption or novelty.
