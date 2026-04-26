# HEL-90: Tune JVM flags for container memory limits

## Title
Tune JVM flags for container memory limits

## Description
Set `-XX:MaxRAMPercentage=75.0` (or similar) in the CMD/ENTRYPOINT so the JVM respects the container memory limit. Verify with `docker run -m 512m` and inspect heap sizing.

## Acceptance Criteria
- JVM is configured with `-XX:MaxRAMPercentage=75.0` (or similar flag) in the container entrypoint/CMD
- The JVM respects the container memory limit rather than the host's total RAM
- Verified with `docker run -m 512m` — heap sizing should reflect the 512m limit (approximately 384m max heap)
