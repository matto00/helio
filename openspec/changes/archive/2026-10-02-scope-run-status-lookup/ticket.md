# HEL-1249: GET /api/pipelines/:id/runs/:runId ignores pipelineId and does no ownership/visibility check

## Description
Found by the HEL-1002 final-gate skeptic (not fixed there: not a 403/404 divergence, pre-existing).

`PipelineRunStatusRoutes` looks up the run by `runId` and ignores the `pipelineId` path segment and the caller's visibility, so a run id from another tenant/pipeline may be readable or distinguishable. Verify and scope the lookup to the pipeline and to `findByIdShared(pipelineId, Some(user))`, returning the same 404 body for foreign vs absent. Add a row to `ExistenceNotLeakedRoutesSpec`.

Also worth a probe: HEL-1002's evaluator saw `POST /api/patch-sets/preview` with an output update/delete edit return 500 for both foreign and absent ids (may be its probe payload).

origin_kind: followup
origin_ticket: HEL-1002

## Acceptance Criteria (derived)
- Foreign, absent, and wrong-pipeline run ids return a byte-identical 404.
- Owner and grantees who can see the pipeline still read its runs.
- A row exists in ExistenceNotLeakedRoutesSpec for this route.
- Run-id exposure paths and all callers of PipelineRunService.status audited and reported.
- patch-sets/preview 500 probed; follow-up filed if it reproduces.
