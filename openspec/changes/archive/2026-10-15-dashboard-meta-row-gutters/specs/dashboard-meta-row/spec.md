## Purpose

The dashboard page's title-free meta row: a slim mono line of facts about the open dashboard (panel count, last refresh, sources) and its trailing actions, replacing a page title.

## ADDED Requirements

### Requirement: On the rail-shell dashboard view the meta row replaces the command bar and no title renders
Above the phone boundary, on the dashboard view, the app SHALL render the meta row in place of the command bar, in the same top chrome position (directly under the dashboard tab strip when one is present), and SHALL NOT render the command bar there. Every other page, and every page on the phone shell (768px and below), SHALL keep the command bar unchanged, and the meta row SHALL NOT render there. The dashboard view SHALL NOT render a visible title or heading containing the dashboard's name; the meta row SHALL contain no heading element and SHALL NOT contain the dashboard's name. When no dashboard is selected on the dashboard view, the meta row SHALL still render with no facts and no dashboard actions.

#### Scenario: Desktop dashboard view
- **WHEN** a user opens a dashboard at 1280px wide
- **THEN** the meta row renders at the top of the content column and no command bar renders
- **AND** no visible heading or title shows the dashboard's name

#### Scenario: Another page
- **WHEN** the user navigates from the dashboard to the pipelines page at 1280px
- **THEN** the command bar renders and the meta row does not

#### Scenario: Phone shell
- **WHEN** a user opens a dashboard at 768px or 375px wide
- **THEN** the command bar renders as before and no meta row renders

#### Scenario: Layout shortcuts with the meta row
- **WHEN** the meta row is shown and the user presses `Cmd/Ctrl+Z` after a layout change
- **THEN** the layout change is undone

### Requirement: The meta row states panel count, last refresh and sources
The meta row SHALL show the number of panels on the dashboard ("1 panel" / "N panels"). It SHALL show the most recent run time among the pipelines feeding the dashboard's output panels as relative time ("refreshed 9h ago"), with the absolute time available to pointer and assistive technology, preceded by a success-intent dot when that run succeeded, or as "last run failed 9h ago" with a danger-intent dot when it failed, or "not refreshed yet" when no feeding pipeline has run. It SHALL show the distinct data-source names of those pipelines ("source · A", "sources · A, B", "sources · A, B +N"). A fact the client cannot determine (no output panels, or pipelines the viewer cannot read) SHALL be omitted, never shown with a made-up value. The facts SHALL update when the client's pipeline run state changes, without a page reload.

#### Scenario: Dashboard fed by one succeeded pipeline
- **WHEN** a dashboard has 4 panels whose Outputs come from one pipeline rooted on source "Sales CSV", last run succeeded 9 hours ago
- **THEN** the meta row reads "4 panels", a success dot with "refreshed 9h ago", and "source · Sales CSV"

#### Scenario: Most recent run failed
- **WHEN** the most recent run among the feeding pipelines failed
- **THEN** the refresh item reads "last run failed <relative time>" with a danger-intent dot

#### Scenario: No output panels
- **WHEN** a dashboard has only text and markdown panels
- **THEN** the meta row shows the panel count and omits the refresh and source items

#### Scenario: A run completes while the dashboard is open
- **WHEN** a feeding pipeline's run completes and the client's pipeline state is updated
- **THEN** the refresh item shows the new time without a reload

### Requirement: The meta row carries the dashboard's actions with one primary
The meta row SHALL show the save-state indicator after its facts, and SHALL end with the actions Edit layout, Share and Add panel, in that order, followed by the dashboard appearance editor, the assistant quick-launcher trigger and a "Dashboard actions" menu containing "Refine with AI". Add panel SHALL be the only primary (accent) control in the row. Share SHALL open the same share dialog, under the same availability rule, as the context list's Share action. Add panel SHALL open the same panel creation flow, with the same disabled state, as the existing Add panel action. Edit layout and the edit tools SHALL be offered only while the movable desktop grid is what the dashboard renders (below the `sm` boundary the read-only stack renders and panels cannot be moved). The appearance editor SHALL stay in the row at every width. As the row narrows, controls MAY become icon-only or move into the "Dashboard actions" menu, keeping their accessible names and handlers; actions SHALL NOT wrap onto a second line, and Add panel SHALL keep its visible label.

#### Scenario: Add panel from the meta row
- **WHEN** the user activates Add panel in the meta row
- **THEN** the panel creation flow opens for the selected dashboard

#### Scenario: Share from the meta row
- **WHEN** the user activates Share
- **THEN** the dashboard's share dialog opens

#### Scenario: Former command-bar controls
- **WHEN** the meta row is shown
- **THEN** the save-state indicator, the appearance editor, the assistant trigger and "Refine with AI" are reachable from it

#### Scenario: Narrow content column in view mode
- **WHEN** edit mode is off, the movable desktop grid renders, and the row's content width (inside its inline padding) is about 784px (1280px window, context list at 400px)
- **THEN** Edit layout, Share, the appearance editor and the assistant are icon-only with their accessible names, every action is on one line, and Add panel keeps its label

#### Scenario: Narrow content column in edit mode
- **WHEN** edit mode is on at the same 1280px window with the context list at 400px (content width about 784px)
- **THEN** Undo, Redo, Tidy layout and Done are icon-only, Share and the assistant are reachable through the "Dashboard actions" menu, every action is on one line, and Add panel keeps its label

#### Scenario: Overflow menu tier
- **WHEN** the row's content width (inside its inline padding) is narrower than 640px with edit mode off, or narrower than 790px with edit mode on
- **THEN** Share and the assistant are reachable through the "Dashboard actions" menu and the actions stay on one line

#### Scenario: Read-only stack
- **WHEN** the content column is narrower than the `sm` boundary (820px window, context list at 400px) so the read-only stack renders
- **THEN** Edit layout is not offered, Add panel, Share and the other actions remain reachable on one line

#### Scenario: No dashboard selected at any width
- **WHEN** no dashboard is selected and the row is narrow
- **THEN** the assistant button is still in the row

#### Scenario: Accent discipline
- **WHEN** the meta row renders with any accent preset in either theme
- **THEN** Add panel is the only accent-coloured control in the row
