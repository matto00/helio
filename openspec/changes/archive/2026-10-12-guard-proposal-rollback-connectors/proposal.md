## Why

HEL-1496 reported that `PipelineProposalService.rollback(response, user)` (used by combined-proposal and first-run rollback after a successful apply) leaves a bare-url REST source's implicit "Auto:" Connector behind, and asked whether a proposal's `newConnector` draft can leak a Connector. Premise validation found both already safe on main by code reading (HEL-1497 moved the cleanup into `DataSourceService.delete`; the backend never creates a Connector from a draft), but nothing proves it on these paths, and the code at the call site still reads as if the leak exists. Guard tests make the guarantee durable against a future change to the HEL-1497 seam.

## What Changes

- New backend guard tests (service-level and route-level through real `ApiRoutes` wiring) for: public rollback after a successful apply removes the Auto Connector and its credential; combined-proposal post-apply rollback does the same; a `newConnector` draft apply creates nothing; a user-explicit Connector is kept on rollback (characterization); no cross-tenant Connector deletion. Each guard is proven failable by a recorded mutation.
- Correct the stale scaladoc on `PipelineProposalService.rollback` and the `implicitConnector = false` argument so they state that `DataSourceService.delete` (HEL-1497) performs the Auto Connector cleanup.
- No production behaviour change, no API/protocol change, no migration.

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- none (no spec-level behaviour changes; `skip_specs: true`)

## Impact

- `backend/src/main/scala/com/helio/services/pipelines/PipelineProposalService.scala` (comments/scaladoc only).
- New test files under `backend/src/test/scala/com/helio/services/pipelines/` and `backend/src/test/scala/com/helio/api/routes/`.
- Open question for the owner (no behaviour change): should a rollback also delete a user-named Connector created for the proposal (the UI "set up connector" step, MCP `create_connector`, or the pending-connector flow)? Today it is kept.
