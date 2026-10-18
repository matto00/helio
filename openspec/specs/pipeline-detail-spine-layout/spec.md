# pipeline-detail-spine-layout Specification

## Purpose
Defines the desktop pipeline detail page: one compact header, a step spine with sources, numbered steps, labelled lane sub-spines and outputs, one focused step editor, a preview table of rows after the selected step, and a reserved slot for the live Output column.

## Requirements

### Requirement: Desktop pipeline detail renders header, spine, editor and preview
Above the 768px phone boundary (`useIsPhoneShell()` false), `/pipelines/:id` SHALL render one compact header row, a left step spine (270–340px), and a centre column holding the selected step's editor above a preview table, plus a reserved, initially zero-width `live-output` grid track for the live Output column. At or below 768px the page SHALL render the phone layout defined by the `pipeline-detail-mobile-layout` capability; the river view no longer exists.

#### Scenario: Desktop layout
- **WHEN** a user opens a pipeline at 1280×800
- **THEN** the header, the spine, the focused editor and the preview table are rendered, and no Steps/Outputs tab strip and no footer bar are rendered

#### Scenario: Phone layout unchanged
- **WHEN** the same pipeline is opened at 390px wide
- **THEN** (scenario name kept for archive; the phone layout is no longer the river) the phone header, the Steps / Preview / Runs tabs, the step list and the floating run pills render, and no river view, no Outputs tab and no footer bar are rendered

### Requirement: The header is one row with a single primary action
The header SHALL show a "Pipelines" breadcrumb, the pipeline name in mono (inline rename with Save, Cancel and discard confirm), a run status chip, rows written with the relative last run, a schedule chip ("Add schedule" when none), a secondary Dry run, the primary Run, and a "Pipeline actions" overflow menu (Rename, Set/Edit schedule, Pause/Resume schedule, Run history, Share for the owner, Edit source for a single resolvable root). The page SHALL offer no pipeline or source Delete action. The header SHALL show the in-session run status when there is one, else the persisted last-run Succeeded/Failed status, and a save error as an alert while renaming. On `/pipelines/:id` the desktop command bar SHALL show only the section label so the pipeline name is not duplicated; the phone title is unchanged. Narrow desktop widths (769–1100px): the header stays one row. The "Pipelines /" crumb is hidden (the command bar's section label names the section), the rows-written meta text truncates with an ellipsis first and at ≤900px is hidden (the run status chip still shows the last run's outcome; the figures stay in Run history), and the schedule chip is NEVER dropped: when the page is narrow (≤800px of content width, i.e. the viewport minus the rail and the 200–400px context list) it is compact (expression ellipsized, "next run" text moved into its title, the "Paused" marker kept), and below ≈600px of content width it collapses to a calendar icon that keeps the "Paused" marker visible, with the full state in its title. The pipeline name keeps at least 14 characters (8 below ≈600px, where the last-run chip also shows only its dot, Dry run becomes icon-only keeping its accessible name, and Run shows "Run" keeping the name "Run pipeline"). From 769px up nothing in the header overflows or is clipped, Run and the actions menu are fully inside the viewport, and the editor's action row wraps inside the centre column, with the context list at its default or its maximum width.

#### Scenario: No delete on the detail page
- **WHEN** an owner opens the header overflow menu
- **THEN** it contains no Delete item and no other control on the page deletes the pipeline or a source

#### Scenario: Paused schedule stays visible when narrow
- **WHEN** the pipeline has a paused schedule and the desktop viewport is 820, 900 or 1100px wide
- **THEN** the header still shows the schedule chip with its "Paused" marker and a title stating the full state, on one row, and the pipeline name stays readable

#### Scenario: Schedule chip with no schedule
- **WHEN** the pipeline has no schedule
- **THEN** the header shows an "Add schedule" chip that opens the schedule dialog

### Requirement: The spine lists sources, numbered steps with row counts, labelled lanes and outputs
The spine SHALL render, per root in order, a Source card followed by that root's trunk steps numbered from 1, each row showing the step title, a one-line mono summary of its config, and the row count after that step (the in-session run's count, else the pipeline's persisted latest-run count, else "—"; "off" for a disabled step). When those counts come from a run whose source read was truncated, the spine SHALL mark them as partial with text, not colour alone. The steps heading SHALL show the step count, hidden while the steps are loading or failed. Each lane SHALL render as an indented sub-spine directly under the step it branches from, nested by depth, headed by a quiet label naming the lane and its parent step. An OUTPUTS section SHALL list every Output with its kind, panel-use count and step, without a per-Output request; activating one opens the Output editor sheet.

#### Scenario: Row counts from the persisted latest run
- **WHEN** a pipeline whose latest run recorded per-step counts is opened in a fresh session
- **THEN** each step row shows its recorded count, and a step added after that run shows "—"

#### Scenario: Partial persisted counts are marked
- **WHEN** the latest run was truncated and its persisted counts are shown
- **THEN** the spine shows a "Partial" marker and each count's accessible name says it is partial

#### Scenario: Branch is visible and selectable
- **WHEN** a pipeline has a lane branching from step 2
- **THEN** the lane renders indented under step 2 with a lane label, and selecting a lane row shows that step in the editor and its rows in the preview table

### Requirement: Selecting a step updates the editor and the preview table
Exactly one step SHALL be selected at a time (default: the first trunk step of the first root), reflected in the `step` URL search parameter. Selecting a row SHALL show that step's editor and the preview of rows after it. A newly created step becomes selected; removing the selected step selects a neighbour. Switching selection SHALL never drop an edit in progress.

#### Scenario: Selection switch persists a pending edit
- **WHEN** a user edits step 1's config and immediately selects step 2
- **THEN** step 1's edited config is saved and step 2's editor and preview are shown

### Requirement: Every step kind is editable in the focused editor
The focused editor SHALL render the selected step's existing op editor for every step kind (unsupported kinds read-only as today), its warnings and validation errors, and Disable/Enable, Duplicate and Remove as quiet text actions. Requirements of other capabilities that describe a step kind's editor inside the step card (op editors, cost disclosure, target errors) apply unchanged to the focused editor, which hosts the same op editors. Per-row actions SHALL remain available from the spine: Move up/down and drag reorder on trunk lanes, Insert step before/after on the first source's trunk rows (where insertion points exist today), Branch from here and Add output on every row. A pending edit whose save fails after the editor is gone SHALL surface on that step's spine row and in its editor when re-selected.

#### Scenario: Insert after from the row menu
- **WHEN** a user chooses "Insert step after" on step 1 and picks an op
- **THEN** the new step is inserted at position 2 and becomes selected

### Requirement: The preview table shows rows after the selected step with column types
The preview table SHALL show the rows returned for the selected step by the step preview endpoint, with each column header carrying the column name and its type from analyze, the row count, the step's schema-diff chips and its output-schema chips. A disabled step SHALL show that rows pass through unchanged and SHALL NOT fetch. A rejected preview SHALL show its named reason. Opening the page SHALL issue exactly one step-preview request for the initially selected step, including under React StrictMode.

#### Scenario: One preview request on open
- **WHEN** the page is opened under React StrictMode
- **THEN** exactly one step-preview GET is issued for the selected step

#### Scenario: Column types in the header
- **WHEN** step 1 outputs a numeric `duration_s` column
- **THEN** its header shows `duration_s` and its type

### Requirement: The page fits 1280×800 without page scroll
For a 3-step pipeline at 1280×800 the spine, the editor and at least 8 preview rows SHALL be visible without scrolling the document; the spine and the preview table scroll internally.

#### Scenario: No document scroll
- **WHEN** a 3-step pipeline with at least 8 preview rows is opened at 1280×800
- **THEN** `document.documentElement.scrollHeight` is at most `innerHeight` and 8 preview rows are inside the viewport

### Requirement: Accent only on Run, the selected step and focus
On the desktop pipeline detail page the accent SHALL appear only on the primary Run button, the selected step row (wash and filled number) and focus rings, including native control `accent-color`, SVG fill/stroke, outlines and shadows; every other control is secondary or ghost, in both themes and for every accent preset.

#### Scenario: Accent audit
- **WHEN** the page is rendered with a step selected and nothing focused
- **THEN** no element other than Run and the selected row resolves any colour to the accent
