## Why

`JoinStep.evaluate` and `SparkJobSubmitter.applyStep` use `dataSourceRepo.findByIdInternal` to resolve
the join's right-side data source — a privileged bypass that lets any user author a pipeline that
joins against another user's data source if they can guess its ID. This is too permissive for v1 and
must be closed by validating the right-source at the authoring boundary (step creation / update).

## What Changes

- Pre-flight ACL in `PipelineService.addStep` and `PipelineService.updateStep`: when the incoming
  step type is `join`, call `dataSourceRepo.findByIdOwned` on the `rightDataSourceId`; return 404 if
  the source is missing or not owned by the caller.
- `PipelineService` receives a new `DataSourceRepository` constructor dependency to support the
  above check; `ApiRoutes` already wires the singleton `dataSourceRepo` and will pass it in.
- Runtime resolution in `JoinStep.evaluate` and `SparkJobSubmitter.applyStep` continues to use
  `findByIdInternal` (the authoring-time check above is the gate; keeping internal at runtime avoids
  breaking evaluation of steps that were valid when created). This is the **pre-flight + runtime
  internal** model.
- Tests: two new scenarios in `PipelineStepRoutesSpec` — cross-user JoinStep create → 404, and
  owner JoinStep create → 201.

## Non-goals

- Pipeline-level right-source sharing (no `resource_permissions` for data sources in v1).
- Modifying `AuthService` (off-limits per ticket constraint).
- Changing the runtime resolution strategy from internal to owner-scoped (that is HEL-272/RLS
  territory, where the DB layer enforces as defense-in-depth).
- Frontend changes — no UI surface touches JoinStep right-source ACL.

## Capabilities

### New Capabilities

- `pipeline-joinstep-right-source-acl`: Pre-flight ACL validation on JoinStep right-source at
  step creation and update; 404 for non-owned right sources.

### Modified Capabilities

- `pipeline-steps-persistence`: POST /api/pipelines/:id/steps and PATCH /api/pipeline-steps/:id
  now reject a join step whose right-source is not caller-accessible with 404.

## Impact

- **Backend**: `PipelineService` (new `DataSourceRepository` param + JoinStep guard in `addStep`
  / `updateStep`); `ApiRoutes` (pass `dataSourceRepo` to `PipelineService`).
- **Tests**: `PipelineStepRoutesSpec` — two new test cases covering the ACL requirement.
- **No frontend changes**, no schema/migration changes, no new external dependencies.
