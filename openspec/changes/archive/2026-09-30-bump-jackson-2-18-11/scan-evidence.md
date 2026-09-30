# HEL-1213 osv-scanner red/green evidence
Scanner: osv-scanner 2.5.1, `backend/osv-scanner.toml`; SBOM via `sbt -batch generateSbom` (252 components both runs).

## RED (unmodified tree, pins 2.18.10) — exit=1
- jackson-databind 2.18.10: GHSA-cxp5-3px4-pw24, GHSA-wv8q-qhhj-9h54

## GREEN (pins 2.18.11) — exit=0, zero vulnerability ids reported
Jackson components in SBOM: all six at 2.18.11 (annotations, core, databind, dataformat-toml, datatype-jsr310, module-scala_2.13).

## Resolved classpath (show Runtime/managedClasspath)
jackson-annotations/core/databind/dataformat-toml/datatype-jsr310 = 2.18.11.
Finding (pre-existing, not introduced here): jackson-dataformat-yaml-2.15.2.jar is on the Test/Runtime managedClasspath only (absent from Compile and from the SBOM), unpinned before and after this change, including in HEL-1185's precedent. Out of scope; spinoff candidate.

## sbt test
exit=0; 4941 tests run, 4941 succeeded, 0 failed, 336 suites, no flakes.
