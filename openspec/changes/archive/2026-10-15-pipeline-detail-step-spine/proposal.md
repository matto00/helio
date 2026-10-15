## Why

The desktop pipeline detail page is crowded: a source bar, an outputs/schedule bar, Steps/Outputs tabs, every step card expanded inline with 5+ accent-coloured controls (Branch, Add step, Preview, + Output, Save), and a footer of schema chips plus run buttons. Steps get lost and accent discipline (DESIGN.md §0) is broken. HEL-1579 (epic HEL-1570, approved board "B2 · Pipeline" / `PipelineLive`) replaces it with a step spine, one focused step editor and a preview table under one compact header. HEL-1581 (live preview) and HEL-1582 (mobile) build on this layout.

## What Changes

- **Desktop layout (above the 768px phone boundary):** one compact header row; a left **step spine**; a centre column with the **focused editor** of the selected step above a **preview table** of rows after that step; a reserved, empty grid slot for HEL-1581's live Output column. The phone layout (≤768px) keeps the current river view unchanged until HEL-1582.
- **Header (one row):** "Pipelines" breadcrumb, the pipeline name in mono (inline rename, with the existing Save/Cancel/discard-confirm), a run status chip, rows written + relative last run (+ the truncated badge), a schedule chip ("Add schedule" when none), Dry run (secondary), **Run** (the only primary), and the "Pipeline actions" overflow (Rename, schedule edit/pause/resume, Run history, Share, Edit source). No Delete (owner ruling: Delete lives only on overview rows).
- **Command bar:** on `/pipelines/:id` the visible desktop breadcrumb shows only the section label; the page header owns the name (owner ruling `header-owns-name`; no title duplication). Minimal `CommandBar.tsx` diff through one shared predicate, coordinated with HEL-1575.
- **Spine:** per source (root) a Source card then its numbered steps on a vertical line, each with title, one-line mono summary, and the **row count after that step**; branches (lanes) as indented, labelled sub-spines nested by depth (owner ruling "sub-spine + label"); "+ Add step"; an OUTPUTS section listing every Output (owner ruling `spine-output-section`; the Steps/Outputs tabs are removed). The selected step has an accent wash and an accent-filled number. A quiet per-row menu carries Move up/down, Insert step after, Branch from here and Add output; drag-reorder stays on trunk rows (owner ruling `spine-row-menu`, nothing dropped).
- **Focused editor:** the selected step's existing op editor (every step kind), warnings and validation, with Disable / Duplicate / Remove as quiet text actions.
- **Preview table:** rows after the selected step (existing `GET /api/pipelines/:id/steps/:stepId/preview`), column type in each header (from analyze), with the schema-diff chips and the output-schema chips (moved from the footer) in its header.
- **Per-step row counts persisted (owner ruling `persist-last-run-counts`):** Flyway **V135** adds `pipeline_runs.step_row_counts JSONB NULL` and `pipelines.last_run_step_row_counts JSONB NULL`, written with the existing last-run fields; the pipeline response gains `lastRunStepRowCounts`. The spine shows the in-session run's counts, else the persisted latest run's.
- **Accent discipline:** only Run, the selected step and focus rings use the accent on this page.
- **BREAKING (UI only):** the desktop Steps/Outputs tabs, the footer, the river view and the per-card Preview toggle are removed from the desktop page; tests are migrated with no lost assertions.

## Capabilities

### New Capabilities
- `pipeline-detail-spine-layout`: the desktop pipeline detail layout: compact header, step spine (sources, numbered steps, labelled lane sub-spines, outputs), step selection, focused editor, preview table, reserved live-output slot, accent discipline, no-page-scroll at 1280×800.
- `pipeline-run-step-row-counts-persistence`: persisting each run's per-step row counts and exposing the latest run's counts on the pipeline response.

### Modified Capabilities
- `pipeline-editor-page`: footer, header-menu, last-run metadata bar, output-name and insert-between requirements now describe the header/spine on desktop.
- `pipeline-lane-editor-ui`: lanes render as labelled sub-spines on desktop (side-by-side columns only on the phone river).
- `pipeline-outputs-gallery`: the Outputs tab is replaced by the spine's OUTPUTS section.
- `pipeline-tails-ui`, `pipeline-root-editor-ui`, `pipeline-schedule-config-ui`: tails, roots and the schedule bar move into the spine / header chip on desktop.

## Impact

- Frontend: `frontend/src/features/pipelines/ui/` (new spine/editor/preview/header components; `PipelineDetailPage`, `StepCard` focused variant, CSS), `hooks/usePipelineDetailPage.ts` and related hooks, `app/CommandBar.tsx` (breadcrumb item name hidden on the rail-shell pipeline detail route via one shared predicate, minimal; overlaps HEL-1575), unit tests and Playwright e2e specs under `e2e/` that target the desktop page.
- Backend: Flyway `V135__pipeline_run_step_row_counts.sql`, `PipelineRunSucceededWrites`/terminal writes, `PipelineRepository`/`PipelineRunRepository`, `PipelineProtocol`, `model.scala`, the run executor/terminal-write plumbing, the reaper SQL, `OutputRoutes` (`panelCount` on the per-pipeline Outputs list); JSON schemas under `schemas/pipelines/`.
- No change to step semantics, run execution, or the phone layout. Out of scope: draft mode / Save & run (HEL-1581), the live Output render (HEL-1581), mobile (HEL-1582), the shell-wide document-scroll guard (HEL-1585, reported on).
