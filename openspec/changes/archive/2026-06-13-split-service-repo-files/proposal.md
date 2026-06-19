## Why

Four backend files (DashboardService, PanelService, DashboardRepository, PanelRepository) exceed the project's file-size budget after the HEL-265 sharing/ACL additions. Splitting them now keeps the codebase modular, consistent with the existing `PanelRowMapper` extraction precedent, and prevents further accumulation.

## What Changes

- **DashboardRepository.scala** (384L → ≤250L target): extract the companion object — `DashboardRow`, `DashboardTable`, column-type implicits — into `DashboardTables.scala`; extract the snapshot bulk operations (`duplicate`, `exportSnapshot`, `importSnapshot`) into `DashboardSnapshotRepository.scala`
- **PanelRepository.scala** (361L → ≤250L target): extract the companion object — `PanelRow`, `PanelTable`, column-type implicits — into `PanelTables.scala`; extract `batchUpdate` + `duplicate` into `PanelMutationRepository.scala`
- **DashboardService.scala** (332L → ≤300L target): extract the companion object static validation helpers (`validateSnapshotPayload`, `validateVersion`, `validateName`, `validatePanelEntries`, `validateLayoutReferences`, `validateDashboardUpdateRequest`) into `DashboardServiceValidation.scala`
- **PanelService.scala** (347L → ≤300L target): extract the companion object static helpers (`resolvePatch`, `resolveCreateConfig`, `validateBatchTypeMatch`, `buildNewPanel`, `validateCreatePanelRequest`, `validatePanelType`) into `PanelServiceHelpers.scala`

No behavior changes. Service/repository constructor signatures are unchanged. `Main.scala` and `ApiRoutes.scala` require no modifications.

## Capabilities

### New Capabilities

- `backend-file-size-compliance`: File-split extraction bringing four oversized backend files under the 300L/250L budgets.

### Modified Capabilities

_None — no spec-level behavior changes._

## Impact

- Backend: 4 files split into 8 files. All within `com.helio.infrastructure` and `com.helio.services` packages. No new packages, no API changes.
- Tests: all 715 must pass unchanged; the split is purely structural.
- `Main.scala` / `ApiRoutes.scala`: no wiring changes required.

## Non-goals

- Latent bug fixes (any bugs found are noted for spinoff tickets)
- Behavior changes of any kind
- Changes to `DataTypeRepository`, `PipelineRepository`, or any other file not listed above
