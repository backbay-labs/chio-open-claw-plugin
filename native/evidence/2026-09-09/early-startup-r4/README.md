# OpenClaw cleanup ownership before resource creation

The delivered r3 launcher created a relay before starting its cleanup watchdog.
An actual SIGKILL immediately after relay creation left the relay and its network
alive for 12 seconds. The protected resource stayed unchanged. The harness
recorded and explicitly removed only those exact observed objects; volumes were
retained. No native agent had started at this cutpoint.

The r4 launcher writes its ownership manifest and waits for watchdog readiness
before creating any network, volume or relay. The independently cold-installed
archive passed the same actual Docker crash test: relay and network disappeared
automatically, state volumes remained, and protected resources stayed unchanged.
A separate deliberately missing watchdog in a disposable package copy refused
startup before native creation with zero resource effects. These are startup
lifecycle and preflight observations, not model-driven native host sessions.

Nineteen component tests pass with zero skips. The archive installs offline with
an empty cache. Its host image is unchanged because this repair runs in the
external trusted launcher; no newer plugin image is claimed. Full native
provider reruns are blocked by exhausted OpenAI API credits. The artifact is a
pending candidate, not a replacement set of accepted host results. In-flight
Docker creation and other watchdog failure cutpoints remain unqualified.
