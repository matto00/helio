## Why

Without explicit JVM memory flags, the JVM inside a container defaults to sizing the heap based on the host machine's total RAM rather than the container's memory limit — this can cause OOM kills and unpredictable memory usage. Setting `-XX:MaxRAMPercentage` ensures the JVM respects the cgroup memory limit imposed by the container runtime.

## What Changes

- Add `-XX:MaxRAMPercentage=75.0` (and `-XX:InitialRAMPercentage=50.0`) to the backend container's `CMD` or `ENTRYPOINT`
- Add `-XX:+UseContainerSupport` to ensure container-aware memory detection is explicitly enabled (default in JDK 11+ but worth making explicit)

## Capabilities

### New Capabilities
- `container-jvm-memory`: JVM heap bounded by container memory limit via RAM percentage flags

### Modified Capabilities
<!-- None — no existing capability requirements change -->

## Non-goals

- Changing GC algorithm selection
- Tuning thread pool or stack sizes
- Any application-level code changes

## Impact

- `backend/Dockerfile` (or equivalent): CMD/ENTRYPOINT line updated with JVM flags
- No API, schema, or frontend changes
- Existing tests and application behavior are unaffected
