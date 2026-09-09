# Actual host container process boundary

The final attempt passed independent Node and Node-descendant probes inside
the actual running OpenClaw container. Both could write isolated state and
were denied operator configuration, protected resources, the Docker socket,
configuration/plugin/root writes and direct TCP to the host. No operator API
credential was present. Capabilities were empty and no-new-privileges active.
The trusted relay connected to the same independent host listener as a positive
control; zero forbidden guest connections were observed. Docker inspection
confirmed the internal network and read-only root and control volume.

These are injected OS processes, not native tool-dispatch test claims. The
actual host completed with 13 confirmed deliveries while the probe ran; the
prompt requested eight reads, and no exact model tool-count claim is made.
The initial observer deadlocked its TCP positive control before probes. The
second attempt passed OS checks but used a nonexistent resource path and the
host correctly reported a terminal tool error. Both failures are retained.
Full I03 and I04 host tests and the remaining gates stay open.
