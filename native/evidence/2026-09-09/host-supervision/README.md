# OpenClaw launcher-death supervision

The selected cold-installed package and its immutable image are identified in
artifact.json. An actual native OpenClaw session wrote through the real kernel;
the trusted launcher was then killed before returning the completed result.
The separate lifeline watchdog removed the run containers and network without
operator cleanup and preserved both evidence volumes. Independent Docker
inspection verified absence. The original unacknowledged write stayed fenced;
explicit result recovery enabled one read without repeating the write.

The previous actual-host crash record in ../gateway-crash left both containers
running and needed operator cleanup. Its failure is not erased by this repair.
A component regression verifies Docker inventory failure reports unresolved
cleanup rather than false absence. This component test is not a host test.

This candidate also ran useful write/edit/read/list, both forbidden operations,
response loss and explicit recovery, substituted result rejection, aggregate
budget, all seven approval stages, capability and credential revocation before
launch, and both revocations during native execution. Every native attempt and
independent resource observation is retained. Kernel fault cases are retained
separately in ../kernel-faults. Early container-creation crash cutpoints, full
upgrade/removal qualification and public release remain unresolved.
