## Why

Dependabot's sbt group (#489) cannot land: it jumps sbt 1.10.10 -> 2.0.9, a major, and `backend/build.sbt` no longer loads
because sbt 2 caches task results and `Test / testGrouping` (`Seq[Tests.Group]`) has no `JsonFormat`. The backend dependency
surface has had no successful group update since 2026-08-30.

## What Changes

- `backend/project/build.properties`: sbt 1.10.10 -> 2.0.x; `backend/project/plugins.sbt`: sbt-assembly to a release that supports sbt 2.
- `backend/build.sbt`: opt `Test / testGrouping` out of task caching (`Def.uncached`/`@transient`), with the chosen remedy and
  the reasons the other two were declined recorded at the definition site. The grouping logic itself is untouched.
- Any further `build.sbt` changes sbt 2 forces (slash syntax leftovers, `target` layout, `assembly` jar output path, etc.).
- Downstream build consumers adjusted only if sbt 2 breaks them: `Dockerfile` (jar path, `sbt update`/`sbt assembly`), `.github/workflows/*.yml` sbt invocations.
- No library bumps (Dependabot keeps those); Jackson `dependencyOverrides` stay at 2.18.11.

## Capabilities

### New Capabilities
### Modified Capabilities
None. Build tooling only, no spec-level behavior change (`skip_specs: true`).

## Impact

`backend/project/*`, `backend/build.sbt`, possibly `Dockerfile` and CI workflows. Runtime behavior of the backend is unchanged.

## Non-goals

The ~54 library updates, the Jackson 2.22 bump, any change to test grouping/forking/concurrency, hand-edits to `scripts/concertino/`.
