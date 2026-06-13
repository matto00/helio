## 1. Backend — Repository: extract bulk dashboard snapshot operations

- [x] 1.1 Widen to `protected` in `DashboardRepository` (required for self-typed trait access): `val ctx` (constructor param), `val table`, `def rowToDomain`, `def domainToRow`, `def panelRowToDomain`; also `val permTable` (used by `duplicate` indirectly via ctx)
- [x] 1.2 Create `DashboardSnapshotRepository.scala` in `com.helio.infrastructure` as `trait DashboardSnapshotOps { self: DashboardRepository => }` containing `duplicate`, `exportSnapshot`, `importSnapshot` (moved from `DashboardRepository`)
- [x] 1.3 Remove `duplicate`, `exportSnapshot`, `importSnapshot` bodies from `DashboardRepository.scala`; add `with DashboardSnapshotOps` to the class declaration
- [x] 1.4 Verify `DashboardRepository.scala` ≤250L and `DashboardSnapshotRepository.scala` ≤300L

## 2. Backend — Repository: extract panel mutation operations

- [x] 2.1 Widen to `protected` in `PanelRepository` (required for self-typed trait access): `val ctx` (constructor param), `val table`, `def rowToDomain`, `def domainToRow`
- [x] 2.2 Create `PanelMutationRepository.scala` in `com.helio.infrastructure` as `trait PanelMutationOps { self: PanelRepository => }` containing `duplicate` and `batchUpdate` (moved from `PanelRepository`)
- [x] 2.3 Remove `duplicate` and `batchUpdate` bodies from `PanelRepository.scala`; add `with PanelMutationOps` to the class declaration
- [x] 2.4 Verify `PanelRepository.scala` ≤250L and `PanelMutationRepository.scala` ≤300L

## 3. Backend — Service: extract DashboardService static helpers

- [x] 3.1 Create `DashboardServiceValidation.scala` in `com.helio.services` as `object DashboardServiceValidation` containing: `validateSnapshotPayload`, `validateVersion`, `validateName`, `validatePanelEntries`, `validateLayoutReferences`, `validateDashboardUpdateRequest`, `normalizeAppearance`, `validateDashboardLayoutPayload`, `validateDashboardLayoutItems`
- [x] 3.2 Widen `private def normalizeAppearance`, `validateDashboardLayoutPayload`, `validateDashboardLayoutItems` to `private[services]` in the new object (they must be visible from `DashboardService`)
- [x] 3.3 Slim `DashboardService` companion to only `CreateDashboardInput` case class + a public forwarding def for `validateSnapshotPayload` (delegates to `DashboardServiceValidation.validateSnapshotPayload` so existing test call paths remain stable)
- [x] 3.4 Update `DashboardService` class to import and call `DashboardServiceValidation._` instead of companion methods; `applyUpdate` stays as an instance method in the class
- [x] 3.5 Verify `DashboardService.scala` ≤300L and `DashboardServiceValidation.scala` ≤300L

## 4. Backend — Service: extract PanelService static helpers

- [x] 4.1 Create `PanelServiceHelpers.scala` in `com.helio.services` as `object PanelServiceHelpers` containing: `resolvePatch`, `resolveCreateConfig`, `validateBatchTypeMatch`, `buildNewPanel`, `validateCreatePanelRequest`, `validatePanelType`, `validatePanelTypeOpt`
- [x] 4.2 Widen `private def validatePanelTypeOpt` to `private[services]` in the new object (must be visible from `PanelService`)
- [x] 4.3 Slim `PanelService` companion to empty (or remove it); `resolveSingleBinding` and `authorizeEditorOnDashboard` stay as instance methods in the class
- [x] 4.4 Update `PanelService` class to import and call `PanelServiceHelpers._` instead of companion methods
- [x] 4.5 Verify `PanelService.scala` ≤300L and `PanelServiceHelpers.scala` ≤300L

## 5. Verification

- [x] 5.1 Final line count check: all 4 primary files within budget; all 4 new files ≤300L
- [x] 5.2 Run `sbt test` in the worktree backend and confirm all 715 tests pass
- [x] 5.3 Commit with message `HEL-280 Split service/repository files to meet file-size budget`
