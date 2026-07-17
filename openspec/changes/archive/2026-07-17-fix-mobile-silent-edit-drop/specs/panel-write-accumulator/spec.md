# panel-write-accumulator — Delta (fix-mobile-silent-edit-drop / HEL-304)

## MODIFIED Requirements

### Requirement: Accumulated panel changes are flushed via batch endpoint on a debounce
The frontend MUST flush the `pendingPanelUpdates` map to `POST /api/panels/updateBatch`
on a 30-second `setInterval` whenever the map is non-empty, using the existing `updatePanelsBatch` thunk.
The timer MUST reset to 30 seconds after any manual "Save now" flush.
The flush lifecycle (interval, dashboard-switch flush, Save-now registration) MUST be owned by a component that is
mounted whenever a dashboard view renders, independent of the grid container width — it MUST NOT be gated on the
desktop grid (≥768px) being mounted.

#### Scenario: Pending updates are sent after 30-second interval
- **GIVEN** one or more panel field changes have been accumulated
- **WHEN** 30 seconds elapses since the last flush (auto or manual)
- **THEN** the frontend dispatches `updatePanelsBatch` with all pending changes
- **AND** `pendingPanelUpdates` is cleared after a successful response

#### Scenario: Accumulating changes does not reset the auto-save timer
- **GIVEN** the 30-second interval is running
- **WHEN** another panel change is accumulated
- **THEN** the interval continues on its current schedule (changes do not extend the timer)

#### Scenario: Failed flush retains pending updates for retry
- **GIVEN** `updatePanelsBatch` rejects (network error or server error)
- **WHEN** the rejection is handled
- **THEN** `pendingPanelUpdates` is NOT cleared
- **AND** the next interval tick retries the flush with the same pending data

#### Scenario: Pending updates are discarded on dashboard navigation
- **GIVEN** there are pending panel updates in Redux
- **WHEN** the PanelGrid component unmounts (user navigates away)
- **THEN** the interval timer is cancelled
- **AND** any un-flushed updates are discarded (no flush on unmount)

#### Scenario: Appearance edit staged at phone width flushes like desktop
- **GIVEN** the grid container width is below 768px (mobile stack is rendered)
- **WHEN** the user saves an appearance (or title) edit in the panel detail modal
- **AND** the 30-second interval elapses (or "Save now" is clicked)
- **THEN** the frontend dispatches `updatePanelsBatch` with the staged changes
- **AND** `pendingPanelUpdates` is cleared after a successful response

#### Scenario: Pending updates survive a shell switch (resize below 768px mid-edit)
- **GIVEN** panel field changes were accumulated while the desktop grid (≥768px) was rendered
- **WHEN** the container width drops below 768px before the next flush (desktop grid unmounts, stack mounts)
- **THEN** the pending updates are NOT stranded — the next interval tick or "Save now" flushes them via
  `updatePanelsBatch`
