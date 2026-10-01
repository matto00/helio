## 1. Baseline (on unchanged main / sbt 1.10.10)

- [x] 1.1 Dump `testGrouping` as sorted `group -> sorted test classes` (default count 8, and count=3) to the scratchpad; verify files non-empty and total test classes equals `definedTests` size

## 2. Backend / build

- [x] 2.1 Set `backend/project/build.properties` to sbt 2.0.9 and sbt-assembly to a sbt-2 release in `plugins.sbt`; verify `sbt` loads and reports the errors honestly
- [x] 2.2 Opt `Test / testGrouping` out of caching and record the remedy and the two declines at the definition site; verify the build loads and the grouping body is textually unchanged (git diff)
- [x] 2.3 Fix any further load/compile errors sbt 2 raises with minimal build.sbt edits (no library bumps, Jackson 2.18.11 untouched); verify `sbt compile Test/compile`
- [x] 2.4 Make the assembly jar's location stable (or update Dockerfile) and verify CI/Dockerfile/cd-backend sbt invocations still work; list any non-build.sbt changes

## 3. Verification

- [x] 3.1 Dump grouping on sbt 2; diff against 1.1 byte-for-byte (both count settings); verify empty diff
- [x] 3.2 Run full `nice -n 19 sbt test` twice consecutively (one at a time); verify green both, record counts
- [x] 3.3 `sbt assembly`, boot the jar against the dev DB, `curl /health` returns 200; verify and record
- [x] 3.4 `sbt generateSbom` still works; record the result
- [x] 3.5 Write a handoff note on what PR #489 needs (rebase vs Dependabot recreate)
