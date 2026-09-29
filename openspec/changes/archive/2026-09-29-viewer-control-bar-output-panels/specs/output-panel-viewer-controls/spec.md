## Purpose

Lets a dashboard *viewer* — not just the author — actually use the controls HEL-1189 lets an
author configure on an output panel: render them, hold the selection per-viewer in the URL, and
apply it as a server-side filter on the panel's Output read, on every render path the panel can
appear in.

## ADDED Requirements

### Requirement: Viewer renders the author's configured controls
An output panel with one or more non-orphaned controls (per `output-panel-controls-editor`) SHALL
render each control to the viewer per its `kind` (`date-range` with presets including last 7/30
days and this quarter, plus custom; `dropdown` with options from the Output's distinct-values
read; `numeric-range`; `text`), labelled with the control's own `label`. An orphaned control SHALL
NOT be rendered to a viewer.

#### Scenario: Controls render on a panel with a dropdown control
- **WHEN** a viewer opens a dashboard containing an output panel with one saved `dropdown` control
- **THEN** a dropdown labelled with that control's `label` renders on the panel, populated with
  that column's distinct values

#### Scenario: An orphaned control never reaches the viewer
- **WHEN** a panel has a control whose bound column no longer exists on the Output's current schema
- **THEN** that control is not rendered to a viewer, even though it still shows (as orphaned) in the
  author's editor

### Requirement: Selection is held per-viewer in the URL, never in panel config
Each panel's control selection SHALL be encoded in the page URL's query string, scoped to that
panel and control (`?p.<panelId>.<controlId>=<value>`). Setting a control SHALL update the URL
without a page navigation; it SHALL NOT issue any write to the panel's persisted config.

#### Scenario: Setting a control updates the URL, not the panel
- **WHEN** a viewer sets a date-range control's value
- **THEN** the URL query string gains a `p.<panelId>.<controlId>` entry for that value
- **AND** no `PATCH` to the panel's config is issued

### Requirement: The URL round-trips a viewer's selection
Reloading the page, or opening a URL carrying `p.<panelId>.<controlId>` params, SHALL reproduce
the exact control selection those params encode. Clearing a control SHALL remove its URL entry and
revert that control to the author's configured `defaultValue` (or "no filter" if none is set).

#### Scenario: A pasted link reproduces the selection
- **WHEN** a viewer opens a URL carrying a `p.<panelId>.<controlId>` entry for a saved dashboard
- **THEN** that panel's matching control renders pre-set to the value the URL encodes, and the
  panel's Output read reflects that filter

#### Scenario: Clearing a control returns to the author's default
- **WHEN** a viewer clears a control that has no explicit URL value
- **THEN** the control's value reverts to the author's configured `defaultValue`, and, if none is
  set, the panel's read carries no filter for that control

### Requirement: A control selection composes with in-panel sort/filter as a server filter
A panel's active control selections SHALL be translated into HEL-1188 operators (`eq`, `in`,
`gte`, `lte`) on that request to `GET /api/outputs/:id/rows` (or the equivalent public route), AND
combined with the panel's own HEL-1027 in-panel sort/filter, if any, so that a row must satisfy
BOTH to be returned. Neither the viewer-control filter nor the in-panel filter SHALL silently
override or suppress the other.

#### Scenario: A date-range control narrows an already in-panel-filtered table
- **WHEN** a viewer has an in-panel column filter active on a table AND sets a date-range control
- **THEN** the returned rows satisfy both filters simultaneously

### Requirement: Pagination resets coherently and counts reflect the filtered set
Changing any control's value SHALL reset that panel's pagination to the first page. The resulting
response's row count and `hasMore` SHALL describe the set produced by the CURRENT combined filter
(control selections plus in-panel filter), with no dropped or duplicated rows across pages.

#### Scenario: Count reflects the narrowed set
- **WHEN** a viewer narrows an Output larger than one page via a control
- **THEN** the panel's displayed count and `hasMore` describe the filtered set, not the
  Output's unfiltered total

### Requirement: A rapid control change cannot leave a stale response applied
Changing a control while a previous read for that panel is still in flight SHALL NOT let the
in-flight (now-superseded) response overwrite the panel's state once it resolves; only the
response for the most recent request SHALL be applied. This reuses HEL-1027's existing
request-sequencing guard rather than introducing a second mechanism.

#### Scenario: A late-arriving stale response is discarded
- **WHEN** a viewer changes a control twice in rapid succession, and the first request's response
  arrives after the second request's
- **THEN** the panel reflects only the second (most recent) request's response

### Requirement: Chart panels are filtered by controls, reading only the loaded page
A chart-kind output panel's controls SHALL filter its data read identically to a table-kind
panel's — the same combined-filter request to the rows read — but a chart panel plots only the
first loaded page of the result, exactly as it does today for an unfiltered read; controls narrow
WHAT is plotted, not how much of it is fetched.

#### Scenario: A control narrows a chart's plotted data
- **WHEN** a viewer sets a dropdown control on a chart-kind panel
- **THEN** the chart re-fetches its first page under the combined filter and re-renders using
  only that page, exactly as its unfiltered read behaves today

### Requirement: Controls render on every panel-render path
Controls SHALL render, and behave identically (per every requirement above), on the desktop
panel grid, the mobile panel stack, the fullscreen panel overlay, the panel detail modal, and a
public dashboard viewed by an anonymous or share-token viewer.

#### Scenario: A control set on the desktop grid persists when the panel is viewed fullscreen
- **WHEN** a viewer sets a control on a panel in the desktop grid, then opens that panel fullscreen
- **THEN** the fullscreen view shows the same control value and filtered data (the URL state is
  shared across render paths, since it lives in the URL, not per-component state)

### Requirement: Controls are keyboard-operable, labelled, and announce result changes
Every control SHALL be reachable and operable by keyboard alone, SHALL carry a
programmatically-associated label, and SHALL show a visible focus indicator. A resulting change in
a panel's row count SHALL be announced to assistive technology via the panel's existing live
region (or equivalent), not a newly introduced, separate one.

#### Scenario: Setting a control by keyboard alone
- **WHEN** a viewer tabs to a dropdown control and selects a value via arrow keys and Enter
- **THEN** the panel's data refilters with no pointer interaction required

#### Scenario: A result-count change is announced
- **WHEN** a control change causes the panel's row count to change
- **THEN** the new count is announced via the existing live region
