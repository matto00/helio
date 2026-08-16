# Tasks: inline-step-output-preview

## 1. Frontend — thread output schema

- [x] 1.1 Add `getAnalyzeOutputSchema(stepId): SchemaField[]` helper in `PipelineDetailPage.tsx` (mirror of `getAnalyzeSchema`, reading `outputSchema`) and pass it into `PipelineRiverView`
- [x] 1.2 Accept and forward the helper in `PipelineRiverView.tsx`; pass `analyzeOutputSchema={getAnalyzeOutputSchema(step.id)}` to each `StepCard`

## 2. Frontend — StepCard inline preview

- [x] 2.1 Add `analyzeOutputSchema: SchemaField[]` prop to `StepCard.tsx`
- [x] 2.2 Replace click-handler fetch with an effect-driven fetch: immediate fetch on preview activation (`expanded && previewOpen`, tracked via a `lastFetchedFingerprint` ref that resets to null on deactivation); 500ms-debounced re-fetch on `JSON.stringify(step.config)` fingerprint change while active; toggle button only flips `previewOpen`
- [x] 2.3 Persist `previewOpen` via localStorage key `"helio-step-preview-open"`: lazy initializer for the mount-time default, re-sync from localStorage on every collapsed→expanded transition (header-click handler), write on every preview toggle; try/catch-guard storage access (our hardening — not in `theme.ts`)
- [x] 2.4 Render "Output schema" chip strip (name + muted type, per `DESIGN.md`) inside the preview tray above the rows grid; omit when `analyzeOutputSchema` is empty
- [x] 2.5 Add the new `pipeline-detail-page__step-preview-*` CSS for the schema strip in the page stylesheet

## 3. Tests

- [x] 3.1 Create `StepCard.test.tsx`: rows + schema render together; schema strip omitted when `analyzeOutputSchema` empty; loading and error states
- [x] 3.2 Refresh-on-edit: config change while preview open triggers exactly one debounced re-fetch (fake timers); closed preview never fetches on config change
- [x] 3.3 localStorage preference: stored `true` auto-opens preview on expand; hiding writes `false`; absent/invalid stored value defaults closed
- [x] 3.4 Cross-card same-session preference: render two StepCards, open preview on card 1, then expand card 2 — its preview auto-opens (re-sync-on-expand, not mount-time-only read)
- [x] 3.5 Record in `files-modified.md`: `PipelineDetailPage.tsx` is past the 400-line budget — PR description must propose a split per `CONTRIBUTING.md`
- [x] 3.6 Run gates: `npm run lint`, `npm run format:check`, `npm test` (frontend) — all clean
