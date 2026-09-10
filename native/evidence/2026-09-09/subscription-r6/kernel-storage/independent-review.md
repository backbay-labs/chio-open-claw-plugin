# Read-only evidence review

An independent worker reviewed the completed driver and retained evidence without
editing source, starting hosts or mutating any resource. It matched all 12 native
calls to returned tool-result IDs, four distinct native IDs/sessions per case,
and original configuration and authority hashes. Observed outcomes were
`completed`, `unknown`, `not_dispatched`, `not_dispatched` in every case.

The reviewer identified that the original driver's generic failure assertions
alone did not establish each fault-specific kernel state. The retained records
resolved that gap, and the separate read-only verifier now explicitly checks
those transitions and errors:

- Before admission: zero effects, no fault admission operation or durable outcome.
- After admission: one effect; `dispatch_committed` becomes `outcome_unknown_after_dispatch` on supported restart; no fault durable outcome.
- After receipt: one effect; completed admission and durable outcome; actual receipt append timeout retained in the fenced owner record.

The original call/latch stays fenced and unchanged, only the positive is
acknowledged, and all post-fault observer snapshots match. Lock/effect/release
chronology is consistent. Exact-original-ID replay is not claimed: the native
attempts have new IDs and use the original authority and retained gateway fence.

The review checked signature retention without cryptographically verifying it.
The subsequent `state-verification.json` performs the separate 51 Ed25519 checks,
using the pinned SDK canonicalizer and original configured trusted signer, and
binds principal, session, capability, resource and fault tool/parameter hash.
These are local agent review and executable verification, not an external audit.
