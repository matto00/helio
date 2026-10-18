## MODIFIED Requirements

### Requirement: Desktop pipeline detail renders header, spine, editor and preview
Above the 768px phone boundary (`useIsPhoneShell()` false), `/pipelines/:id` SHALL render one compact header row, a left step spine whose width follows the page's own content width (the viewport minus the rail and the 200–400px context list), not the viewport: 270–340px at 1280×800, never narrower than 180px, and about 240px or more once the page leaves the centre column at least about 320px (growing to the 340px cap), and a centre column holding the selected step's editor above a preview table, plus a reserved, initially zero-width `live-output` grid track for the live Output column. At or below 768px the page SHALL render the phone layout defined by the `pipeline-detail-mobile-layout` capability; the river view no longer exists.

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

#### Scenario: No delete on the detail page
- **WHEN** an owner opens the header overflow menu
- **THEN** it contains no Delete item and no other control on the page deletes the pipeline or a source

#### Scenario: Paused schedule stays visible when narrow
- **WHEN** the pipeline has a paused schedule and the desktop viewport is 820, 900 or 1100px wide
- **THEN** the header still shows the schedule chip with its "Paused" marker and a title stating the full state, on one row, and the pipeline name stays readable

#### Scenario: Schedule chip with no schedule
- **WHEN** the pipeline has no schedule
- **THEN** the header shows an "Add schedule" chip that opens the schedule dialog
