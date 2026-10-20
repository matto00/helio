## MODIFIED Requirements

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

### Requirement: Accent only on Run, the selected step and focus
On the desktop pipeline detail page the accent SHALL appear only on the primary action (Run, or Save & run while a draft exists), the selected step row (wash and filled number) and focus rings, including native control `accent-color`, SVG fill/stroke, outlines and shadows; every other control (including Discard, the draft chip and the preview's live indicator) is secondary or ghost, with two DESIGN.md §11 exceptions: the draft chip itself stays secondary but its leading dot is `--app-accent`, and the changed-row flash wash is `--app-accent` at 22% (owner ruling `accent-22-amend-design`), in both themes and for every accent preset.

#### Scenario: Accent audit
- **WHEN** the page is rendered with a step selected and nothing focused
- **THEN** no element other than Run and the selected row resolves any colour to the accent

#### Scenario: Accent audit with a draft
- **WHEN** the page is rendered with a draft, a step selected and nothing focused
- **THEN** no element other than Save & run and the selected row resolves any colour to the accent

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
