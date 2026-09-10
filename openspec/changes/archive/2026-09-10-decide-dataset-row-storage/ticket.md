# HEL-1075: Decide dataset row storage: new table vs. the existing snapshot store

## Description
Measure before choosing. `DataSource.scala:140-144` documents two current read paths for `StaticSource` rows — the DataType/snapshot row, and a legacy config blob read directly by the in-process and Spark engines. Both must keep working or be migrated.

Deliverable is a decision with evidence: which store backs `dataset_rows`, what happens to the legacy blob path, and whether row-level addressing (needed for edit/delete) is possible in the chosen store.

## Acceptance Criteria
- The decision names the measurement that produced it.
- No implementation of the dataset row-storage layer lands as part of this ticket — the rest of the epic (HEL-1077/1078/1080) depends on the answer, and they remain `blockedBy` this ticket until it closes.

## Context
- Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627), "Data model & migration" section — explicitly defers this decision to this ticket.
- Parent epic: HEL-1072. Blocks: HEL-1077 (write API), HEL-1078 (edit/delete API with `updatedAt` precondition), HEL-1080 (dataset management UI).

## Premise correction (found during Setup measurement — see persisted premise-validation.md)
The ticket's own "two read paths" framing (DataType row vs. config blob) is stale: the standalone `DataType` concept was retired under HEL-904/HEL-909. There is exactly ONE physical store today for `StaticSource` rows — `data_sources.config jsonb NOT NULL` — read via `DataSourceRepository.readRawConfig`/`parseStaticPayload`, consumed identically by three call sites: `DataSourceService.previewStatic`, `InProcessPipelineEngine.loadRowsWithStats`, and `SparkJobSubmitter.loadDataFrame`. This doesn't change the ticket's goal (decide the store for `dataset_rows`, with row-level addressing), it corrects the "two-path" language the decision should use.
