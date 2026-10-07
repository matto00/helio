# HEL-1367: Fix main CI: osv-scanner GHSA-mcr4-qmvw-px4g in backend lz4-java

## Description

Main CI's `security` job (osv-scanner) is red because of a new advisory, **GHSA-mcr4-qmvw-px4g**, against `lz4-java` in the backend dependency tree.

* Last green: 54c2f222e, run 37681541205, 2026-10-07 20:22Z.
* First red: d125b6541, run 37685121434, 20:50Z. That merge didn't touch dependencies, so the advisory itself is new.

`ci-complete` depends on `security`, so **no PR can merge** until this is fixed.

## Do

* Read the advisory: affected versions, whether a fixed version exists, severity, and whether our use of lz4-java is affected.
* Find out which dependency pulls lz4-java in (Spark, Kafka clients, etc.).
* Prefer a version bump or dependency override to a fixed version. Prove that `sbt testFull` passes and that osv-scanner is clean.
* If no fixed version exists: escalate to the owner with a proposed allowlist entry limited to this dependency path, giving the reason and a review-by date. Follow the existing pattern in the osv-scanner config.

Owner ruled 2026-10-07 to treat this as urgent and give it a lane immediately.

## Acceptance Criteria (derived from "Do")

1. The advisory's affected ranges, fix version, severity and reachability are recorded (design.md).
2. The dependency path that pulls lz4-java is identified from the real resolved tree (design.md).
3. The backend resolves lz4-java to a version OSV lists as fixed for GHSA-mcr4-qmvw-px4g; no new suppression is added.
4. `sbt testFull` passes on the change.
5. osv-scanner against the regenerated SBOM reports no unsuppressed CVSS>=7 group; CI's `security` job is green on the PR.
