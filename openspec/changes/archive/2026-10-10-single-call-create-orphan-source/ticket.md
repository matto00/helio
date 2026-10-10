# HEL-1469: POST /api/pipelines (single-call create) persists the inline source even when the request 422s on a bad step config, leaving an orphan source

## Description

Origin: HEL-1422's final skeptic (2026-10-09), observed live: a single-call `POST /api/pipelines` with an inline source and a step with an invalid config returned 422, but the inline source was saved anyway (source `9557317c-…` with no pipeline; the skeptic deleted it by id). Single-call create is documented as all-or-nothing (CLAUDE.md: "single-call: source/steps/outputs in one request"; HEL-1402 added `validateRawConfig` for every step kind with 422 `Step '<clientId>': <msg>`).

Priority: Medium. Labels: Follow-up, Bug. Related: HEL-1402, HEL-1417, HEL-1422.

## Acceptance Criteria

* Reproduce red-first through the real route on a throwaway user: 422 AND zero new data_sources rows.
* Fix: validate every step (and Output) config BEFORE any write, and/or run source creation inside the same transaction that rolls back on any failure. Check the patch-set `resolvePipelineCreate` path (HEL-1417) for the same leak.
* No orphaned source on any 4xx/5xx from single-call create; cover it with tests per failure class (step config, output config, step type).

## Driver notes (claims, verified at Setup — see premise-validation evidence)

* Leak is real: `PipelineService.create` creates inline root sources via `resolveOneRootSourceId` before the single Slick transaction in `createTransactional`; every step/Output validation runs inside that transaction, whose rollback cannot reach the already-committed source.
* HEL-1441 item 3 ("does single-call create skip HEL-1313 Output config key validation?"): it does NOT skip it — `validateOutputFieldMapping` calls `OutputConfigValidation.validate`. Not absorbed here; the Output-config failure-class test in this ticket incidentally pins it.
* Single-call create runs as the user (`runTransactionally` -> `DbContext.withUserContext`); keep that.
