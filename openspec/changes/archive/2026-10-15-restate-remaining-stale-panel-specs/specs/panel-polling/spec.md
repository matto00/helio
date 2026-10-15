## REMOVED Requirements

### Requirement: Panel data is re-fetched on the configured refresh interval
**Reason**: Gates polling on a bound `typeId`, a binding panels no longer have (removed by the pipelines-and-outputs remodel; `backend/src/main/scala/com/helio/domain/model/Panel.scala` lists it among the removed flat fields). The caller passes the panel's `outputId` (`PanelCardBody.tsx`: `usePanelPolling(refresh, panel.refreshInterval ?? null, outputId)`).
**Migration**: See "Panel rows are re-fetched on the configured refresh interval".

### Requirement: Polling stops when the panel binding is removed
**Reason**: Same stale `typeId` binding as above.
**Migration**: See "Polling stops when the polling hook's binding becomes empty".

## ADDED Requirements

### Requirement: Panel rows are re-fetched on the configured refresh interval
When a panel has a numeric `refreshInterval` and an Output binding (`outputId`), the frontend SHALL automatically
re-fetch the panel's rows every `refreshInterval` seconds, starting from mount, while the browser tab is visible (the hook does not wait for the initial data load). `refreshInterval` is a
frontend-only field: the backend neither stores nor returns it, so it carries no numeric value for any panel loaded
from the backend, and such a panel does not poll. This requirement is therefore the contract of the `usePanelPolling`
hook; no panel in the product has a numeric `refreshInterval` today.

#### Scenario: Panel with refreshInterval re-fetches at the configured cadence
- **WHEN** a panel with `refreshInterval=30` and an `outputId` is mounted
- **THEN** from mount, the data is re-fetched approximately every 30 seconds while the tab is visible

#### Scenario: No polling when refreshInterval is null
- **WHEN** a panel has `refreshInterval` set to null
- **THEN** no interval is set up and data is only loaded once on mount

#### Scenario: No polling when the panel has no Output binding
- **WHEN** a panel has no `outputId`
- **THEN** no interval is set up regardless of the `refreshInterval` value

### Requirement: Polling stops when the polling hook's binding becomes empty
If the Output binding (`outputId`) passed to `usePanelPolling` becomes null or undefined, any active polling interval
SHALL be cleared. This is the hook's contract: no UI path empties an output panel's `outputId` (the detail modal's
"Swap output" PATCHes it to a different Output), so it is not observable in the product today.

#### Scenario: Removing the Output binding stops polling
- **WHEN** the binding passed to `usePanelPolling` changes to null while polling is active
- **THEN** polling stops immediately and no further fetches occur
