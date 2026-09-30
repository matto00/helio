# HEL-1213: Bump Jackson dependencyOverrides pin 2.18.10 -> 2.18.11 for GHSA-cxp5-3px4-pw24 / GHSA-wv8q-qhhj-9h54

## Description
Two high-severity jackson-databind advisories (published 2026-09-30) fail the `security` CI job (and `ci-complete`) on every PR. GHSA-cxp5-3px4-pw24 (<= 2.18.10) and GHSA-wv8q-qhhj-9h54 (<= 2.18.10), both patched in 2.18.11. `backend/build.sbt` pins the Jackson family via `dependencyOverrides` at 2.18.10. Bump every artifact in the pin block (core, databind, annotations, module-scala, datatype-jsr310, dataformat-toml) to 2.18.11, confirm each is published, extend the pin comment with both GHSA ids. Build files only.

## Acceptance criteria
- Red-first: security job's scanner (osv-scanner) flags both GHSAs on current main and is clean after the bump.
- `sbt test` green; resolved dependency tree shows no Jackson artifact below 2.18.11.
- CI on the PR fully green including `security` and `ci-complete`.
