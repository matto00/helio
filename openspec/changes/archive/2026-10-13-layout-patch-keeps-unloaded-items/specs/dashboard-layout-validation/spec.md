## MODIFIED Requirements

### Requirement: The web client never persists an invalid changed breakpoint and never fails silently

The web client SHALL NOT send a layout breakpoint that differs from the last server-acknowledged layout and is invalid among the panels this tab has loaded; it SHALL send the breakpoint as displayed (the render-time resolved layout) instead. Items of panels this tab has not loaded are not judged by the client: they are sent as authored and the server is the authority on their validity. When it sends the displayed breakpoint in place of an invalid one, it SHALL also send the authored items of panels this tab has not loaded, unchanged, so a substitution never drops another writer's panel item; the server adjudicates those items (an item of a deleted panel is dropped, an overlap with a live panel is rejected). After creating a panel the client SHALL adopt the server's stored placement for every breakpoint. A rejected layout save SHALL be shown to the user in human-readable client copy that contains no raw panel ids, and the client SHALL re-sync the dashboard layout from the server.

#### Scenario: Undo to a bad snapshot after repair
- **WHEN** a user repairs a stored-bad `xs` by dragging and then undoes
- **THEN** the save succeeds and the stored `xs` is the displayed (valid) layout

#### Scenario: Create panel then drag
- **WHEN** a user creates a panel and then drags another panel in `lg`
- **THEN** the layout save is accepted

#### Scenario: Substitution keeps an unloaded panel's item
- **WHEN** a changed breakpoint is invalid and the authored breakpoint holds an item for a panel this tab has not loaded
- **THEN** the breakpoint sent is the displayed layout of the loaded panels plus that panel's authored item, unchanged

#### Scenario: Filling a deleted panel's slot still saves
- **WHEN** a user deletes a panel and then moves another panel into the deleted panel's former position
- **THEN** the layout save is accepted and the user sees no error

#### Scenario: Overlap with a live unloaded panel is rejected visibly
- **WHEN** the substituted breakpoint's displayed items overlap the item of a live panel this tab has not loaded, the re-sync from the server succeeds, and this tab's panel list is loaded for the dashboard and did not fail to load
- **THEN** the server responds `400`, nothing is stored, and the user sees the existing "layout was changed elsewhere" copy

#### Scenario: Rejected save is visible
- **WHEN** the server responds `400` to a layout save
- **THEN** the user sees human-readable copy with no raw panel ids and the grid re-syncs from the server layout

#### Scenario: Rejection with no proof of an unloaded panel
- **WHEN** a layout save is rejected with a status other than `400` or `409`, or this tab's panel list is not loaded for the dashboard, or the panel list failed to load, or the re-sync failed, or the re-synced layout holds no item of a panel this tab has not loaded
- **THEN** the user sees the generic "Failed to save dashboard layout." copy, not the server's message

#### Scenario: Rejection caused by an unloaded panel
- **WHEN** a layout save is rejected with `400`, the re-sync from the server succeeds, this tab's panel list is loaded for the dashboard and did not fail to load, and the re-synced server layout holds items of panels this tab has not loaded
- **THEN** the user sees the existing "layout was changed elsewhere" copy, not the server's message
