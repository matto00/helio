## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Read ticket.md, proposal.md, design.md, tasks.md. No TODO/TBD placeholders; proposal, design and tasks agree with each other.
- Ground truth on availability (curl to Maven Central, HTTP 200): org/scala-sbt/sbt/2.0.9 pom exists; com/eed3si9n/sbt-assembly_sbt2_3/2.5.0 pom exists. So the "escalate if no sbt 2 plugin" branch is not triggered.
- backend/build.sbt testGrouping (hash bucket floorMod(name.hashCode, count), names hel924-group-N, env overrides HEL924_TEST_GROUP_COUNT/CONCURRENCY) matches the design's description; plugins.sbt has the single sbt-assembly 2.3.1 line; build.properties 1.10.10.
- Dockerfile copies build.properties/plugins.sbt before `sbt update` and copies /build/backend/target/scala-2.13/helio-backend.jar: the stated jar-path risk is real, and the plan (assemblyOutputPath, else edit Dockerfile) covers it. ci.yml invokes `sbt compile test`, `sbt -batch generateSbom`, `sbt run` as stated.
- Every AC maps to a task: loads/test runs (2.1-2.3, 3.2), grouping unchanged (1.1, 3.1), green twice (3.2), in-source remedy record (2.2), PR #489 goes green (3.5 handoff; acceptable as it depends on Dependabot).
- Scope is bounded to the build-tool migration; non-goals match the ticket's driver scope.

### Verdict: CONFIRM

### Non-blocking notes
- ci.yml cache key is hashFiles('**/build.sbt') only; build.properties/plugins.sbt changes alone will not bust it. build.sbt will change in this PR so it is fine here, but note it in 2.4's list of observations.
- sbt 2 compiles build.sbt with Scala 3: besides testGrouping, watch ForkOptions(...) named-arg constructor, `exclude(...)` syntax, `generateSbom` (uses streams.value/target.value, and a File result must be cacheable; consider Def.uncached there if it errors), and `Test / envVars`/loadDotEnv. Task 2.3 already allows minimal fixes; just make sure 3.4 checks the SBOM output is still produced (not served stale from cache).
- Task 2.4 should explicitly exercise `sbt run` (CI e2e, backend start) under sbt 2 -- the Compile/run/mainClass pin and fork behave differently in sbt 2 -- not only assembly. Dockerfile installs sbt from the apt repo (launcher version unpinned); confirm the launcher honours sbt.version=2.0.9 (or simulate the builder commands, as the design already allows).
- Grouping proof: ensure the dump key is the test class name set per group on both versions, and that definedTests count matches; the design already says this.
- docs/cloud-dev-setup.md installs sbt 1.10.7 and CONTRIBUTING.md describes the grouping; update the doc if a launcher >= sbt 2 is needed (only if sbt 2 breaks it).
