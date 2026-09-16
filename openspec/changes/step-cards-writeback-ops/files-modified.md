## Files modified (HEL-1109)

Resolved base: `b590855d5f2ddc76c9abf2e75fca5e5120cd5d7a` via `scripts/concertino/resolve-review-base.sh`.

### Types & op registration

- `frontend/src/features/pipelines/types/pipelineStep.ts` — added `ConvertFormatConfig`,
  `AnalyzeWithAiConfig`, `GenerateTextConfig`, `OutputSchemaField` and their step/analyze-step
  union variants; compile-time assignability assertion that `PipelineStepKind` admits the three
  new kinds.
- `frontend/src/features/pipelines/state/stepNarrowing.ts` — three `OP_TYPES` entries, three
  `defaultConfigFor` arms (`convertformat` seeds `{ field: "" }` with `from`/`to` deliberately
  absent), narrowing helpers (`convertFormatConfigOf`/`analyzeWithAiConfigOf`/
  `generateTextConfigOf`), `SUPPORTED_CONVERT_FORMAT_PAIRS`, `OUTPUT_SCHEMA_FIELD_TYPES`,
  `MAX_OUTPUT_SCHEMA_ENTRIES`, `requiresCompleteConfigForCreate`, `isAiStepKind`,
  `isCompleteAiStepConfig`.
- `frontend/src/features/pipelines/state/stepNarrowing.test.ts` — unit coverage for all the
  above, plus the OP_TYPES-vs-backend-registry drift guard (parses `PipelineStep.Registry` and
  each step file's `val Kind`; proven failable per [C2] by mutating the parsed source, not a
  hardcoded twin). Also surfaced a **pre-existing, out-of-scope gap**: `groupby` is registered
  backend-side but absent from `OP_TYPES` (like `join`, but undocumented) — flagged as a spinoff
  candidate below, not fixed here.

### Step card editors (new files)

- `frontend/src/features/pipelines/ui/stepConfigs/ConvertFormatConfig.tsx` (+`.test.tsx`) —
  single four-option conversion `Select`, `string-body` field picker, in-place-overwrite
  disclosure, legacy-pair preservation.
- `frontend/src/features/pipelines/ui/stepConfigs/AnalyzeWithAiConfig.tsx` (+`.test.tsx`) —
  input picker, instruction `Textarea`, ordered `outputSchema` row editor (add/remove/move-up/
  move-down, capped at 50), inline validation (empty/duplicate/collision/empty-schema).
- `frontend/src/features/pipelines/ui/stepConfigs/GenerateTextConfig.tsx` (+`.test.tsx`) —
  input picker, instruction, never-prefilled `outputField`, required-field errors,
  existing-column overwrite disclosure.
- `frontend/src/features/pipelines/ui/stepConfigs/AiStepCostDisclosure.tsx` — shared per-row
  cost/no-auto-run/shared-budget disclosure for both AI cards; `estimatedRows`, when present, is
  labelled as the pipeline's row count, never this step's call count.

### Wiring

- `frontend/src/features/pipelines/ui/StepOpEditor.tsx` — dispatches to the three new cards;
  threads `estimatedRows`.
- `frontend/src/features/pipelines/hooks/useStepCardState.ts` (+`.test.ts`) — state/change
  handlers for the three new configs; **the not-yet-real-id guard in `persist`** (task 3.1,
  matches exactly `^step-\d+$`, not a loose `startsWith`, so semantic test-fixture ids like
  `"step-rename-1"` are never mistaken for a draft); `emitOrPersist` routes a draft's edit
  straight to `onConfigChange` (no PATCH attempt) instead of through `persist`.
- `frontend/src/features/pipelines/ui/StepCard.tsx` (+`.test.tsx`) — renders the
  `StatusChip intent="neutral" dashed` "Draft — not yet saved" affordance for a temp-id step;
  renders a rejected draft-create's message via `InlineError`; threads `estimatedRows`/
  `draftError`. Existing test fixtures using `"step-1"` as if it were a real persisted id were
  renamed to `"persisted-step-1"` (see rationale comment in the test file) — this is a
  pre-existing test-data ambiguity this ticket's mandated guard exposed, not new drift.
- `frontend/src/features/pipelines/ui/PipelineRiverView.tsx`,
  `frontend/src/features/pipelines/ui/LaneColumn.tsx`,
  `frontend/src/features/pipelines/ui/RootColumn.tsx` — thread `estimatedRows`/
  `draftCreateErrors` down to every `StepCard` call site (top-level, lane, and root-column
  paths).
- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` (+`PipelineDetailPage.test.tsx`
  additions) — the deferred-create flow: `pendingDraftMetaRef`/`creatingDraftIdsRef` track a
  draft's intended create parameters; `handleInsertStep`/`handleAddLaneStep` skip the immediate
  POST for `requiresCompleteConfigForCreate` kinds; `handleStepConfigChange` fires the create
  exactly once when the draft's config first satisfies `isCompleteAiStepConfig`, replaces the
  temp step with the persisted one on success, and records a rejection in `draftCreateErrors`
  (retried on the next completing edit) on failure. `stepsFingerprint` excludes any pending
  draft so it never affects the debounced re-analyze dispatch (task 3.6). Added
  `getDraftFallbackSchema`: a draft has no analyze entry of its own (never sent to `/analyze`),
  so its field pickers fall back to the nearest earlier step's output schema (or the first
  root's source schema for a first-ever step) — otherwise the draft's own field picker would be
  permanently empty, since nothing can complete a config it can't populate.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — threads `estimatedRows` from the
  hook to `PipelineRiverView`.

### Housekeeping

- `frontend/src/theme/tokenAuditSweep.css.test.ts` — updated four line-pinned baseline entries
  for `PipelineDetailPage.css` (983→988, 1046→1051, 1255→1260, 1486→1491) after the new CSS
  rules shifted every line below the insertion point.

## Root cause / probe records (systematic-debugging.md)

1. **Root cause:** `useStepCardState.persist`'s new not-yet-real-id guard used a loose
   `startsWith("step-")` check, which also matches semantic test-fixture ids like
   `"step-rename-1"`/`"step-1"` used across `useStepCardState.test.ts`, `StepCard.test.tsx`, and
   `PipelineDetailPage.test.tsx` as if they were real persisted ids.
   **Probe:** `npx jest --testPathPatterns="features/pipelines"` → 43 failures, all either
   "PATCH never fired" or "role query returned an unexpectedly-still-collapsed/chip-bearing
   card".
   **Probe output:** failures concentrated in exactly the suites whose fixtures used a
   `step-<number>` id for a step meant to represent an already-persisted row.
   **Fix:** tightened the guard (and the two other sites needing the same check: the draft-chip
   predicate in `StepCard.tsx`, `emitOrPersist` in `useStepCardState.ts`) to the exact
   `^step-\d+$` shape `makeStep` actually mints, and renamed the colliding test fixtures to
   `persisted-step-1`/`persisted-step-2` with an explanatory comment. Re-ran the full suite:
   932/932 pipelines tests passing, 3429/3429 full frontend suite passing.

2. **Root cause:** a draft AI step is deliberately excluded from the analyze fingerprint (task
   3.6), so it never gets an entry in `analyzeByStepId` — its field pickers (`inputField`) would
   therefore always show zero options, since nothing ever populates the very schema the user
   needs to complete the draft in the first place.
   **Probe:** a live `PipelineDetailPage.test.tsx` test driving a `generatetext` draft to
   completion via `chooseSelectOption` failed with "no options in the input-field combobox".
   **Probe output:** `screen.debug()` confirmed the rendered `<Select>` had zero `<option>`
   elements even though the analyze response's `sourceSchemas` carried a field.
   **Fix:** added `getDraftFallbackSchema` in `usePipelineDetailPage.ts` — walks backward
   through the local `steps` array to the nearest step with a real analyze entry (its output
   schema), or falls back to the first root's source schema for a first-ever step. Re-ran the
   targeted test: passes; full suite unaffected.

## Cycle 2 (evaluation-1.md change requests)

- **CR1 (blocking).** `StepCard.tsx` now suppresses `StepSchemaDiffChips` entirely for a draft
  step (`isDraft`, using the new `isTempStepId`) instead of rendering it with a populated
  fallback `input` against an always-empty `output` — the false "124 columns removed" defect.
  Test: `StepCard.test.tsx` asserts zero `--removed` chips for a draft with a 124-field fallback
  input schema.
- **CR2.** `usePipelineDetailPage.ts`'s `getDraftFallbackSchema` now resolves a LANE draft from
  its exact anchor (`pendingDraftMetaRef`'s `parentStepId`) via `analyzeByStepId`, never a flat
  array walk; a TRUNK draft keeps the backward walk. Both paths' last resort now matches the
  owning root by `meta.rootId` rather than unconditionally `sourceSchemas[0]`
  (`handleAddLaneStep` now records the anchor's own `rootId` in the draft's meta). Added the
  "A draft's field picker offers the schema flowing into its actual anchor" requirement to
  `specs/pipeline-ai-step-authoring/spec.md` (four scenarios). Tests added in
  `PipelineDetailPage.test.tsx`: a trunk draft after a persisted step (nearest-earlier-step
  walk, previously untested), and a lane draft resolving from its own anchor rather than an
  unrelated later trunk step.
- **CR3.** Exported `isTempStepId` from `stepNarrowing.ts` (beside `makeStep`) as the single
  source of truth for the `^step-\d+$` temp-id shape; replaced all six inline predicates
  (`useStepCardState.ts` ×2, `StepCard.tsx` ×1, `usePipelineDetailPage.ts` ×3 — the three
  pre-existing loose `startsWith("step-")` sites too).
- **CR4 — closed all four claimed-but-missing verifications** (none were unmarked; each now has
  the mandated test):
  - 3.1: `useStepCardState.test.ts` — new "not-yet-real-id guard" describe block asserting a
    `step-<n>` id does NOT PATCH, a real id still does, and a semantic fixture id like
    `step-rename-1` is not mistaken for a temp id.
  - 3.8: `ConvertFormatConfig.test.tsx` — asserts the AI cost/quota disclosure copy is absent.
  - 4.3: new `addPipelineStepConfigParity.test.tsx` — asserts each op's card-authored config has
    exactly the key set `add_pipeline_step`'s tool description documents (quoted inline),
    including `outputSchema` element order for `analyzewithai`.
  - 4.4: `AnalyzeWithAiConfig.test.tsx` — a keyboard-operability test for the move-up control
    (native-button/focusable/not-disabled preconditions plus `keyDown`/`keyUp` around the
    activation, documented as the honest two-step proxy for browser-native Enter/Space
    activation since `@testing-library/user-event` is not a dependency here) and a
    boundary-disabled assertion for the last row's move-down control.
- Non-blocking: fixed `tokenAuditSweep.css.test.ts`'s comment ("by 6" → "by 5", the actual net
  shift).
- Hygiene: did **not** touch `hel1109-*.png` (repo root, under `~`) or
  `evidence-hel1109/` (worktree) — no owner approval to delete/move them. Committed by explicit
  path list, never `git add -A`.

## Cycle 3 (skeptic-final-1.md change requests)

- **CR1 (blocking).** `AnalyzeWithAiConfig.tsx`: an empty declared output-field name was
  previously unreachable by either per-row check (both gated on `trimmedName !== ""`), so a
  blank row looked fully configured and could never save, with no feedback of any kind. Added a
  per-row "Output field name is required" inline error, plus `aria-invalid`/`aria-describedby`
  wiring on the name `TextField` so the failure is conveyed non-visually too. Tests added
  (positive and negative case).
- **CR2.** Added the missing empty-declared-name test alongside CR1 (not a task reword) —
  `tasks.md` 2.4's claim is now true.
- **New standing constraint C3** added to `tasks.md`: a task may be marked `[x]` only when its
  mandated verification exists AND discriminates the defect it targets. Re-checked every `[x]`
  in `tasks.md` against it; updated 4.4's wording to match the (now keyDown/keyUp-free) test it
  actually describes — no other task needed correction.
- **Closed both previously-non-blocking test-strength gaps** rather than gambling on a second
  cold skeptic weighing them differently:
  - Extracted `resolveDraftFallbackSchema` as a pure, exported function in `stepNarrowing.ts`
    (the hook's `getDraftFallbackSchema` now just wires in its own closures). This makes the
    scenario-2 (lane-anchor) test genuinely discriminating: a live "+lane" click can never
    actually produce a state where array position and the true anchor disagree
    (`handleAddLaneStep`'s own `anchorIndex + 1` insertion guarantees adjacency), so only a test
    that controls `steps` order and `meta.parentStepId` independently — which the extracted
    function's explicit parameters allow — can force real divergence. Four new unit tests in
    `stepNarrowing.test.ts`: lane-anchor (discriminating), trunk nearest-earlier-step walk,
    multi-root fallback (scenario 4, previously untested), and a lane draft whose anchor itself
    has no analyze entry yet, matching by the anchor's own root.
- Deleted the decorative `fireEvent.keyDown`/`keyUp` bracketing the synthetic click in the
  keyboard-operability test — they exercised nothing.
- Left alone, per explicit instruction: the `groupby` `KNOWN_UNLISTED_KINDS` Linear-ticket gap
  and `helio-mcp/src/tools/write.ts`'s "named 400" vs. actual 422 documentation — both routed to
  delivery triage by the driver.

## Known gap — NOT completed (task 4.6)

**Visual cohesion review (both themes, real breakpoints) was not performed.** This requires a
live dev+backend server pair and rendered/screenshot comparison per DESIGN.md's own standard
("verification for all of the above is by rendered/sampled pixels, never by reading CSS
source"), which this run did not attempt — flagging this honestly per
`verification-before-completion.md` rather than claiming a check that didn't happen. The three
cards reuse only existing `pipeline-detail-page__*` classes and tokens (no new CSS beyond three
selector additions to an existing flex-column rule), which is the best evidence available from
source alone; a live visual pass is recommended before merge.

## Spinoff candidate (not fixed here, out of ticket scope)

`groupby` is registered in the backend's `PipelineStep.Registry` but has no `OP_TYPES` entry and
no config editor — a real, pre-existing gap the new drift guard (task 4.1) surfaced. Its
functionality appears superseded by `aggregate` (already in `OP_TYPES`), so the likely fix is
either removing `GroupByStep` from the backend registry or building a fifth-generation-old
editor nobody has asked for — a genuine product decision, not something this ticket's three new
ops should silently absorb.

## Explicit path declarations (companion test/CSS files)

The prose above names several companion files in a `(+`.test.tsx`)` shorthand that
`squash-branch.sh`'s declaration parser cannot resolve — a declaration must be a backtick span
at the START of a bulleted line, or a trailing-comma continuation chain. These are the same
files the sections above describe, declared here in the accepted format. No new work, no new
scope; this section exists only so the squash guard's allowlist matches the real staged set.

- `frontend/src/features/pipelines/hooks/useStepCardState.test.ts`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx`
- `frontend/src/features/pipelines/ui/StepCard.test.tsx`
- `frontend/src/features/pipelines/ui/stepConfigs/AnalyzeWithAiConfig.test.tsx`
- `frontend/src/features/pipelines/ui/stepConfigs/ConvertFormatConfig.test.tsx`
- `frontend/src/features/pipelines/ui/stepConfigs/GenerateTextConfig.test.tsx`
- `frontend/src/features/pipelines/ui/stepConfigs/addPipelineStepConfigParity.test.tsx`
