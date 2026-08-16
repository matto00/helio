## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

Checked against `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and the
`pipeline-step-preview` delta spec:

- All 5 ticket acceptance criteria addressed explicitly: inline rows (≤10) + output
  schema (`StepCard.tsx:407-424`); debounced refresh-on-edit
  (`StepCard.tsx:119-159`, 500ms); loading/error reuse (`StepCard.tsx:425-433`);
  `DESIGN.md` tokens used in the new CSS (see Phase 2); tests cover rows+schema
  rendering and refresh-on-edit (`StepCard.test.tsx`).
- All 7 delta-spec scenarios verified against the implementation and reproduced live
  in-browser (see Phase 3): rows+schema together, schema omitted when analyze data
  unavailable, refresh-after-settle, no refresh when closed, cross-card/reload
  persistence, loading text, error text, second-toggle-hides.
- No AC silently reinterpreted; no scope creep — diff touches only
  `StepCard.tsx`, `PipelineRiverView.tsx`, `PipelineDetailPage.{tsx,css,test.tsx}`,
  the new `StepCard.test.tsx`, and `openspec/` planning docs.
- No regressions: full Jest suite (175 suites / 1754 tests) passes unchanged; the
  four pre-existing `PipelineDetailPage` "step preview" integration tests pass
  unmodified against the new effect-driven fetch path, confirming behavior
  preservation of the pre-existing toggle/loading/error flows.
- No backend/schema change — correctly out of scope per ticket ("Backward
  compatible: no wire/enum change"); confirmed `git diff --name-only main...HEAD`
  touches only `frontend/**` and `openspec/**`.
- Planning artifacts (proposal/design/tasks/spec delta) accurately reflect the
  final implemented behavior; the design's Decision 2/3 mechanisms
  (fingerprint-ref debounce, re-sync-on-expand) are implemented exactly as
  specified.
- `PipelineDetailPage.tsx`'s pre-existing over-400-line status and `StepCard.tsx`
  crossing 400 lines within this change are correctly flagged in
  `files-modified.md` for the PR description, per `CONTRIBUTING.md`'s "propose a
  split" guidance (informational-only per the Pre-Commit Policy section, not a
  blocking gate).

### Phase 2: Code Review — PASS

Issues: none blocking.

**Gates re-run independently in `WORKTREE_PATH` (frontend-only diff):**
- `npm run lint` — clean, 0 errors/warnings.
- `npm run format:check` — clean.
- `npm test` — 175 suites / 1754 tests passed (matches executor's report).
- `npm --prefix frontend run build` — succeeds (pre-existing >500kB chunk warning,
  unrelated to this change).

**Standards review** (`CONTRIBUTING.md`, `DESIGN.md`):
- Imports/qualifiers: clean, no inline FQNs, all imports at top of file.
- Type safety: no `any`; `err: unknown` narrowed via `instanceof Error`
  (`StepCard.tsx:132-134`); `SchemaField[]` typed prop threaded consistently.
- DRY: `getAnalyzeOutputSchema` is a deliberate, documented mirror of
  `getAnalyzeSchema` (design's stated pattern); reuses `DataGrid`
  `variant="preview"`, existing `fetchStepPreview` service, existing
  loading/error state shapes. No shared "Chip" component exists in
  `frontend/src/shared/ui/` to reuse for the new schema-chip strip — hand-rolled
  chips are the established convention for this feature (see the pre-existing
  diff-chip block, `StepCard.tsx:374-384`).
- Readable/modular: effect-driven fetch, fingerprint-ref debounce logic, and
  localStorage read/write are each isolated into small, well-commented units;
  naming is clear (`lastFetchedFingerprint`, `PREVIEW_REFRESH_DEBOUNCE_MS`).
- Error handling: preview fetch errors caught, surfaced via `role="alert"`;
  storage access try/catch-guarded with a documented fallback.
- Tests meaningful: `StepCard.test.tsx` (12 tests) directly exercises the new
  behavior with fake timers for the debounce, mocked `fetchStepPreview`, and
  real localStorage — these would catch a real regression in any of the ticket's
  five acceptance criteria. Confirmed by independently re-running them.
- No dead code, no leftover TODO/FIXME, no over-engineering (the fingerprint-ref
  + lazy-init + resync-on-expand mechanism is the minimum needed to satisfy the
  spec's cross-card persistence scenario, as design.md's Decision 3 argues).
- `DESIGN.md` token usage: the new CSS
  (`PipelineDetailPage.css:485-505`) uses `--space-1/2`, `--app-radius-sm`,
  `--app-surface-soft`, `--app-border-subtle`, `--app-text`, `--app-text-muted`,
  `--font-mono`, `--text-xs` throughout — no hardcoded colors or fonts.

**Non-blocking note** (see below) on one literal spacing value in the new CSS.

### Phase 3: UI Review — PASS

Issues: none.

Started servers via `scripts/concertino/start-servers.sh` on this run's assigned
ports (dev 5836 / backend 8743), `assert-phase.sh servers` returned `PASS`.
Verified live in-browser against the `HEL-454 eval smoke` pipeline's Assert step:

- **Happy path**: expanding the step card and clicking "Preview data" renders the
  output-schema chip strip (`id: string`, `amount: string`) together with the
  sample-rows `DataGrid` below the config editor, inline inside the expanded card
  body — matches the "rows + schema together" scenario exactly.
- **Refresh-on-edit**: changing the assert rule's field (`id` → `amount`) fired the
  expected sequence — `PATCH /api/pipeline-steps/:id` → re-fetched
  `GET .../analyze` → debounced re-fetch of `GET .../steps/:id/preview` — and the
  rendered rows/grid updated after settling, with no full pipeline run.
- **Persistence**: toggling "Hide preview" wrote `"false"` to
  `localStorage["helio-step-preview-open"]`; setting the key to `"true"` and
  reloading the page auto-opened the preview immediately on expanding the step
  card (button read "Hide preview" with no manual toggle needed) — matches the
  "preview open state persists" scenario.
- **No console errors** introduced by any tested flow. The one console error
  present throughout (`GET .../schedule → 404`) is pre-existing, unrelated
  "no schedule set" behavior — not touched by this diff and not a regression.
- **Breakpoints** 1440 / 1100 / 768 / 430 all render the expanded step card, the
  schema-chip strip, and the preview rows grid without layout breakage,
  overlap, or clipping.
- **Accessible names / keyboard**: "Preview data"/"Hide preview" toggle and the
  step-card header both use native `<button>` elements with `aria-expanded` and
  visible text — standard keyboard activation applies.
- Loading/error states were not separately re-triggered live (would require an
  induced network failure); relied on the passing `StepCard.test.tsx` cases that
  directly assert `"Loading preview…"` and `role="alert"` rendering, combined
  with reading the corresponding try/catch/finally implementation
  (`StepCard.tsx:126-138`) — code and test evidence agree.

Servers were stopped after verification; ports 5836/8743 confirmed free. No
stray screenshot artifacts left in the repo (cleaned up after use).

### Overall: PASS

### Non-blocking Suggestions

- `frontend/src/features/pipelines/ui/PipelineDetailPage.css:496` — the new
  `.pipeline-detail-page__step-preview-schema-chip` rule uses
  `padding: 2px 7px;`. Per `DESIGN.md` §3 ("All margin/padding/gap use a
  `--space-*` token; small optical tweaks ≤ 4px may be literal"), the `7px`
  value doesn't map to a spacing token (nearest are `--space-1`=4px /
  `--space-2`=8px) and isn't itself ≤4px. This is a literal, mechanical
  deviation — but it is a byte-identical copy of the pre-existing sibling chip
  recipe already in the same file (`PipelineDetailPage.css:422`, the diff-chip
  block) and repeated at 6+ other sites across the pipelines feature
  (`PipelineScheduleBar.css:75`, `RunHistoryModal.css:43/76`,
  `PipelinesPage.css:136`, `PipelineDetailPage.css:67/127/555/568/586/694/955`).
  Given the ticket's scope and `CONTRIBUTING.md`'s "avoid unrelated refactors"
  guidance, fixing only this one new instance would create inconsistency with
  its immediate sibling rather than resolve the drift. Worth a follow-up ticket
  to either ratify a token-compliant "compact chip" padding recipe in
  `DESIGN.md` or replace all `2px Npx` chip instances codebase-wide — not a
  blocker for this ticket.
