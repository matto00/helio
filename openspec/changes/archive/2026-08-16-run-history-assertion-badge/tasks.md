### Backend

- [x] 1.1 `api/protocols/PipelineProtocol.scala`: add `AssertionFailureDetail(kind, field, severity,
      message)` and `AssertionSummary(passed, warnFailed, errorFailed, failures)` case classes + JSON
      formats; add `assertions: AssertionSummary` to `PipelineRunRecord` (bump its `jsonFormat` arity).
- [x] 1.2 `api/protocols/PipelineProtocol.scala`: add `AssertionStatusResponse(dataTypeId: String,
      invalid: Boolean, failedRuleCount: Int)` case class + JSON format.
- [x] 1.3 `infrastructure/PipelineRunRepository.scala`: add
      `findLatestRunIdByOutputDataTypeIdInternal(dataTypeId: DataTypeId): Future[Option[PipelineRunId]]`
      (design.md Decision 5) — joins `pipelinesTable`/`runsTable` (both already private vals in this
      repository), **filters `r.status =!= "dry_run"`** (the exact precedent `deleteOldRunsInternal`
      already uses in this same file — found at the design gate's first round; a dry-run preview must
      never flip a panel's badge), sorted by `started_at desc`, `.headOption`, system-context.
- [x] 1.4 `services/PipelineRunService.scala`: extend `history()` to compute each run's `AssertionSummary`
      via `listAssertionsByRunInternal` (design.md Decision 2 — bounded, at most 10 calls per request).
- [x] 1.5 `services/PipelineRunService.scala`: add `assertionStatusForDataType(dataTypeId: DataTypeId):
      Future[AssertionStatusResponse]` (design.md Decision 6) — composes task 1.3's lookup with
      `listAssertionsByRunInternal`.
- [x] 1.6 `api/routes/DataTypeRoutes.scala`: add `GET /api/types/:id/assertion-status`, ACL-gated via the
      existing `dataTypeService.findById(id, user)` check (design.md Decision 7, mirrors `/rows`'s ACL),
      delegating to task 1.5.
- [x] 1.7 `schemas/pipeline-run-record.schema.json`: add the `assertions` object (required, matching the
      new non-optional field).
- [x] 1.8 New `schemas/data-type-assertion-status.schema.json` for `AssertionStatusResponse`.

### Frontend

- [x] 2.1 `features/pipelines/types/pipelineStep.ts`: add `AssertionFailureDetail`/`AssertionSummary`
      types; extend `PipelineRunRecord` with `assertions: AssertionSummary`.
- [x] 2.2 `features/pipelines/ui/RunHistoryModal.tsx`: render each run's pass/fail-by-severity summary
      (e.g. "3 passed, 1 error, 0 warn"); broaden the existing expand-toggle condition to
      `(run.status === "failed" && run.errorLog) || run.assertions.failures.length > 0` (design.md
      Decision 10) and render the failing-rules list in the expanded body alongside the existing
      `errorLog` `<pre>`.
- [x] 2.3 `features/dataTypes/state/dataTypesSlice.ts`: add an `assertionStatusByDataTypeId` cache +
      a thunk that fetches once per distinct `dataTypeId`, no-op if already present/in-flight (design.md
      Decision 8).
- [x] 2.4 `features/panels/ui/PanelCard.tsx`: dispatch the fetch (keyed by `getDataTypeId(panel)`) and
      render an informational "invalid data" badge (DESIGN.md `--app-error` token, following the
      existing `panel-grid-card__type-badge` chip pattern) when the cached status reports `invalid:
      true`. No badge when `invalid: false` or the fetch hasn't resolved yet.

### Tests

- [x] 3.1 Backend: `PipelineRunServiceSpec` — `history()` returns accurate `AssertionSummary` counts for
      a run with mixed pass/warn/error results, and a zero-valued summary for a run with no assert steps.
- [x] 3.2 Backend: `PipelineRunRepositorySpec` — `findLatestRunIdByOutputDataTypeIdInternal` round-trip
      (returns the most recent NON-DRY run id; `None` when the pipeline has never had a non-dry run).
      **Dedicated case (design gate round 1):** a dry run more recent than the last real run is excluded
      — the method still returns the last real run's id, not the dry run's.
- [x] 3.3 Backend: a spec for `assertionStatusForDataType` / the new route — `invalid: true` when the
      latest (non-dry) run has an error-severity failure, `invalid: false` for warn-only/no-failure/
      no-run cases, ACL denial matches `/rows`'s existing behavior. **Dedicated case (design gate round
      1):** a dry run with a failing error-severity assertion, run after a clean real run, does NOT flip
      `invalid` to `true`.
- [x] 3.4 Frontend: `RunHistoryModal.test.tsx` — assertion summary renders; expand toggle reveals failing
      rules' messages.
- [x] 3.5 Frontend: `dataTypesSlice.test.ts` — the assertion-status thunk dedupes concurrent/repeated
      fetches for the same `dataTypeId`.
- [x] 3.6 Frontend: `PanelCard.test.tsx` — badge renders for `invalid: true`, absent for `invalid: false`
      and before the fetch resolves.
- [x] 3.7 `sbt test` passes (full suite); `npm run lint` (zero warnings) + `npm test` pass.
