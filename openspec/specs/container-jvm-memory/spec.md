# container-jvm-memory Specification

## Purpose
Configures JVM container support flags so the heap is sized relative to the container memory limit, not host RAM — preventing OOM kills on Cloud Run.
## Requirements
### Requirement: JVM heap bounded by container memory limit
The backend container SHALL configure the JVM to respect the container's cgroup memory limit
by setting `-XX:+UseContainerSupport`, `-XX:MaxRAMPercentage=75.0`, and `-XX:InitialRAMPercentage=50.0`
in the container ENTRYPOINT so the JVM does not size its heap based on the host machine's total RAM.

#### Scenario: Container launched with 512m memory limit uses bounded heap
- **WHEN** the backend container is started with a 512m memory limit (e.g. `docker run -m 512m`)
- **THEN** the JVM MaxHeapSize SHALL be approximately 384m (75% of 512m), not a fraction of host RAM

