# Actual native OpenClaw kernel storage faults

All three requested cases passed on the unchanged r6 archive
`a79dbffa8356a608f22db847e100d1989cb7ff322ab1315144774decb2b13ab4`,
host image `sha256:7f925d68ced724f4a6314ab76dc117e9000515ba62149ee971a11c510be6637f`
and kernel `33dd1dea21a4ca5ecddeab4f30f6b06b0b90c513f0987aef552b0633d9da1e25`.
These are actual native OpenClaw turns using the live ChatGPT subscription.
The resource image is
`sha256:188cb84d5d0bb4063d4ce5a3b9c3832445a5acda5604911cda80a9136d1850a0`.
No adapter, kernel or resource implementation was modified.

| Case | Dedicated owner | Effect during fault | Durable state |
| --- | --- | ---: | --- |
| Before admission | `openclaw-r6-before-admission`, port 58524 | 0 | No fault admission operation or tool outcome |
| After resource effect, admission store | `openclaw-r6-after-admission`, port 58525 | 1 | `dispatch_committed` while locked; `outcome_unknown_after_dispatch` after same-owner restart; no fault tool outcome |
| After resource effect, receipt store | `openclaw-r6-after-receipt`, port 58523 | 1 | Completed durable admission and tool outcome remain; receipt append fails |

Each fresh owner first executed one useful native write to `positive.txt`. Its
result was delivered and acknowledged by the actual host. The operator then held
`BEGIN IMMEDIATE` on the real SQLite store and released it with `ROLLBACK`. No
rows, schemas or clocks were edited. For the two post-effect cases an explicitly
recorded test-only stdio barrier holds the actual resource response until an
independent observer confirms the file and audited dispatch, then acquires the
store lock before releasing that genuine response. The pre-admission case
holds the store before the native request and does not use the response barrier.

The signed delegated records retain the actual kernel errors:

- Before/after admission: `durable admission failed: admission operation store is unavailable: database is locked`.
- After receipt: `receipt persistence failed: sqlite receipt commit append timed out after 5000ms`.

Each faulted native call returns `unknown`; the wrapper exits 2 and reports
unresolved work. Only the earlier positive remains acknowledged. The original
fault call and owner latch stay fenced, with identical persisted signatures,
through lock release, a same-action attempt, supported restart of the same owner,
and an attempt at a different action. All subsequent observations match the
original fault result: no repeated write and no new file.

The four native invocations in each case have distinct real native IDs and
matching returned outcomes `[completed, unknown, not_dispatched, not_dispatched]`.
They use the same original private configuration, credential, capability,
subject, session and resource binding. These are native new-ID attempts stopped
by the retained trusted gateway fence. They are not forced exact-ID kernel
replay tests. No replacement authority, unknown-result ACK, journal deletion or
administrative recovery was used. The original resource volumes and databases
remain intact, and all three owners are left running.

`summary.json` and `runs.json` in each case record driver assertions and exact
native commands. The raw native histories, journals, independent snapshots,
lock/release markers, resource barrier response, helper-at-run sources and
signed database rows are retained. `state-verification.json` adds a read-only,
state-specific audit of all three storage paths. It cryptographically verifies
51 stored call/latch signatures with the pinned SDK's RFC8785 canonicalizer and
Ed25519, binding them to the original configured signer, principal, session,
capability, resource and fault tool/parameter hash. The exact retained kernel
error is signed even where ordinary kernel logging omits it.

The runner is `native/test/kernel-storage-fault.py`; each case's `identity.json`
records its hash and every immutable runtime dependency. Reproduction requires
fresh case names, ports and output directories: the owner helper intentionally
refuses existing state. `native/test/verify-kernel-storage.mjs` verifies existing
public evidence without dispatch or authority issuance. The credential scan
covers the exported storage evidence and its retained guest volumes against the
exact designated private model/operator/kernel credentials.

This closes the requested bounded SQLite fault observations, separately from
client-journal EIO. It does not simulate an external signer that the selected
software Ed25519 path does not use, or claim release/publication acceptance.
