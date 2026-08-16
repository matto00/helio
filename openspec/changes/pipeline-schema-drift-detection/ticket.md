# HEL-462: Pipeline schema-drift detection

## Description

A pipeline's source columns can change out from under it (a CSV re-uploaded with a renamed/removed column, a REST payload that drops a field). Today nothing detects this: the pipeline just silently produces a different-shaped output, and downstream panels/metrics break with no signal. This ticket adds schema-drift detection — comparing the current source schema against the schema captured at the last successful run and flagging differences.

Source-schema inference already exists: `SchemaInferenceEngine.scala` and the analyze path (`PipelineAnalyzeService.analyze` takes a `sourceSchema: Vector[SchemaField]`). Pipeline run lifecycle is in `backend/src/main/scala/com/helio/services/PipelineRunService.scala` (`onRunSuccess`). There is currently no stored baseline schema to compare against.

## Scope

* Persistence: Flyway migration (next available VNN, assigned at scheduling time — the ticket text says "main at V59" but that is STALE; the actual next available number at branch time is **V85**, verified against origin/main whose highest is `V84__pipeline_run_assertions.sql`; re-verify against origin/main before delivery in case a parallel branch claims V85) adding a nullable `last_source_schema JSONB` column to `pipelines` (follow the additive-nullable-column precedent of `V53__panel_column_widths.sql`), storing the inferred source schema captured on each successful run.
* Backend: in `PipelineRunService.onRunSuccess`, persist the inferred source schema alongside the existing `updateLastRun`. Add a drift-comparison helper (e.g. in a new `PipelineSchemaDriftService` or on `PipelineAnalyzeService`) that diffs the current inferred source schema against `last_source_schema` and returns a structured result: `addedColumns`, `removedColumns`, `typeChangedColumns`.
* API: surface drift on the analyze response (`schemas/pipeline-analyze-response.schema.json` + `PipelineAnalyzeProtocol.scala`) as an optional `sourceSchemaDrift` object, computed at analyze time. Null/absent when there is no prior baseline (first run) or no drift.
* Keep FQNs out of Scala.

## Acceptance criteria

- [ ] `pipelines.last_source_schema` column added via Flyway (nullable JSONB); populated on each successful run.
- [ ] The analyze response includes a `sourceSchemaDrift` object reporting added / removed / type-changed columns vs. the last successful run's source schema, and is absent/null when there is no baseline or no drift.
- [ ] A ScalaTest proves: (a) no drift reported on first run; (b) a removed source column is reported in `removedColumns`; (c) a type change is reported in `typeChangedColumns`.
- [ ] `schemas/pipeline-analyze-response.schema.json` updated and validated against the response.
- [ ] Additive/backward-compatible: existing analyze consumers ignoring the new field are unaffected; `sbt test` passes.

## Out of scope

* Blocking a run on drift or raising an alert (that is fail-policy 419-C / the Alerting epic).
* Frontend surfacing of drift (can fold into 419-D or a follow-up).

## Dependencies

* Independent of the assert-step chain (HEL-419's shipped work). Relates to Scheduled Runs (HEL-340) — drift is most valuable on unattended scheduled runs.

## Environment facts (verified at setup, not from the stale ticket text)

* Branch point: `6612e291` (HEL-409, PR #362).
* Highest Flyway migration on origin/main and branch HEAD: `V84__pipeline_run_assertions.sql` → use **V85**.
* Ports for this run: dev 5894, backend 8801. All worktrees share ONE dev Postgres — never leave a dev server running across a migration renumber (shared `flyway_schema_history` poisoning; see HEL-521 incident).
