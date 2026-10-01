## Context

See proposal.md. `Test / testGrouping` in `backend/build.sbt` hash-buckets `(Test / definedTests)` by `floorMod(t.name.hashCode, 8)` into
forked `Tests.Group`s named `hel924-group-<idx>`, and `Global / concurrentRestrictions` caps `Tags.ForkedTestGroup` at 4. This stops ~110
EmbeddedPostgres suites starting at once (HEL-924). The Dockerfile builds with `sbt update` / `sbt assembly` and copies
`backend/target/scala-2.13/helio-backend.jar`; sbt 2 relocates build output (`target/out/jvm/...`), so that path is a known risk.
CI runs `sbt compile test`, `sbt -batch generateSbom`, `sbt run`.

## Goals / Non-Goals

**Goals:** sbt 2 loads and runs the suite; grouping provably identical; assembly jar builds and boots; CD path intact.
**Non-Goals:** library bumps, Jackson changes, any grouping/concurrency change.

## Decisions

1. **Remedy: opt out of caching** (`Def.uncached` or `@transient`, whichever sbt 2.0.9 actually accepts for a `:=` key definition on a
   scoped key; the executor verifies against the real error text). Rationale: the task result is a list of closures over
   `ForkOptions`/`TestDefinition`s, recomputed in milliseconds, and its inputs include env vars and `definedTests`; caching buys nothing.
   Alternative (3), a `given JsonFormat[Seq[Tests.Group]]`, means serialising a type we do not own (Group holds a `RunPolicy`
   with `ForkOptions`) and risks a stale cached grouping silently diverging from `definedTests`, the isolation-critical input. Declined.
   Alternatives (1) vs (2): pick one deliberately, record both declines in a comment at the definition.
2. **Grouping-unchanged proof:** before touching anything, a throwaway sbt task/command (not committed, or committed only if tiny and inert)
   dumps `testGrouping` as sorted `groupName -> sorted test class names` on sbt 1.10.10 (main) and again on sbt 2.0.9; the two dumps are
   diffed byte-for-byte. Also confirm `HEL924_TEST_GROUP_COUNT`/`CONCURRENCY` env overrides still work (dump with count=3). Note: `String.hashCode`
   is stable across JVMs, so the dump is deterministic. Test-class set differences caused by sbt 2 test discovery would themselves be a finding.
3. **Plugin:** sbt-assembly 2.5.0 (what #489 selects) if it supports sbt 2; otherwise escalate. No other plugins exist (`plugins.sbt` has one line).
4. **CD path:** Dockerfile `COPY backend/project/build.properties` already precedes `sbt update`, so the version pin reaches the builder; verify jar output
   path under sbt 2 and either set `assembly / assemblyOutputPath` so the artifact keeps its documented location or update Dockerfile `COPY --from`. Prefer the build.sbt
   setting (single place, no CD/Dockerfile edit). Prove: `sbt assembly` yields the jar, `java -jar` boots against the dev DB, `/health` returns 200. If a Docker build
   is infeasible locally, simulate the builder stage commands and say so.
5. **Suite runs:** two consecutive full `sbt test` runs under `nice -n 19`, one at a time, never concurrent with another.

## Risks / Trade-offs

- sbt 2 changes the layout of `target` -> CI cache keys/paths (`~/.sbt`, `target`) may need review. Mitigation: read ci.yml cache blocks; adjust only if broken.
- sbt 2 test forking/classloader differences could change flakiness -> two consecutive green runs required; compare to the main baseline.
- Hidden build.sbt syntax incompatibilities beyond testGrouping (e.g. `generateSbom` task, `loadDotEnv`) -> surfaced by loading; fix minimally.

## Planner Notes

Self-approved: skip_specs (tooling only); opt-out remedy rather than JsonFormat; assemblyOutputPath preferred over editing the Dockerfile.
Verified at Planning: ticket line numbers and PR #489 contents (sbt 2.0.9, sbt-assembly 2.5.0, Jackson 2.22.x, 54 updates) as stated by the driver; the ticket's "44 updates" is stale.
