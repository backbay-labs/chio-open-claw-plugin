# Historical OpenClaw log retention

This collection preserves 13 previously ignored logs from existing program
evidence directories. All 10,649 original bytes are retained in deterministic
gzip objects; the original files remain untouched. No matching tracked or
decompressed evidence file existed when the collection was added on 2026-09-10.
No host, build or test was rerun for this archival change.

| Original collection | Retained logs and purpose |
| --- | --- |
| [Container boundary](../container-boundary/README.md) | Three driver logs retain the positive-control timeout, the second attempt's host-exit assertion failure, and the third attempt's reported success. These are injected process probes, not model tool-dispatch proof. |
| [HTTP host delivery](../http-host-delivery/README.md) | Image-build output and the 18-test component transcript support the historical received-result repair record. The [artifact record](../http-host-delivery/artifact.json) binds archive `96f67ee3...`, image `38ab3845...` and kernel `33dd1dea...`. |
| [Native history acknowledgement](../native-history-ack/README.md) | Image-build output and a separate 18-test component transcript support the historical acknowledgement repair. The [artifact record](../native-history-ack/artifact.json) binds archive `f93ea848...`, image `6ba30a81...` and kernel `33dd1dea...`. |
| [Subscription r6 storage faults](../subscription-r6/kernel-storage/README.md) | Six helper start/restart messages preserve process identifiers for the three recorded owner lifecycles. Each case's existing `identity.json` binds archive `a79dbffa...`, image `7f925d68...` and kernel `33dd1dea...`. A process-start message does not prove readiness, authentication or a protected effect. |

Both image builds report a cached upstream OpenClaw installation layer; their
filenames do not establish that every build layer was uncached. Component tests
remain component tests. These logs supplement their original records without
reclassifying failures, qualifying current artifacts or closing acceptance gates.
They do not independently establish the executed source revision. Existing
artifact/identity records retain their original scope; the manifest's
`collectionBaseCommit` identifies archival context, not historical runtime source.

The credential/private-data review found zero matches to seven available
credential values and zero private-key, API-key, GitHub-token, bearer, JWT or
email-address pattern matches. Contents are test/build output, tracebacks,
public image identifiers, local test paths and process identifiers. Private
profiles, configuration contents, databases and unrelated caches are excluded.

`files.json` records every original path, byte count and SHA256 plus the gzip
object's path, byte count and SHA256. Verify compressed objects from this directory:

```sh
shasum -a 256 -c SHA256SUMS
```

Decompress an object with `gzip -dc raw/PATH.log.gz` to recover its exact original
bytes, then compare their SHA256 with `originalSha256` in the manifest.
