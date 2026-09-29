## Purpose

Gives the public/anonymous dashboard viewer real panel content — actual Output row data rendered
per panel kind — closing the gap where `PublicDashboardViewerPage` shows only a bare title/kind
list today despite the backend row-read route already existing. This is the prerequisite
`output-panel-viewer-controls` needs to extend viewer controls to the public path (owner ruling,
folded into the same change rather than split into a separate ticket).

## ADDED Requirements

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
