## Context

The backend container uses `eclipse-temurin:21-jre-alpine` as its runtime base. The current `ENTRYPOINT` in `Dockerfile` is:

```
ENTRYPOINT ["java", "-Dconfig.resource=application.conf", "-jar", "helio-backend.jar"]
```

No JVM memory flags are set. JDK 11+ supports `UseContainerSupport` by default, but without `MaxRAMPercentage` the JVM may claim up to 25% of container RAM for heap (the ergonomic default), and without explicit tuning it is inconsistent across environments.

## Goals / Non-Goals

**Goals:**
- Ensure the JVM heap is bounded by the container's cgroup memory limit, not the host's total RAM
- Set heap to ~75% of the container limit (`-XX:MaxRAMPercentage=75.0`) with an initial allocation of ~50% (`-XX:InitialRAMPercentage=50.0`)
- Make `UseContainerSupport` explicit even though it's the JDK 21 default

**Non-Goals:**
- Changing GC algorithm
- Tuning thread count, stack sizes, or metaspace
- Any application, API, or frontend changes

## Decisions

### Decision: Modify `ENTRYPOINT` in `Dockerfile` (not a wrapper script)

The Dockerfile uses the exec form of `ENTRYPOINT` with flags listed directly. Adding JVM flags here is consistent with the existing pattern and avoids adding a shell wrapper script that would obscure signal handling.

Alternatives considered:
- `JAVA_TOOL_OPTIONS` env var: portable but less visible and harder to audit at a glance
- Wrapper shell script: more flexible but unnecessary for this scope

### Decision: Use `MaxRAMPercentage=75.0` and `InitialRAMPercentage=50.0`

75% is a well-established safe margin — it leaves ~25% for the OS, JVM off-heap (Netty/Akka direct buffers, metaspace), and HikariCP. 50% initial avoids a large upfront allocation in low-traffic environments.

### Decision: Keep `UseContainerSupport` explicit

JDK 11+ enables it by default, but making it explicit serves as documentation and guards against accidental base-image downgrades.

## Risks / Trade-offs

- **Risk: MaxRAMPercentage too high for workloads with large off-heap usage** → Mitigation: 75% is conservative; monitor actual container memory if pressure is observed
- **Risk: No runtime tests for heap sizing in CI** → Mitigation: ticket requires manual verification with `docker run -m 512m`

## Planner Notes

Self-approved: this is a single-file, single-line change to a Dockerfile with no API, schema, or application-code impact. No escalation needed.

## Migration Plan

1. Update `Dockerfile` ENTRYPOINT
2. Build and run: `docker run -m 512m <image> java -XX:+PrintFlagsFinal -version 2>&1 | grep MaxHeapSize` to confirm ~384m
3. No rollback complexity — revert is a single-line change
