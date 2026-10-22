# pipeline-detail-spine-layout Specification

## Purpose
Defines the desktop pipeline detail page: one compact header, a step spine with sources, numbered steps, labelled lane sub-spines and outputs, one focused step editor, a preview table of rows after the selected step, and the live Output column.

## Requirements

### Requirement: Desktop pipeline detail renders header, spine, editor and preview
Above the 768px phone boundary (`useIsPhoneShell()` false), `/pipelines/:id` SHALL render one compact header row, a left step spine whose width follows the page's own content width (the viewport minus the rail and the 200–400px context list), not the viewport: 270–340px at 1280×800 when the page has no live Output column, never narrower than 180px, and about 240px or more once the page leaves the centre column at least about 320px (growing to the 340px cap), and a centre column holding the selected step's editor above a preview table, plus a `live-output` grid track that holds the live Output column (capability `pipeline-live-output-column`) at about 340-380px when the page is wide enough for three columns and is zero-width otherwise. At or below 768px the page SHALL render the phone layout defined by the `pipeline-detail-mobile-layout` capability; the river view no longer exists.

From 769 to 1100px, in both themes and with the context list at its default or maximum width, every spine step title (trunk and lane rows) SHALL be readable: at least about 60px of it visible and unobscured, or the full title. Where the spine is narrow, a row MAY move its row count onto the summary line and show its ⋮ menu only on hover or keyboard focus (it stays reachable by keyboard); the phone layout is unaffected.

#### Scenario: Step titles readable at narrow desktop widths
- **WHEN** a pipeline with a lane is opened at any width from 769 to 1100px (8px steps), in light or dark, with the context list at 248px or 400px
- **THEN** every step title in the spine (trunk and lane rows) shows its full title or at least about 60px of it, not covered by another element, and the header and editor-action checks still pass

#### Scenario: Desktop layout
- **WHEN** a user opens a pipeline at 1280×800
- **THEN** the header, the spine, the focused editor and the preview table are rendered, and no Steps/Outputs tab strip and no footer bar are rendered

#### Scenario: Phone layout unchanged
- **WHEN** the same pipeline is opened at 390px wide
- **THEN** (scenario name kept for archive; the phone layout is no longer the river) the phone header, the Steps / Preview / Runs tabs, the step list and the floating run pills render, and no river view, no Outputs tab and no footer bar are rendered

### Requirement: The header is one row with a single primary action
The header SHALL show a "Pipelines" breadcrumb, the pipeline name in mono (inline rename with Save, Cancel and discard confirm), a run status chip, rows written with the relative last run, a schedule chip ("Add schedule" when none), a secondary Dry run, the primary Run, and a "Pipeline actions" overflow menu (Rename, Set/Edit schedule, Pause/Resume schedule, Run history, Share for the owner, Edit source for a single resolvable root). The page SHALL offer no pipeline or source Delete action. The header SHALL show the in-session run status when there is one, else the persisted last-run Succeeded/Failed status, and a save error as an alert while renaming. On `/pipelines/:id` the desktop command bar SHALL show only the section label so the pipeline name is not duplicated; the phone title is unchanged. Narrow desktop widths (769–1100px): the header stays one row. The "Pipelines /" crumb is hidden (the command bar's section label names the section), the rows-written meta text truncates with an ellipsis first and at ≤900px is hidden (the run status chip still shows the last run's outcome; the figures stay in Run history), and the schedule chip is NEVER dropped: when the page is narrow (≤800px of content width, i.e. the viewport minus the rail and the 200–400px context list) it is compact (expression ellipsized, "next run" text moved into its title, the "Paused" marker kept), and below ≈600px of content width an active schedule's chip collapses to its calendar icon while a paused schedule's chip shows only its visible "Paused" word (the icon is dropped), each with the full state in its title. The pipeline name keeps at least 14 characters (8 below ≈600px, where the last-run chip also shows only its dot, Dry run becomes icon-only keeping its accessible name, and Run shows "Run" keeping the name "Run pipeline"). From 769px up nothing in the header overflows or is clipped, Run and the actions menu are fully inside the viewport, and the editor's action row wraps inside the centre column, with the context list at its default or its maximum width.

While the pipeline has an unsaved draft (see `pipeline-draft-mode-ui`), the header SHALL show a "Draft · unsaved changes" chip after the pipeline name, and SHALL replace the secondary Dry run with a secondary Discard and the primary Run with the primary Save & run; the overflow menu and the other header items are unchanged. At narrow desktop widths the same truncation order applies, and Discard and Save & run are never clipped.

#### Scenario: No delete on the detail page
- **WHEN** an owner opens the header overflow menu
- **THEN** it contains no Delete item and no other control on the page deletes the pipeline or a source

#### Scenario: Paused schedule stays visible when narrow
- **WHEN** the pipeline has a paused schedule and the desktop viewport is 820, 900 or 1100px wide
- **THEN** the header still shows the schedule chip with its "Paused" marker and a title stating the full state, on one row, and the pipeline name stays readable

#### Scenario: Schedule chip with no schedule
- **WHEN** the pipeline has no schedule
- **THEN** the header shows an "Add schedule" chip that opens the schedule dialog

#### Scenario: Draft header
- **WHEN** a step's config is edited on the desktop page
- **THEN** the header shows "Draft · unsaved changes", a Discard button and a Save & run button as the only primary action, and no Dry run or Run button

### Requirement: The spine lists sources, numbered steps with row counts, labelled lanes and outputs
The spine SHALL render, per root in order, a Source card followed by that root's trunk steps numbered from 1, each row showing the step title, a one-line mono summary of its config, and the row count after that step (the in-session run's count, else the pipeline's persisted latest-run count, else "—"; "off" for a disabled step). While a draft exists (see `pipeline-draft-mode-ui`) the count SHALL instead be the draft's count over the cached source sample, shown as "saved → draft" (both over the same sample, never a run count beside a sample count) when they differ; when the sample is truncated these counts SHALL carry a visible sample marker and an accessible name saying they are counts over the sample. When those counts come from a run whose source read was truncated, the spine SHALL mark them as partial with text, not colour alone. The steps heading SHALL show the step count, hidden while the steps are loading or failed. Each lane SHALL render as an indented sub-spine directly under the step it branches from, nested by depth, headed by a quiet label naming the lane and its parent step. An OUTPUTS section SHALL list every Output with its kind, panel-use count and step, without a per-Output request; activating one opens the Output editor sheet.

#### Scenario: Row counts from the persisted latest run
- **WHEN** a pipeline whose latest run recorded per-step counts is opened in a fresh session
- **THEN** each step row shows its recorded count, and a step added after that run shows "—"

#### Scenario: Partial persisted counts are marked
- **WHEN** the latest run was truncated and its persisted counts are shown
- **THEN** the spine shows a "Partial" marker and each count's accessible name says it is partial

#### Scenario: Branch is visible and selectable
- **WHEN** a pipeline has a lane branching from step 2
- **THEN** the lane renders indented under step 2 with a lane label, and selecting a lane row shows that step in the editor and its rows in the preview table

#### Scenario: Draft counts
- **WHEN** a draft lowers a filter threshold so step 1 keeps 92 of the 104 sampled rows it kept before
- **THEN** step 1's count reads "104 → 92" and its accessible name says 104 rows saved and 92 in the draft

### Requirement: Selecting a step updates the editor and the preview table
Exactly one step SHALL be selected at a time (default: the first trunk step of the first root), reflected in the `step` URL search parameter. Selecting a row SHALL show that step's editor and the preview of rows after it. A newly created step becomes selected; removing the selected step selects a neighbour. Switching selection SHALL never drop an edit in progress: the edit stays in the draft (see `pipeline-draft-mode-ui`) and is not written until Save & run.

#### Scenario: Selection switch persists a pending edit
- **WHEN** a user edits step 1's config and immediately selects step 2
- **THEN** step 1's edited config stays in the draft with no request sent, and step 2's editor and preview are shown

### Requirement: Every step kind is editable in the focused editor
The focused editor SHALL render the selected step's existing op editor for every step kind (unsupported kinds read-only as today), its warnings and validation errors, and Disable/Enable, Duplicate and Remove as quiet text actions. Requirements of other capabilities that describe a step kind's editor inside the step card (op editors, cost disclosure, target errors) apply unchanged to the focused editor, which hosts the same op editors. Per-row actions SHALL remain available from the spine: Move up/down and drag reorder on trunk lanes, Insert step before/after on the first source's trunk rows (where insertion points exist today), Branch from here and Add output on every row. A pending edit whose save fails after the editor is gone SHALL surface on that step's spine row and in its editor when re-selected.

#### Scenario: Insert after from the row menu
- **WHEN** a user chooses "Insert step after" on step 1 and picks an op
- **THEN** the new step is inserted at position 2 and becomes selected

### Requirement: The preview table shows rows after the selected step with column types
The preview table SHALL show the rows returned for the selected step by the step preview endpoint, with each column header carrying the column name and its type from analyze, the row count, the step's schema-diff chips and its output-schema chips. A disabled step SHALL show that rows pass through unchanged and SHALL NOT fetch. A rejected preview SHALL show its named reason. Opening the page SHALL issue exactly one step-preview request for the initially selected step, including under React StrictMode. While a draft exists (see `pipeline-draft-mode-ui`) the table SHALL instead show the selected step's draft rows computed in the browser, with its live, updating or stale state, and SHALL send no step-preview request; Discard returns to the saved preview without a request.

#### Scenario: One preview request on open
- **WHEN** the page is opened under React StrictMode
- **THEN** exactly one step-preview GET is issued for the selected step

#### Scenario: Column types in the header
- **WHEN** step 1 outputs a numeric `duration_s` column
- **THEN** its header shows `duration_s` and its type

#### Scenario: Draft rows without a request
- **WHEN** a user edits the selected step's config
- **THEN** the table shows the recomputed rows and no step-preview request is sent

### Requirement: The page fits 1280×800 without page scroll
For a 3-step pipeline at 1280×800 the spine, the editor and at least 8 preview rows SHALL be visible without scrolling the document; the spine and the preview table scroll internally.

#### Scenario: No document scroll
- **WHEN** a 3-step pipeline with at least 8 preview rows is opened at 1280×800
- **THEN** `document.documentElement.scrollHeight` is at most `innerHeight` and 8 preview rows are inside the viewport

### Requirement: Accent only on Run, the selected step and focus
On the desktop pipeline detail page the accent SHALL appear only on the primary action (Run, or Save & run while a draft exists), the selected step row (wash and filled number) and focus rings, including native control `accent-color`, SVG fill/stroke, outlines and shadows; every other control (including Discard, the draft chip and the preview's live indicator) is secondary or ghost, with two DESIGN.md §11 exceptions: the draft chip itself stays secondary but its leading dot is `--app-accent`, and the changed-row flash wash is `--app-accent` at 22% (owner ruling `accent-22-amend-design`), in both themes and for every accent preset.

#### Scenario: Accent audit
- **WHEN** the page is rendered with a step selected and nothing focused
- **THEN** no element other than Run and the selected row resolves any colour to the accent

#### Scenario: Accent audit with a draft
- **WHEN** the page is rendered with a draft, a step selected and nothing focused
- **THEN** no element other than Save & run and the selected row resolves any colour to the accent

### Requirement: The output schema panel is placed by its real height
The output schema panel SHALL open above its trigger when its rendered height (content height, bounded by its CSS
cap) fits above, and otherwise on whichever side has more room, with its height capped to the room on that side. A
panel short enough to fit above SHALL never open below, on desktop or phone. On a phone page outside the step sheet
the room below SHALL end at the bottom navigation's top edge. Its width, edge margin and height cap SHALL come from
its CSS, not from literal pixel copies of it.

#### Scenario: Desktop panel opens above when its content fits above
- **WHEN** on desktop at 1280×800 and at 1000×800 a schema panel is opened whose content height fits in the room above
  its trigger while its 24rem cap does not
- **THEN** the panel is entirely above its trigger and inside the viewport

#### Scenario: Content taller than the room above
- **WHEN** a schema panel whose content is taller than the room above its trigger is opened
- **THEN** it opens on the side with more room, its height capped to that room, inside the viewport

#### Scenario: Short panel opens above when the cap would not fit
- **WHEN** a panel whose content is shorter than its cap is opened from a trigger with room above for its content but
  not for its cap
- **THEN** it opens above

#### Scenario: Phone panel clears the bottom nav
- **WHEN** the schema panel opens below its trigger on the phone page outside the sheet, at 375 and 768px, in light
  and dark
- **THEN** its bottom edge is above the bottom navigation's top edge (or the viewport edge where no bottom navigation
  is rendered)

### Requirement: The Output card names its source step clearly
The Output card SHALL describe what the Output reads as "from <step or lane subtitle>" (or "from the pipeline's
source"), never "off <step>".

#### Scenario: Output reading a step
- **WHEN** an Output reads the "Compute column" step
- **THEN** its card reads "from Compute column"
