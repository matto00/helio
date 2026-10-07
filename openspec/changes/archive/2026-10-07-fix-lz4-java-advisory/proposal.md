## Why

Main CI's `security` job is red: osv-scanner reports GHSA-mcr4-qmvw-px4g (CVSS 7.3, published 2026-10-07T20:35Z) against
the backend's lz4-java. `ci-complete` depends on `security`, so no PR can merge.

The backend pins `org.lz4:lz4-java:1.8.1` (HEL-452). On Maven Central that coordinate is now a Sonatype **relocation POM**
to `at.yawk.lz4:lz4-java:1.8.1` -- the maintained successor of the abandoned org.lz4 project, same `net.jpountz.*`
packages. The resolved classpath artifact is therefore `at.yawk.lz4:lz4-java:1.8.1`, which OSV lists as affected
(fixed in 1.11.4). A fixed version exists, so no allowlist entry is needed.

## What Changes

- Backend resolves lz4-java to `at.yawk.lz4:lz4-java:1.11.4` (the minimal fixed version), with exactly one lz4-java jar
  on the compile classpath (no `org.lz4` real jar left alongside it).
- The two lz4 suppressions in `backend/osv-scanner.toml` (GHSA-cmp6-m4wj-q63q, GHSA-xx22-p4ch-683r), justified as
  "no fixed version exists", are removed: at.yawk 1.11.4 fixes both (fixed 1.10.1 / 1.11.1), so the justification is
  now false and the suppressions would mask a regression.
- `build.sbt` comment updated to record the relocation and the cleared advisories.

## Capabilities

### New Capabilities
- `backend-dependency-security`: backend lz4-java resolves to a version with no known OSV advisory, with no lz4 suppression.

### Modified Capabilities

## Impact

`backend/build.sbt`, `backend/osv-scanner.toml`. Runtime: Spark 3.5.9's LZ4 compression codec (shuffle/broadcast) now
runs on lz4-java 1.11.4. No API, schema or frontend change.

## Non-goals

- Spark upgrade; other suppressed advisories (aircompressor, zookeeper); changes to the CI security job itself.
