# Design: inline-step-output-preview

## Context

`StepCard.tsx` owns a transient, click-driven preview: `handlePreviewToggle` calls
`fetchStepPreview(pipelineId, step.id)` (`services/pipelineService.ts`) and renders rows in
`DataGrid variant="preview"`. Analyze data is already plumbed per step: `PipelineDetailPage.tsx`
holds `analyzeResult` (Redux, `pipelinesSlice`), re-dispatches `analyzePipeline` debounced 300ms on
a steps fingerprint (`id:opType:JSON.stringify(config)`), and passes `getAnalyzeColumns` /
`getAnalyzeSchema` / `getAnalyzeValidationError` helpers through `PipelineRiverView.tsx` into each
`StepCard`. Those helpers all read the analyze step's `inputSchema`; `AnalyzeStepResult` also
carries `outputSchema` (`types/pipelineStep.ts`, `BaseAnalyzeStep`) — currently unused by StepCard.
Config edits PATCH immediately via `useStepCardState` ("update local state and PATCH in lockstep"),
then `onConfigChange` propagates the new config to the parent, which updates `step.config`.

## Goals / Non-Goals

Goals: inline rows+schema preview per step; debounced auto-refresh after config edits; persistent
open/closed preference; reuse existing loading/error handling; zero backend change.
Non-goals: schema diff vs input (HEL-405); backend `previewStep` changes; preview row-cap changes.

## Decisions

1. **Schema comes client-side from analyze `outputSchema`** — no backend change. Add
   `getAnalyzeOutputSchema(stepId): SchemaField[]` in `PipelineDetailPage` (mirror of
   `getAnalyzeSchema` reading `outputSchema`), thread through `PipelineRiverView` as a new
   `analyzeOutputSchema: SchemaField[]` StepCard prop. Schema freshness needs no new plumbing: the
   existing 300ms-debounced re-analyze already refreshes `analyzeResult` after config edits.
   *Why not the whole `AnalyzeStepResult`?* StepCard's existing props are narrow slices
   (`analyzeColumns`, `analyzeSchema`); keep the pattern, and HEL-405 will want its own slice.

2. **Preview fetching becomes effect-driven.** Replace the fetch-in-click-handler with one
   effect: when `expanded && previewOpen`, fetch on activation; on subsequent changes of a config
   fingerprint (`JSON.stringify(step.config)`) while active, re-fetch after a 500ms debounce
   (`window.setTimeout` + cleanup, same shape as the 300ms analyze debounce in
   `PipelineDetailPage`). 500ms > 300ms so the analyze round-trip and PATCH bursts settle first;
   `step.config` only changes after a successful PATCH (`onConfigChange` fires post-PATCH), so this
   is "refresh after the PATCH settles" by construction. The toggle button now only flips
   `previewOpen`. Refresh reuses the existing loading/error states (grid swaps to "Loading
   preview…" during re-fetch — accepted; simplest reuse of existing handling).
   The effect distinguishes *initial activation* from *config change while active* with a
   `lastFetchedFingerprint` ref: `null` means "not fetched since last activation" → fetch
   immediately, no debounce; a non-null value differing from the current fingerprint → debounced
   re-fetch. The ref resets to `null` whenever the preview deactivates (close or collapse), so
   reopening always fetches fresh.

3. **Persistent-open preference: one global localStorage boolean**, key
   `"helio-step-preview-open"`, following the `theme.ts` `ThemeStorageKey` precedent for the
   storage-key + read-at-init pattern (the try/catch around storage access is our own hardening —
   `theme.ts` itself only guards `typeof window`). Semantics: the last explicit open/hide choice
   becomes the default `previewOpen` for every StepCard, so expanding any card auto-opens its
   preview once the user has opted in. **Mechanism** (all StepCards mount unconditionally in
   `PipelineRiverView.steps.map(...)` — only the body is gated on `expanded` — so a mount-time-only
   read cannot observe a same-session preference change made on a sibling card): read the stored
   value in a lazy `useState` initializer for the initial default, **and re-sync `previewOpen`
   from localStorage on every collapsed→expanded transition** (in the header-click expand handler),
   so a card expanded *after* a sibling's toggle picks up the latest preference. Write the value on
   every explicit preview toggle. *Why re-sync-on-expand over lifted/shared state or a `storage`
   listener?* It is the smallest mechanism that satisfies the spec scenario exactly at the moment
   it matters (expansion), adds no new shared state or context, and `storage` events don't fire in
   the same document anyway. *Why global, not per-step?* Per-step keys leak unbounded entries for
   deleted steps; the ticket asks for a per-user "feel inline" preference, not per-step memory.

4. **Schema rendering**: a compact "Output schema" strip inside the existing
   `pipeline-detail-page__step-preview` tray, above the rows grid — one chip per column,
   `name: type`, muted type token per `DESIGN.md`; new CSS stays in the existing
   `pipeline-detail-page__step-preview-*` block family. When analyze data is missing for the step
   (analyze pending/failed or step id not found), omit the schema strip; rows render regardless.
   A `validationError` on the step does not block the preview — server error handling covers it.

5. **Tests** (no `StepCard.test.tsx` exists today — create it): mock `fetchStepPreview`; use fake
   timers for the debounce. Cover: rows+schema render together; schema strip omitted when
   `analyzeOutputSchema` is empty; config-fingerprint change while open triggers exactly one
   debounced re-fetch; closed preview does not re-fetch; localStorage preference read/write
   (auto-open when stored true); loading and error states.

## Planner Notes (self-approved)

- Refresh replaces the grid with the existing loading state rather than a keep-stale-rows
  "refreshing" affordance — smallest change satisfying "reuse existing preview error handling".
- Global (not per-step) persistence — see Decision 3.
- 500ms refresh debounce constant local to StepCard; not user-configurable.
- `PipelineDetailPage.tsx` is already 571 lines, past `CONTRIBUTING.md`'s ~400-line budget. Task
  1.1 adds one small helper anyway (mechanical mirror of its three siblings); per CONTRIBUTING.md
  the PR description MUST call this out and propose a split (e.g. extract the `getAnalyzeX` helper
  family into a hook) rather than silently growing the file. The executor records this in
  `files-modified.md`; the orchestrator carries it into the PR body.

## Risks

- Auto-open across many expanded cards fires one preview request per open card after each edit;
  bounded by the 500ms debounce and the ≤10-row response. Acceptable for editor-scale step counts.
- `JSON.stringify(step.config)` fingerprint matches the established `stepsFingerprint` idiom;
  key-order instability is a non-issue in practice (configs are constructed consistently).
