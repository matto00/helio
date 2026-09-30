## Context
HEL-1185 set the pin at 2.18.10. New advisories make 2.18.11 the lowest fixing version. All six artifacts verified published at 2.18.11 on Maven Central.

## Decisions
Same shape as HEL-1185: bump all six pinned artifacts together (one consistent Jackson version), keep the lowest fixing version per the HEL-452 convention, extend the comment. No code change.

## Risks
Patch-level bump within 2.18.x; mitigated by full `sbt test` and a resolved-classpath check showing no Jackson artifact below 2.18.11.

## Gate-Chain Implications Checklist
Not applicable: no `.husky/**` or pre-commit-invoked script is touched.
