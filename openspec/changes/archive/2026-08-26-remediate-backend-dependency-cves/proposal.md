## Why

The backend's Scala/Java dependency stack has never been scanned for vulnerabilities. GitHub Dependabot does not
parse `backend/build.sbt`, and all 97 Dependabot alerts this repo has ever raised were npm-only. An OSV.dev scan of
the backend's **resolved** Maven coordinates finds **70 advisories across 23 artifacts at compile scope (1 CRITICAL,
30 HIGH, 34 MODERATE, 5 LOW)**. Test scope adds no new advisory. Spark is declared *compile* scope
("driver runs in this JVM"), so the compile-scope set ships inside the production Cloud Run image — including a
Spark History Server RCE and a pgjdbc silent channel-binding authentication downgrade on the live database path.
HEL-452's original premise (5 open npm/sbt Dependabot alerts) is stale: those are all already fixed, and the real,
unmeasured exposure is here.

Counts exclude coordinates sbt marks `(evicted by: ...)`, which lose version conflicts and are not on the resolved
classpath. Including them overstated an earlier draft of this baseline by 32%, including a phantom CRITICAL. The
tree must also be dumped with the graph width raised, or sbt truncates rows and hides those eviction markers.

## What Changes

- Bump direct `backend/build.sbt` dependencies that have a safe in-version-line fix:
  `spark-core`/`spark-sql` 3.5.5 -> 3.5.9, `postgresql` 42.7.4 -> 42.7.13, `logback-classic` 1.5.18 -> 1.5.38.
- Raise the existing Jackson `dependencyOverrides` pin from 2.15.4 to a patched line, subject to Spark compatibility.
- Extend `dependencyOverrides` to force fixed versions of the transitive artifacts the scan actually attributes
  advisories to: the netty family, `protobuf-java`, `commons-lang3`, `ivy`, and the log4j 2.x artifacts.
- Record a reproducible before/after OSV scan as the evidence that the advisory count actually dropped.
- Document, with written justification, every advisory deliberately left un-remediated.
- No production behavior changes, no API changes, no schema changes.

## Non-goals

- Adding `.github/dependabot.yml`, a CI CVE gate, or update-cadence documentation (separate HEL-434 siblings).
- Upgrading Spark across a major version (3.5.x -> 4.x).
- Remediating advisories reachable only through a breaking major bump: `aircompressor` (API-breaking under Spark),
  `zookeeper` (Spark HA path, unused here), `lz4-java` GHSA-cmp6-m4wj-q63q (no published fix).
- Any npm change. All three npm trees are independently verified clean (`npm audit` = 0 vulnerabilities).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — this is a dependency-hygiene change with no spec-level behavior change. `.openspec.yaml` sets
`skip_specs: true`.

## Impact

- `backend/build.sbt` only (dependency versions and `dependencyOverrides`).
- Runtime risk concentrated in the Jackson pin bump and the netty overrides, both of which Spark links against;
  both are validated by `sbt compile` + the full `sbt test` suite before delivery.
