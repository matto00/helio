# HEL-452: Triage and remediate the open Dependabot alerts (frontend npm + backend sbt)

## Description

Originally filed against "5 open Dependabot alerts (1 high, 4 moderate)" across the frontend npm stack and the backend sbt stack. There is no `.github/dependabot.yml` and CI does no vulnerability scanning, so these were surfaced only by GitHub's default Dependabot alerting. This ticket triages and remediates the concrete vulnerabilities; cadence/config work is separate.

**Premise revalidated at Setup (see `.concertino/runs/HEL-452/evidence/premise-validation.md`; verdict `material-drift`, disposition `proceed-with-restated-scope`):**

- `gh api /repos/matto00/helio/dependabot/alerts` returns **97 alerts, all `state=fixed`, ZERO open**. The npm half of this ticket is already satisfied on `main`: `npm audit` independently reports **0 vulnerabilities** in root, `frontend/`, and `helio-mcp/`.
- **All 97 alerts ever raised are `ecosystem=npm`.** Zero maven/sbt alerts have ever fired, because GitHub Dependabot does not parse `backend/build.sbt`. The entire backend Scala/Java dependency stack has therefore never had any vulnerability coverage.
- An OSV.dev scan of the backend's **resolved compile-scope** Maven coordinates (250 of them, after excluding artifacts sbt marks `(evicted by: ...)`, which are not on the resolved classpath) finds **23 vulnerable artifacts carrying 70 advisories: 1 CRITICAL, 30 HIGH, 34 MODERATE, 5 LOW**. Test scope adds no new advisory. See `osv-baseline.md`.
- Spark is declared **compile scope** in `backend/build.sbt` ("driver runs in this JVM"), so its transitive stack ships inside the production Cloud Run image. This is live attack surface, not test-only.

The restated scope of this ticket is therefore: **remediate the real, previously invisible backend Maven exposure**, and record the already-clean npm state as evidence rather than re-doing it.

## Scope

* Bump direct `backend/build.sbt` dependencies that have a safe in-version-line fix.
* Add/extend `dependencyOverrides` in `backend/build.sbt` to force fixed versions of the **transitive** artifacts the scan actually attributes advisories to (predominantly the Spark 3.5.x stack: the netty family, `protobuf-java`, `commons-lang3`, `ivy`, log4j 2.x).
* Re-run the OSV scan after the change to prove the advisory count actually dropped, and record before/after as evidence.
* Explicitly triage — and document with written justification — every advisory deliberately NOT remediated.
* Confirm the backend still resolves, compiles, and passes tests.
* Record the already-verified-clean npm state (0 Dependabot alerts, 0 `npm audit` findings across all three trees) as evidence.

## Acceptance criteria

* `backend/build.sbt` is updated so that every backend advisory with a safe, non-breaking upgrade path is remediated.
* A re-run of the OSV scan over the post-change resolved dependency tree shows a materially reduced advisory count, with **before/after numbers recorded**.
* Every remaining (un-remediated) advisory is listed with a written justification for why it was not fixed — no silent omissions.
* `sbt compile` and `sbt test` pass in the backend.
* npm side: recorded as already-clean with evidence (0 open Dependabot alerts; `npm audit` = 0 vulnerabilities in root, `frontend/`, `helio-mcp/`). No npm change is expected; if `npm audit` is not clean at execution time, remediate it.
* PR description lists every remediation as `package: from -> to (GHSA/CVE id)`.

## Out of scope

* Adding `.github/dependabot.yml` / auto-merge (separate ticket in epic HEL-434).
* Adding a CI CVE gate (separate ticket).
* Documenting the update cadence (separate ticket).
* Upgrading Spark across a major version (3.5.x -> 4.x). Advisories that can only be fixed that way are deferred and documented.

## Known no-safe-path items (defer + document, do NOT force-bump)

* `io.airlift:aircompressor` 0.21/0.27 -> 2.0.3 — major, API-breaking under Spark 3.5.x.
* `org.apache.zookeeper:zookeeper` 3.4.8/3.6.3 -> 3.9.x — reached only via Spark's HA/cluster path, which this deployment does not use.
* `org.lz4:lz4-java` GHSA-cmp6-m4wj-q63q — no fixed version published anywhere.
