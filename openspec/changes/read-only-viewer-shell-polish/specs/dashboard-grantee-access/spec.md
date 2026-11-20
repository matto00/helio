## MODIFIED Requirements

### Requirement: Owner semantics in the app use owned dashboards only

The app's default landing dashboard and onboarding progress SHALL consider only dashboards the user owns. Only when the user owns no dashboard and holds at least one shared dashboard SHALL the default landing dashboard be the most recently updated shared dashboard.

#### Scenario: A newer shared dashboard does not become the landing dashboard

- **WHEN** a user who owns a dashboard and holds a grant on a more recently updated dashboard signs in
- **THEN** the app lands on their own dashboard

#### Scenario: A shared-only user lands on their most recent shared dashboard

- **WHEN** a user who owns no dashboard, and holds grants on two dashboards, opens `/dashboards`
- **THEN** the more recently updated shared dashboard opens, and the generic "No dashboard open" state is not shown

## ADDED Requirements

### Requirement: Viewers see a "View only" indicator

On a dashboard whose `accessRole` is `viewer`, the desktop dashboard meta row and the phone meta line SHALL show a visible "View only" indicator. It SHALL NOT be shown to an editor or to the owner.

#### Scenario: Viewer sees View only on desktop

- **WHEN** a viewer grantee opens the shared dashboard at desktop width
- **THEN** the meta row shows "View only"

#### Scenario: Viewer sees View only on phone

- **WHEN** a viewer grantee opens the shared dashboard on the phone shell
- **THEN** the meta line above the panels shows "View only"

#### Scenario: Editor and owner see no View only

- **WHEN** an editor grantee or the owner opens the dashboard
- **THEN** no "View only" indicator is shown

### Requirement: Editing shortcuts are inert for viewers

On a dashboard the caller cannot edit, the layout undo and redo keyboard shortcuts SHALL do nothing, and they SHALL NOT prevent the browser's default handling of the key.

#### Scenario: Undo does nothing for a viewer

- **WHEN** a viewer presses the layout undo or redo combination on a shared dashboard
- **THEN** no layout change is applied and nothing is saved

### Requirement: The command palette offers no editing entry to a viewer

With a viewer's dashboard open, the command palette SHALL NOT list any entry that edits that dashboard (including "Add panel"). Entries that create the caller's own resources (new dashboard, source or pipeline) and navigation entries SHALL remain. An editor SHALL still see "Add panel".

#### Scenario: Viewer palette has no Add panel

- **WHEN** a viewer opens the command palette on a shared dashboard
- **THEN** "Add panel" is absent and "New dashboard" is present

#### Scenario: Editor palette keeps Add panel

- **WHEN** an editor opens the command palette on a shared dashboard
- **THEN** "Add panel" is present

### Requirement: Viewer empty states never invite editing

No empty state or call to action shown on a viewer's dashboard, on desktop or phone, SHALL offer or describe an editing action.

#### Scenario: Viewer's empty dashboard

- **WHEN** a viewer opens a shared dashboard with no panels
- **THEN** the empty state offers no action and does not ask them to add a panel

### Requirement: Phone sheet, chips and pull-to-refresh respect the role

On the phone shell, the dashboard sheet SHALL NOT offer an owner-only action (such as Share) on a dashboard the caller does not own. The chip row SHALL switch to a shared dashboard like any other. Pull-to-refresh and the Refresh dashboard button SHALL refresh a shared dashboard's panels for both viewers and editors without an Output or pipeline route error.

#### Scenario: Viewer pulls to refresh

- **WHEN** a viewer pulls to refresh a shared dashboard with output-bound panels on the phone shell
- **THEN** the panels refresh and no error is shown

#### Scenario: Editor's sheet has no Share

- **WHEN** an editor opens the phone dashboard sheet
- **THEN** the shared dashboard's row offers no Share action

### Requirement: A shared-only user is offered building their own dashboard

While a user owns no dashboard but has at least one shared with them:
- Home SHALL show the first-run drop zone below the dashboard shelf, which still lists the shared dashboards.
- The sidebar dashboards list and the phone dashboard sheet SHALL show a "Build your own dashboard" entry. Choosing it SHALL close the open dashboard and show the first-run drop zone in its place on `/dashboards`. Whenever a user who owns no dashboard has no dashboard open on `/dashboards`, the first-run drop zone SHALL be shown instead of the generic "No dashboard open" state.

Once the user owns a dashboard, none of these SHALL be shown.

#### Scenario: Home for a shared-only user

- **WHEN** a shared-only user opens Home
- **THEN** the shared dashboards are listed with their "Shared" badge and the first-run drop zone is shown

#### Scenario: Build your own from the sidebar

- **WHEN** a shared-only user chooses "Build your own dashboard" in the sidebar
- **THEN** no dashboard is open and the first-run drop zone is shown on `/dashboards`

#### Scenario: Entry gone once the user owns a dashboard

- **WHEN** a user owns at least one dashboard
- **THEN** no "Build your own dashboard" entry is shown in the sidebar or the phone sheet

### Requirement: One Shared badge style

The phone chip's "Shared" marker SHALL use the same badge treatment as the sidebar list and Home card badges, and SHALL remain legible in both themes, including on the active chip.

#### Scenario: Chip badge matches

- **WHEN** a shared dashboard's chip is shown on the phone dashboard view, in either theme
- **THEN** its "Shared" marker has the same badge background, colour, type and padding as the sidebar badge (adapted only for contrast on the active chip)
