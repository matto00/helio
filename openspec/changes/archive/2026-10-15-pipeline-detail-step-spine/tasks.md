## Standing Constraints

- [C1] Nothing is dropped: every affordance in design.md D5/D3/D4 keeps a reachable home on desktop; no existing unit/e2e assertion is deleted without a named replacement recorded in `test-migration.md` (before/after `it|test` and `expect(` counts per changed file).
- [C2] Accent only on Run, the selected step (wash + filled number) and focus rings on the desktop page; tokens only, no hardcoded colours or fonts (DESIGN.md §0, §9 themes-ready).
- [C3] No pipeline/source Delete on the detail page or its header (owner ruling, HEL-1574 D12).
- [C4] Phone (≤768px, `useIsPhoneShell()`) renders today's river view unchanged; do not edit the phone path's behaviour.
- [C5] No draft mode, Save & run, "live" marker or live Output render (HEL-1581); the per-edit PATCH stays.
- [C6] Do not edit HEL-1605's files (`PipelineListTable`, `SourceListTable`) or HEL-1575's tab/⌘K files; the only shell edit is `CommandBar.tsx`'s second breadcrumb conditional via the shared `hidesBreadcrumbItemName` predicate (design D3).
- [C7] Every cited test run shows this worktree's paths and non-zero counts; local caps: jest ≤3 workers, Playwright ≤2 workers, `nice -n 19`, `sbt testFull` in foreground shards; Bash timeout 600000.
- [C8] RLS for the new columns is proven in a non-BYPASSRLS session, not only by the default (superuser) test DB.

## 1. Spec reconciliation

- [x] 1.1 Add MODIFIED/REMOVED deltas under `specs/` for every existing requirement this layout contradicts on desktop, at minimum: `pipeline-editor-page` ("Editable output name in footer", "PipelineDetailPage shows persistent last-run metadata bar", "Header actions consolidate into one menu", "Footer pins primary actions and collapses the rest into an overflow menu", "Steps can be inserted between existing steps in the editor", "Source selector bar loads from API", "Run pipeline button shows placeholder" if stale), `pipeline-lane-editor-ui` ("Sibling lanes render side by side", "\"+ lane\" is offered on any step", "Analyze and validation render on every lane", "Drag-reorder operates within a lane"), `pipeline-outputs-gallery` (all three), `pipeline-tails-ui` (both), `pipeline-root-editor-ui` ("The river renders one lane column per root", "The header's \"+\" adds a root through the inline-source flow"), `pipeline-schedule-config-ui` ("Schedule bar shows current schedule state", "User can enable or disable a schedule"), `pipeline-editor-page` ("Pipeline detail boot requests are bounded", "A step card cannot be expanded while its create is in flight"), `pipeline-step-preview` ("StepCard Preview button fetches and renders sample rows", "The step card preview tray shows the named reason"), `pipeline-dry-run-ui` ("Pipeline detail page exposes a 'Dry run' button"), `pipeline-step-reorder` ("Pipeline editor supports drag and keyboard reordering of steps"), `pipeline-outputs-rail` (all requirements), `pipeline-run-truncation-reporting` ("A persisted row count is never displayed without its truncation context"), `pipeline-lane-run-reporting` ("Row counts render per node across every lane"), `pipeline-step-schema-diff` ("StepCard renders the real schema diff as chips"), `pipeline-step-lifecycle` ("The editor offers disable/enable and duplicate per step"), `pipeline-edit-flow` (Save/Cancel requirements that name the footer). Each MODIFIED delta states desktop behaviour and keeps the phone behaviour. Then run and record (in `test-migration.md`) a grep of every `openspec/specs/*/spec.md` for footer/tab/river/step-card/StepCard/OutputsRail/gallery wording and reconcile any further hits. `openspec validate pipeline-detail-step-spine --type change` exits 0.

## 2. Backend: per-step row counts (design D9)

- [x] 2.1 Confirm V135 is still free on origin/main and in the other lanes' branches; add `V135__pipeline_run_step_row_counts.sql` (two nullable JSONB columns, no backfill, header comment citing HEL-1579 and the V104 precedent).
- [x] 2.2 Thread `stepCounts` from `PipelineRunExecutor` (~:290-296) through `onRunSuccess` → `onUnblockedRunSuccess` → `writeTerminal`/`updateRunTerminal(Internal)` and `writeLastRun`/`updateLastRun(Internal)`; write each column in the same statement as its sibling count; apply design D9's table to every writer (succeeded, execution/write-back failed, blocked, `PipelineRunService` pre-execution failure, Spark paths, reaper SQL, dry run), verifying line numbers and adding any further writer found; map the columns in the repositories and `model.scala`.
- [x] 2.2a `GET /api/pipelines/:id/outputs` returns `panelCount` per item via `panelCountsFor` on the same ACL as `listOutputPanels` (design D13); schema + spec (owner and grantee counts).
- [x] 2.3 Add `lastRunStepRowCounts` to the pipeline response protocol and `schemas/pipelines/` JSON schema; schema-drift check passes.
- [x] 2.4 Specs: a succeeded run writes both columns; each failure path and the reaper write NULL; a never-run pipeline returns null; JSON round-trip; RLS via `TwoUserRlsApiFixture` (non-BYPASSRLS): owner run path and editor-grantee (`updateLastRunInternal`) path write, owner reads, non-owner/non-grantee reads nothing — fail first (show the red), then pass.

## 3. Frontend state and data

- [x] 3.1 Types: `lastRunStepRowCounts` on the pipeline summary; a `stepRowCount(stepId)` accessor (in-session run counts first, then persisted, else null).
- [x] 3.2 Selection: `step` URL search param (replace), default/created/removed-step rules (D6), coexisting with `?outputId=`.
- [x] 3.3 `summarizeStepConfig(step)` pure helper with unit tests per op kind and a fallback for unknown/unsupported kinds.
- [x] 3.4 Extract the preview fetch/debounce logic from `useStepCardPreview` into a shared hook used by both the phone tray and the desktop table; existing `useStepCardPreview` behaviour unchanged.
- [x] 3.5 `useStepCardPersist` opt-in `flushOnUnmount` (focused variant only; phone unchanged); no flush when the step is being removed or no longer exists; failed flushed saves go to page-level `stepSaveErrors` shown on the spine row and in the re-selected editor; tests for flush, remove-no-PATCH, flushed-422.
- [x] 3.6 Step preview: in-flight-only dedupe keyed by `stepId + configFingerprint` (no settled reuse), fetch fresh on every selection, and wait for pending step saves before the GET (design D8); tests (a) re-select after upstream edit refetches, (b) GET after the flushed PATCH resolves, (c) one GET on open under StrictMode.

## 4. Frontend desktop layout

- [x] 4.1 `PipelineDetailPage` branches on `useIsPhoneShell()`; desktop renders the new grid with the reserved zero-width `live-output` track (D1/D2).
- [x] 4.2 `PipelineSpineHeader` (D3/D4): breadcrumb, mono name + rename/Save/Cancel/discard confirm, status chip, rows written + relative last run + truncated badge, schedule chip, Dry run, Run, overflow (Rename, schedule edit/pause/resume, Run history, Share, Edit source); denial strip with "Run to update" and the truncation banner under it.
- [x] 4.3 `CommandBar.tsx`: add `hidesBreadcrumbItemName(pathname, isPhoneShell)` (new small module) and use it in the second breadcrumb conditional only; rail-shell `/pipelines/:id` shows only "Data Pipelines"; phone title and sr-only h1 unchanged; unit test; PR body notes the HEL-1575 overlap and merge plan.
- [x] 4.4 `PipelineSpine` (D5): source cards + menus + "+ Add source", numbered rows with summary/row count/markers, labelled lane sub-spines nested by depth, selection styling, row menu (Move up/down, Insert step before/after, Branch from here, Add output), drag reorder on trunk rows with a neutral drop indicator, "+ Add step", "Add Outputs from a shape", empty state, OUTPUTS section with Output cards (+ History menu) and "+ Output".
- [x] 4.5 `StepCard` `variant="focused"` (D7) with quiet Disable/Duplicate/Remove text actions, every op kind via `StepOpEditor`, creating-step guard.
- [x] 4.6 `StepPreviewTable` (D8): typed headers, row count, schema-diff chips, output-schema chips, states, sticky header, internal scroll.
- [x] 4.7 Accent sweep (D12) on every desktop-visible rule; neutral drop indicator; Save secondary.

## 5. Tests and verification

- [x] 5.1 Migrate unit tests (page, header, footer, gallery, river-page integration) per D10; write `test-migration.md`; keep component tests for phone components green; add a phone-path page test.
- [x] 5.2 Derive the e2e migration list from a recorded command (`grep -rl "/pipelines/\|pipeline-detail-page" e2e/`, which includes `e2e/support/` helpers such as `remountBurstSeed.ts`; output saved in `test-migration.md`); triage every hit (migrated / unaffected-with-reason); includes hel908-*, hel912, hel968, hel1007, hel1345, hel1230, hel958, hel1521, hel1096, hel1392-remount-request-burst, hel1392-remount-staleness, hel1094, hel909, hel910, hel1277, hel1331, state-surface-contrast-guard, focus-presence-guard.
- [x] 5.3 New unit tests for the spine, selection, header (incl. no-Delete), schedule chip/menu, preview table, row counts (persisted vs in-session vs "—"), lane labels and lane selection.
- [x] 5.4 New `e2e/hel1579-pipeline-spine-layout.spec.ts` per D11 (1280×800 no-scroll + ≥8 rows; 1440×900; selection; lanes; accent audit in both themes and two accent presets).
- [x] 5.5 Run lint, typecheck, format check, full jest (≤3 workers), backend `sbt testFull` (foreground shards), the affected Playwright specs (≤2 workers); record commands and counts.
- [x] 5.6 Screenshots of the running app (both themes; 1440, 1280, 820) persisted as evidence; report whether HEL-1585's symptom is gone on this page at 1440×900.
