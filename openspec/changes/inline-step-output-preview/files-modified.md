# Files Modified: inline-step-output-preview (HEL-404)

- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — added `getAnalyzeOutputSchema(stepId)`
  (mirror of `getAnalyzeSchema`, reading `outputSchema` instead of `inputSchema`) and threaded it into
  `PipelineRiverView` as a new prop.
- `frontend/src/features/pipelines/ui/PipelineRiverView.tsx` — accepts and forwards
  `getAnalyzeOutputSchema`, passing `analyzeOutputSchema={getAnalyzeOutputSchema(step.id)}` to each
  `StepCard`.
- `frontend/src/features/pipelines/ui/StepCard.tsx` — the core of this change:
  - New `analyzeOutputSchema: SchemaField[]` prop, rendered as an "Output schema" chip strip inside the
    preview tray (name + muted type), omitted when empty.
  - Replaced the click-handler fetch with an effect-driven fetch keyed on `expanded && previewOpen`: an
    immediate fetch on activation (tracked via a `lastFetchedFingerprint` ref that resets to `null` on
    deactivation), and a 500ms-debounced re-fetch when `JSON.stringify(step.config)` changes while
    active. The toggle button now only flips `previewOpen`.
  - `previewOpen` now persists via `localStorage` key `"helio-step-preview-open"`: a lazy `useState`
    initializer reads it for the mount-time default, and the header-click expand handler
    (`handleHeaderClick`) re-syncs from storage on every collapsed→expanded transition (not
    mount-time-only), so a preference change made on one card is picked up by a sibling card expanded
    afterward in the same session. Storage access is try/catch-guarded (our own hardening, following but
    extending the `theme.ts` precedent).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — new
  `pipeline-detail-page__step-preview-schema` / `-schema-chip` / `-schema-chip-type` rules for the
  schema strip, using existing `--app-surface-soft`, `--app-border-subtle`, `--app-text`,
  `--app-text-muted`, `--font-mono`, `--text-xs`, `--space-*` tokens (no new hardcoded values).
- `frontend/src/features/pipelines/ui/StepCard.test.tsx` — **new file**. Direct StepCard tests (not
  routed through PipelineDetailPage): rows + schema render together; schema strip omitted when
  `analyzeOutputSchema` is empty; loading and error states; second-toggle hides the preview; debounced
  refresh-on-edit (exactly one re-fetch per settled config change, fake timers); closed preview does not
  refetch on config change; localStorage preference (auto-open when stored `true`, write `false` on
  hide, default closed when absent/invalid); cross-card same-session re-sync-on-expand (task 3.4 — the
  design-gate blocking finding: opening the preview on one card and then expanding a second, previously
  collapsed, sibling card auto-opens the sibling's preview too, proving the sync happens on the
  collapsed→expanded transition and not only at mount).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — added `window.localStorage.clear()`
  to the `"PipelineDetailPage step preview"` `beforeEach` so the new localStorage-backed `previewOpen`
  default doesn't leak state between this file's step-preview tests (same precedent as
  `theme.test.ts` / `ThemeProvider.test.tsx` / `App.test.tsx`). No behavioral assertions changed — the
  four existing integration tests (button triggers fetch, loading state, error state, second-click
  hides) still pass unmodified against the new effect-driven fetch path.

## File-size budget (CONTRIBUTING.md)

- **`PipelineDetailPage.tsx` is now 583 lines**, further past `CONTRIBUTING.md`'s ~400-line soft budget
  (it was already 571 lines — over budget — before this change; task 1.1 added one small mechanical
  helper mirroring three existing siblings). Per `CONTRIBUTING.md` ("If a file you're editing crosses
  ~400 lines, propose a split in the PR description rather than adding to it"), **the PR description
  must propose a split** — e.g. extracting the `getAnalyzeColumns` / `getAnalyzeSchema` /
  `getAnalyzeOutputSchema` / `getAnalyzeValidationError` helper family (and the `analyzeResult`
  selector they close over) into a small `useAnalyzeHelpers(pipelineId)` hook, mirroring the earlier
  `PipelineRiverView` extraction (CS3 cycle 2, see `PipelineRiverView.tsx`'s file header). Not done in
  this change — flagged per the design's Planner Notes, which pre-approved deferring the split rather
  than bundling an unrelated structural refactor into this ticket.
- **`StepCard.tsx` grew from 333 to 440 lines** as a direct result of this change (effect-driven
  fetch + localStorage persistence + schema-strip rendering). This crosses the same ~400-line soft
  budget within this change itself (not pre-existing, unlike `PipelineDetailPage.tsx`). Flagging as a
  spinoff candidate rather than fixing inline: the op-kind config-editor dispatch (the ~120-line
  `step.opType.id === "..."` ladder) is the natural extraction target, structurally identical to the
  `PipelineRiverView` precedent — out of scope for this ticket's behavior-preserving-refactor
  discipline (`CONTRIBUTING.md`'s AI-collaborator guidance: "a structural change is not the place to
  also fix bugs, add features, or improve defaults").

## Verification gates (frontend/**)

- `npm run lint` — clean (0 errors, 0 warnings).
- `npm run format:check` — clean.
- `npm test` — 175 suites / 1754 tests passed (includes the new `StepCard.test.tsx`, 12 tests).
- `npm --prefix frontend run build` — production build succeeds (pre-existing >500kB main-chunk
  warning, unrelated to this change).

No backend change, no Flyway migration, no wire/enum change — schema is derived client-side from the
existing analyze endpoint's per-step `outputSchema`, consistent with the design.
