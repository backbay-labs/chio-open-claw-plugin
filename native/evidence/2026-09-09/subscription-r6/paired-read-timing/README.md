# Three paired healthy read observations

All three real OpenClaw subscription reads completed through frozen r6, verified
their evidence, and acknowledged delivery under one unchanged prepared grant.
The direct controls returned identical content. Independent before/after resource
hashes stayed unchanged, and the native resource audit added exactly three reads.
No storage-fault owner was touched.

| Pair and order | Direct resource ms | Kernel exchange ms | Parent gateway ms | Kernel minus direct ms | Gateway minus direct ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1: native, direct | 195.329 | 1509.611 | 1561.701 | 1314.282 | 1366.372 |
| 2: direct, native | 39.153 | 1042.976 | 1089.103 | 1003.824 | 1049.950 |
| 3: native, direct | 760.655 | 1226.645 | 1279.827 | 465.990 | 519.172 |
| Median | 195.329 | 1226.645 | 1279.827 | 1003.824 | 1049.950 |

The final two columns are paired differences. Their medians are calculated from
the three differences, rather than subtracting the independent column medians.
Raw floating-point intervals and operation bindings are in [summary.json](summary.json)
and [pairs.json](pairs.json). Each `pair-N/` retains native history, actual commands,
terminal outcome, acknowledged journal records, instrumentation and direct RPC.

## Exact measurement boundaries

- **Direct resource:** monotonic time immediately before writing/flushing a
  `tools/call` JSON-RPC frame to an already initialized resource process until
  its matching JSON response has been parsed. Resource/container initialization
  is excluded. The process uses the same immutable resource image and volume
  through a read-only mount, no network, dropped capabilities and a separate
  ephemeral audit directory. This trusted operator control has no kernel
  capability and is not an agent-accessible route.
- **Kernel exchange:** trusted parent `fetch` invocation for the exact kernel
  `tools/call` until the SDK consumes the terminal response. The SDK uses its
  stream reader; the instrumentation captures reader completion/cancellation
  after terminal RPC parsing as well as text consumption. This includes HTTP,
  authorization, durable execution, the resource call, signing, persistence and
  SDK response consumption. Post-response bridge verification is excluded.
- **Parent gateway:** trusted parent receives the native `/mcp` request until
  immediately before `ServerResponse.end` writes its result. This includes
  request ingestion, journal work, kernel exchange, evidence verification and
  response serialization. Guest tool scheduling and result delivery are outside
  this interval.

Both native intervals exclude launcher/container startup, model inference,
native host/plugin scheduling and delivery acknowledgement. The actual host
and installed plugin are unchanged; the timestamp preload runs only in the
trusted parent. Instrumentation records tool arguments and timings without
logging provider credentials or model request bodies.

These are three local observations, not a statistically representative benchmark
or pure plugin cost. HTTP and Docker stdio transports differ; native resource
audit uses the persistent owner volume while the direct control uses tmpfs.
Those differences are included, not normalized away. The observed direct
variation also limits any extrapolation to end-to-end workload performance.

## Reproduction and identity

The driver is [paired-read-timing.py](../../../../test/paired-read-timing.py) and
the trusted parent preload is [kernel-read-timing.mjs](../../../../test/kernel-read-timing.mjs).
The [identity record](identity.json) pins the exact archive, images, kernel,
policy, driver, instrumentation and original private configuration hash.
[Owner confirmation](owner-artifact-confirmation.json) independently hashes the
immutable binary and policy snapshot. The only target was
`read_text_file({"path":"/workspace/approved.txt"})`, pre-existing and independently
observed with SHA-256
`f26ae1416dc8534ef464bef8437ffeaf19012c409f55d9e414a01d71c3a1939d`.
No missing-file setup attempt is omitted.

Run the driver with explicit `--operator-state`, `--package-dir`, `--archive`,
`--image`, `--model-auth-file`, `--path` and a fresh `--output` directory. It
requires the allowed target to exist, prepares one fresh scoped authority,
warms the direct MCP process, runs native/direct, direct/native, native/direct,
checks exact native arguments and identical results, and independently observes
the final resource hashes and audit. Private credentials stay in operator state.
The recorded healthy owner is port 58618 and is left running with its original
resource, configuration and journals retained.

[Credential scan](credential-scan.json) found zero exact-value leaks across 53
exported files and six retained guest volumes (21 files), checking 35 private
values. [Independent review](independent-review.json) confirmed the installed SDK
terminal parsing boundary, native identity/arguments, result equality, delivery
acknowledgements and interval arithmetic without additional resource effects.
