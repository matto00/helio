## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Ticket/proposal/design/tasks/spec-delta all read** from
  `openspec/changes/inline-step-output-preview/{ticket,proposal,design,tasks}.md` and
  `specs/pipeline-step-preview/spec.md`.
- **Current `StepCard.tsx`** (`frontend/src/features/pipelines/ui/StepCard.tsx`) matches the
  design's "Context" description exactly: click-driven `handlePreviewToggle` calling
  `fetchStepPreview(pipelineId, step.id)`, rendering `DataGrid variant="preview"` inside
  `pipeline-detail-page__step-preview` (lines 64-89, 316-328). No `StepCard.test.tsx` exists
  today (`ls frontend/src/features/pipelines/ui/ | grep -i StepCard` → only `StepCard.tsx`),
  confirming the design/tasks' "create it" claim.
- **`AnalyzeStepResult.outputSchema`** exists exactly as claimed:
  `frontend/src/features/pipelines/types/pipelineStep.ts:313`, `BaseAnalyzeStep.outputSchema: SchemaField[]`,
  currently unread by `StepCard.tsx`/`PipelineDetailPage.tsx` (grep confirms only `inputSchema` is
  consumed by `getAnalyzeColumns`/`getAnalyzeSchema`/`getAnalyzeValidationError`,
  `PipelineDetailPage.tsx:204-224`).
- **Debounced re-analyze** confirmed at `PipelineDetailPage.tsx:175-185`: 300ms
  `window.setTimeout` on a `stepsFingerprint` (`id:opType:JSON.stringify(config)`), dispatching
  `analyzePipeline(id)`. Matches design's citation.
- **`useStepCardState`'s PATCH-on-change** confirmed at
  `frontend/src/features/pipelines/hooks/useStepCardState.ts:180-188` (`persist()` PATCHes
  immediately via `updatePipelineStep`, calls `onConfigChange` only `.then()` a successful PATCH —
  matches the design's "onConfigChange fires post-PATCH" claim exactly). Confirmed per-keystroke
  firing via `ComputeFieldConfig.tsx`'s `handleExpressionChange` → `emit()` → `onChange` on every
  keystroke, so `persist()`/PATCH fires per character, not on blur — consistent with existing
  behavior, not something this design changes.
- **`DataGrid` preview variant** confirmed: `frontend/src/shared/ui/DataGrid.tsx:24`
  (`type DataGridVariant = "full" | "preview"`), already used by `StepCard.tsx:325`.
- **`theme.ts` localStorage precedent** confirmed at `frontend/src/theme/theme.ts:55-71`
  (`ThemeStorageKey`, `getInitialTheme()`/`getInitialAccentColor()` reading
  `window.localStorage.getItem` inside a `typeof window === "undefined"` guard) — **but note**:
  neither function wraps the `localStorage.getItem` call in `try/catch`. Design.md Decision 3
  attributes the "try/catch guard" specifically to the `theme.ts` precedent; that specific detail
  is not actually present in `theme.ts`. Minor citation inaccuracy (see non-blocking notes).
- **Backend `previewStep`** confirmed unchanged/reused:
  `backend/src/main/scala/com/helio/services/PipelineRunService.scala:140-183` — runs the step
  prefix, `.take(10)` rows, no wire/enum change needed. Matches AC5 and the design's "zero backend
  change" non-goal.
- **`PipelineRiverView.tsx`** plumbing pattern confirmed (lines 17-32, 93-102): narrow
  `getAnalyzeX(stepId)` helper props threaded from `PipelineDetailPage` and applied per `StepCard`
  — the `getAnalyzeOutputSchema`/`analyzeOutputSchema` addition described in Decision 1 / Tasks
  1.1-1.2 is a mechanical mirror of the existing pattern and will work as described.
- **Backend `outputSchema` on validationError**: confirmed at
  `backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala:39` — "If a step has a
  validationError, its outputSchema equals its inputSchema (identity fallback)" — so Decision 4's
  claim ("a validationError on the step does not block the preview") is accurate; the schema strip
  will still have data to render even for a step with a validation error.
- **File-size context**: `wc -l frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` → 571
  lines already, against `CONTRIBUTING.md:24`'s ~400-line soft budget / "if a file you're editing
  crosses ~400 lines, propose a split in the PR description rather than adding to it" and the
  file's own header comment citing a "400L hard cap" it's already past.

### Verdict: REFUTE

### Change Requests

1. **(Blocking) The persistent-open-preference mechanism (Decision 3, Tasks 2.2/2.3) does not
   deliver the delta spec's own declared scenario, and needs a different mechanism specified.**
   - The spec's scenario "Preview open state persists as a user preference" requires: *"the user
     opens the preview on one step card and later expands another step card (or reloads the
     editor) → the preview auto-opens on the newly expanded card."*
   - Ground truth: `PipelineRiverView.tsx:93-102` mounts **every** `StepCard` unconditionally in
     `steps.map(...)` — only the card *body* is gated by `expanded &&` inside `StepCard.tsx:163`.
     The card component itself (and all its hooks, including `previewOpen`'s state) mounts once,
     at initial steps-load, regardless of whether it is ever expanded.
   - Task 2.3 specifies `previewOpen`'s default is read via a **lazy `useState` initializer**
     ("read in a lazy useState initializer ... write on every toggle"). Per React semantics, a
     lazy initializer runs exactly once, at that component instance's mount.
   - Trace the exact scenario the spec requires: page loads → N `StepCard`s mount together, each
     reading `previewOpen` from `localStorage` at that same moment (say, `false`, nothing stored
     yet). User expands card 1, clicks "Preview data" → card 1's local `previewOpen` becomes
     `true` and `localStorage["helio-step-preview-open"]` is written `true`. User now expands
     **card 2** — but card 2 was already mounted, at page load, with its `previewOpen` fixed to
     the value read *before* card 1's toggle happened. Nothing re-reads `localStorage` for card 2;
     its state is a `useState` value baked in at mount. Card 2's preview does **not** auto-open —
     directly contradicting the spec's own scenario and Decision 3's stated semantics ("expanding
     any card auto-opens its preview once the user has opted in").
   - This only actually works for the two cases the design happens to also mention ("reloads the
     editor" — full remount, correct) and for steps added *after* the toggle (fresh mount, also
     correct) — but the primary, most common case in the scenario text (toggling on one already-
     rendered card, then expanding a sibling already-rendered card, same session, no reload) will
     fail as specified.
   - **Required revision**: specify a mechanism where an already-mounted sibling card observes a
     preference change made elsewhere in the same session — e.g. (a) re-read/re-sync
     `previewOpen` from `localStorage` at the moment a card transitions collapsed→expanded (in the
     header-click handler, not only at mount), or (b) lift the shared default into state visible
     to all sibling `StepCard` instances (a small custom hook with a subscriber list, a
     `storage`-event listener, a Context, or a `PipelineDetailPage`/`PipelineRiverView`-owned piece
     of state passed as a prop) so a toggle in one card updates the default read by every other
     mounted card immediately. Task 3.3's described test ("stored `true` auto-opens preview on
     expand") as currently scoped (mount a single `StepCard` fresh with `localStorage` pre-set)
     would not catch this defect — the test plan should be revised to also cover the cross-card,
     same-session case the spec scenario describes.

### Non-blocking notes

- `design.md` Decision 3 attributes the "try/catch guard" specifically to the `theme.ts`
  precedent, but `theme.ts:55-71`'s `getInitialTheme`/`getInitialAccentColor` do not actually wrap
  `localStorage.getItem` in try/catch (only a `typeof window === "undefined"` guard). Adding a
  try/catch is still reasonable defensive practice; just flagging the citation is inaccurate as
  written so the executor doesn't go looking for try/catch code in `theme.ts` that isn't there.
- `PipelineDetailPage.tsx` is already 571 lines, well past both `CONTRIBUTING.md`'s ~400-line soft
  budget and the file's own header comment's "400L hard cap." Task 1.1 adds another helper
  (`getAnalyzeOutputSchema`) to this file without acknowledging the size. Not blocking per
  `CONTRIBUTING.md` (additions are allowed if the PR description proposes a split), but the
  executor should call this out in the PR description rather than silently growing the file
  further.
- Task 2.2's single effect conflates two different trigger semantics — immediate fetch "on
  activation" vs. 500ms-debounced re-fetch "on config-fingerprint change while active." The design
  doesn't spell out how an implementer distinguishes "this firing is the initial activation" from
  "this firing is a subsequent config change" (e.g., a ref tracking whether a fetch has already
  happened since the card was last activated). Not ambiguous enough to block on its own, but worth
  a sentence in `design.md` so the executor doesn't need to invent the distinguishing mechanism
  from scratch.
