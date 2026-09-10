Supplemental fixed-provider native batch fixture, not live-model acceptance.

The current r6 archive and container launched the actual OpenClaw host against the designated Chio kernel. A trusted-parent preload supplied one fixed Responses stream containing two chio_call writes; it left the production parallel_tool_calls=false request unchanged. Synthetic fixture auth was used; no real provider credential or provider request was used.

Both exact calls and returns are retained in native-history.json. The first completed with verified evidence and exactly one observed write; the second returned not_dispatched with zero protected effect. The original configuration was unchanged. The host exited 0, while the production wrapper truthfully exited 3 with protected_work_incomplete and one confirmed delivery. No retry occurred. Independent snapshots and audit rows are in before.json and after.json.

identity.json pins archive, image, kernel, source harness, launcher, and authority configuration. harness-at-run.mjs preserves the exact executed fixture before the optional disabled-tool variant was added.

The supplemental disabled-tools attempt retains its original harness failure and diagnostic. The separately authorized disabled-tools-r2 run passed exact native error-ID/name correlation and independent zero-effect checks; its final wrapper status is recorded separately from useful-work acceptance.
