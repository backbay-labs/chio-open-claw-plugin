Supplemental disabled-tool fixed-provider batch; original harness result is FAILED. No rerun occurred.

The actual current r6 OpenClaw host returned Tool <name> not found with isError=true for all ten injected names: read, write, edit, exec, process, web_fetch, sessions_spawn, cron, gateway, config. The native result names and IDs exactly match the injected batch. Independent resource and audit observations were identical, no Chio journal records were created, and the private authority configuration stayed unchanged. diagnostic.json records these bounded observations.

The host retained ten toolResult messages but no unsupported assistant toolCall blocks. Its next provider request had no tool outputs. The fixed fixture expected ten outputs and asserted, causing the model relay to return 403 and the host/wrapper to exit 1. This final failure is fixture-induced; normal final-wrapper semantics were not qualified by this run. summary.json retains the original failed assertions. No current-host integration acceptance or live-model claim is made.

The provider response alone was fixed. The installed r6 launcher, container host, gateway and kernel were real. The fixture used synthetic local auth and made no real provider request. OS isolation, descendants and network controls are separately tested.
