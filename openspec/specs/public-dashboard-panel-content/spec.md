# public-dashboard-panel-content Specification

## Purpose
Gives the public/anonymous dashboard viewer real panel content — actual Output row data rendered
per panel kind — closing the gap where `PublicDashboardViewerPage` shows only a bare title/kind
list today despite the backend row-read route already existing. This is the prerequisite
`output-panel-viewer-controls` needs to extend viewer controls to the public path (owner ruling,
folded into the same change rather than split into a separate ticket).

## Requirements

### Requirement: An anonymous viewer sees a panel's actual data, not just its title
For each output-kind panel on a dashboard readable via the public/share-token path (per
`public-dashboards`), the public viewer SHALL fetch and render that panel's current row data,
using the SAME rendering behavior (table columns, chart type, formatting) the authenticated
experience uses for that panel's kind and config — not a separate, reduced representation.

#### Scenario: A table-kind panel shows its rows publicly
- **WHEN** an anonymous viewer opens a shared dashboard containing a table-kind output panel
- **THEN** the panel renders that Output's current rows as a table, with the same columns and
  formatting an authenticated viewer of the same panel would see

#### Scenario: A chart-kind panel renders its chart publicly
- **WHEN** an anonymous viewer opens a shared dashboard containing a chart-kind output panel
- **THEN** the panel renders the same chart type and series the authenticated experience renders
  for that panel's config

### Requirement: Public panel content reuses the authenticated rendering path
Rendering behavior for public panel content SHALL reuse the same rendering logic the authenticated
experience uses per panel kind, rather than a separately maintained, forked implementation — a
divergence between the two is a defect, not an accepted design choice, unless design.md states an
explicit, justified exception for a specific panel kind.

#### Scenario: A formatting change to the authenticated table renderer applies to the public view too
- **WHEN** the authenticated table renderer's column formatting changes
- **THEN** the public viewer's table rendering reflects the same change, with no separate edit
  required (proven by both paths sharing the same rendering code)

### Requirement: Public panel content is read-only
The public viewer SHALL NOT offer any affordance to edit a panel's appearance, config, layout, or
underlying data (including a `form`-kind panel's submit affordance) — an anonymous or
share-token viewer is a read-only consumer of the dashboard's current data. This SHALL hold
regardless of whether the browser session happens to be authenticated as the dashboard's owner —
reusing an authenticated-experience renderer that derives write-eligibility from the current
session's identity (e.g. a table's sort/filter/pin persistence) SHALL NOT be allowed to become
writable on the public render path merely because the viewing session happens to belong to the
owner.

#### Scenario: No edit affordance is offered publicly
- **WHEN** an anonymous viewer opens a shared dashboard
- **THEN** no control to edit panel title, appearance, layout, or config is rendered anywhere on
  the page

#### Scenario: An owner previewing their own public link cannot write through it
- **WHEN** a dashboard's owner, while still authenticated in the same browser session, opens that
  dashboard's own public share link
- **THEN** interacting with a table-kind panel's sort/filter/column-pin controls on THAT public
  view does not persist any change to the panel's or Output's saved config — the public render
  path is read-only independent of the viewing session's identity

### Requirement: The existing denial semantics are preserved unchanged
Rendering real panel content SHALL NOT alter the existing single-exit denial behavior for an
expired, revoked, nonexistent, or wrong-resource share token, or a missing token — every such case
SHALL still collapse to the same "denied" state, indistinguishable from one another.

#### Scenario: An invalid token still yields the same denied state
- **WHEN** an anonymous caller requests a dashboard with an expired or revoked token
- **THEN** the page renders the same "This link isn't available" denied state it renders today,
  unchanged by this change's addition of real panel content for the valid-token case

### Requirement: The public viewer lays panels out from the stored layout
At a viewer container width of 768 px or more, the public viewer SHALL position panels from the panel-list
`layout` at the active breakpoint using the same grid configuration (breakpoints, columns, row height,
margins, density metrics) as the signed-in grid. The grid SHALL be read-only: no drag, resize, title edit or
menu affordance, and no layout save or layout repair request, even when the viewing session is the
dashboard's owner. Below 768 px the existing stacked list SHALL render.

#### Scenario: Two-column desktop layout
- **WHEN** a token viewer opens, at a 1440 px viewport (container about 1408 px, breakpoint md), a dashboard
  whose md layout places two panels side by side
- **THEN** the grid resolves breakpoint md and the two panels render side by side at md's stored positions

#### Scenario: Vertical gaps are kept
- **WHEN** the stored layout leaves an empty row band above a panel
- **THEN** that panel renders at its stored `y`, not pulled up

#### Scenario: Phone keeps the stack
- **WHEN** the same dashboard is opened at 375 px
- **THEN** the panels render in the stacked list

#### Scenario: No layout write from the public page
- **WHEN** the dashboard's owner opens their own share link and resizes the window across breakpoints
- **THEN** no `PATCH /api/dashboards/:id` and no `POST /api/dashboards/:id/layout/repair` request is sent

### Requirement: Content panels render their content publicly through the shared renderers
Text, markdown, image and divider panels SHALL render their content on the public viewer through the same
renderer components and the same sanitising and URL rules as the signed-in app. Hostile markdown and
hostile image URLs SHALL render inert.

#### Scenario: Markdown content
- **WHEN** a token viewer opens a dashboard with a markdown panel
- **THEN** the panel's rendered markdown is shown, not the word "markdown"

#### Scenario: Hostile content is inert
- **WHEN** a markdown panel contains a `<script>` tag, a `javascript:` link and a raw `<img onerror>`, and an
  image panel's URL is `javascript:alert(1)`
- **THEN** no script runs, no `javascript:` href or src is rendered, and the image panel shows its empty state

### Requirement: Form panels render a read-only preview publicly
A form panel on the public viewer SHALL render each bound field's label and control, using the field
declarations from the public form-schema route, with every control disabled and no submit control. No
interaction on the public viewer SHALL send a form submit request.

#### Scenario: Preview, never submit
- **WHEN** a token viewer opens a dashboard with a form panel and tries every control
- **THEN** the field labels are shown, every control is disabled, no submit button exists, and no request to
  `/api/panels/:id/submit` is sent
