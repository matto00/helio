## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `5037cdd0bdcd7d657203cf86fa6c2a1236d2fb38`. The base was resolved live with `resolve-review-base.sh` (main/origin, exit 0) as `317284497b44808c410c32b6423a1ad7f5c31826`.

### What I verified (with evidence)

**Diff (ground truth).** `git diff 317284497...HEAD -- frontend`: four `onBlur` lines are removed:
- `ConvertFormatConfig.tsx:120` (Destination field)
- `ComputeFieldConfig.tsx:67` (Output field name)
- `ComputeFieldConfig.tsx:82` (Expression)
- `UpsertSourceConfig.tsx:187` (New source name)

There are also three unit-test edits and a new `StepCard.blurNoRepatch.test.tsx`. Nothing touches the persist hook, the backend or the schema.

**Scope enumeration is complete.** I swept the whole of `frontend/src`, not just the pipelines directory.
- `grep -rn onBlur` (non-test) gives 15 hits. The only step-config text fields that re-emit config are the four above. The others are:
  - `AggregateConfig:252`: local touched-set only.
  - `PipelineDetailFooter:179`: output name edit-mode toggle.
  - `ConditionalFormatsField:219/234`: `onTouch` in the output editor.
  - Panels, sources, dashboards and sidebar: not step config.
- A second grep for `onBlurCapture`, `focusout` and `addEventListener("blur")` finds nothing in step-config editors. The shared `TextField` is imported by step configs but is not the source of any re-emit.

**Behaviour preservation (code read).**
- **Keystroke:** each handler is a pure `onChange({...config, x: value})`. There is no trim or normalisation that only blur applied (`ComputeFieldConfig.tsx:46-52`, `UpsertSourceConfig.tsx:105-107`, `ConvertFormatConfig.tsx:83-85`). So blur re-sent exactly the value the last keystroke had already sent.
- **Draft (temp id):**
  - `persist` returns early for temp ids (`useStepCardPersist.ts`, `isTempStepId` guard), so blur on a compute or upsertsource draft was already a no-op.
  - Convertformat's `emitOrPersist` calls `onConfigChange` synchronously on every change.
  - `requiresCompleteConfigForCreate` covers AI kinds only (`stepNarrowing.ts:192`).
  - I also checked the in-flight-create window, where blur might have re-saved text typed before the real id arrived. A creating card cannot be expanded (`StepCardHeader.tsx:62`, `disabled={isCreating}`), so no field is editable then. A failed-create temp card never PATCHes on any path. No path is stranded.
- **Error:**
  - Compute and convertformat swallow PATCH errors both before and after the change.
  - For upsertsource, the only behaviour lost is the accidental blur retry. The design accepts this and the commit message states it.

**Live probe (my own, independent of the executor's and evaluator's).**
- Setup: worktree servers (6939/9846), and a throwaway user `239d37fe-2027-4398-902c-ca88e367d619` / `hel1507-skeptic-1791869230324@example.test` seeded with the executor's seed script under a new email prefix.
- Driver: Playwright chromium, with every `PATCH /api/pipeline-steps/*` intercepted.
- I added scenarios the executor did not run: a real clipboard Ctrl+V paste, and keystroke-then-Tab. Output, verbatim and abridged:
```
convertformat:Destination field paste-then-blur PATCHes=1 ... "outputField":"pasted_dest" 200
convertformat:Destination field type-then-tab PATCHes=1 ... "outputField":"pasted_destX" 200
convertformat:Destination field focus-blur-noedit PATCHes=0
compute:Output field name paste-then-blur PATCHes=1 ... "column":"pasted_col" 200
compute:Output field name type-then-tab PATCHes=1 ... "column":"pasted_colX" 200
compute:Output field name focus-blur-noedit PATCHes=0
compute:Expression paste-then-blur PATCHes=1 ... "expression":"$amount * 7" 200
compute:Expression type-then-tab PATCHes=1 ... "expression":"$amount * 7X" 422   (invalid expression; expected, silently swallowed as before)
compute:Expression focus-blur-noedit PATCHes=0
upsertsource:New source name paste-then-blur PATCHes=1 ... "name":"pasted_sink" 200
upsertsource:New source name type-then-tab PATCHes=1 ... "name":"pasted_sinkX" 200
upsertsource:New source name focus-blur-noedit PATCHes=0
```
- Every edit, including paste, commits exactly once, and a blur with no edit sends nothing.
- The user was deleted by exact (id, email) via `buildUserDeleteSql` (the executor's `HEL-1507-cleanup.cjs`). A follow-up `SELECT count(*)` on the id or the `hel1507-skeptic-%` email returned `0`.

**Before-fix evidence (AC1).**
- I read the persisted `HEL-1507-probe-before.txt` (main checkout `.concertino/runs/HEL-1507/evidence/.../probe/`). All four fields show 2 byte-identical PATCH bodies for edit-then-blur, and 1 PATCH for a blur with no edit.
- `HEL-1507-probe-after.txt` shows 1 and 0. My own after-probe reproduces this.

**Tests are meaningful and failable.**
- I read the new and changed assertions.
- The StepCard suite drives the real `StepCard`, `useStepCardPersist` and fake-timer debounce with a mocked `updatePipelineStep`. It asserts `toHaveBeenCalledTimes(1)` plus the exact expected config for edit, debounce, blur. It asserts `not.toHaveBeenCalled()` for a blur with no edit.
- With the old `onBlur` present, the second `persist` re-arms and fires a second call, so the test fails (2 vs 1, and 1 vs 0).
- The persisted `HEL-1507-jest-red.txt` shows exactly that: `12 failed, 34 passed`, with the received counts as described, against the pre-fix components.
- `getByRole` throws if the input is not rendered, so a green run also proves the field renders.
- The ComputeFieldConfig "blur calls onChange" test is inverted for both inputs, as AC4 requires.

**Gates (fresh, this HEAD).**
- `npm run lint` exit 0, `npm run format:check` exit 0, `npm run typecheck` exit 0.
- Targeted jest (blurNoRepatch, the three config tests, `useStepCardState.characterization`, the StepCard suites): `Test Suites: 9 passed`, `Tests: 318 passed`, exit 0.
- Full `npm test` (`HELIO_JEST_MAX_WORKERS=3 nice -n 19`): helio-mcp `49 passed / 458 tests`, frontend `579 passed / 6904 tests`, `EXIT=0`. This matches what the evaluator asserted but did not paste.
- `useStepCardState.characterization.test.ts` is unchanged in the diff and passes (AC3).

**Acceptance criteria trace.**
1. Enumeration plus before-probe: `probe-notes.md` table, my independent grep sweep and `probe-before.txt`. Met.
2. Exactly one PATCH after the fix: `probe-after.txt` and my own probe above. Met.
3. Characterization test is unchanged and green. Met.
4. Blur unit tests are inverted or tightened and were red before the fix, plus a StepCard integration test with one `updatePipelineStep` call: the diff and `jest-red.txt`. Met.

**Commit message accuracy.**
- "Removed the onBlur from all four", "12 failures" and the D2 statements all match the code and the red log.
- The upsertsource retry trade-off is stated correctly: a transient failure stays shown until the name is edited, and a 422 fails again anyway.

**UI / design judgment:** not applicable. The change removes an event handler and has no visual or DOM-structure effect, so there were no screenshots to judge. No design-standard surface is touched.

### Verdict: CONFIRM

### Non-blocking notes
- `openspec/changes/step-config-blur-no-repatch/evaluation-1.md` is untracked in the worktree (`git status --short`). The orchestrator should commit it or leave it out deliberately when archiving.
- design.md's Risks asks for the upsertsource retry trade-off in the PR body as well as the commit message. Carry it into the PR description.
- Neither this gate nor the evidence used mtime ordering. All evidence cited is content: diff lines, verbatim probe output and jest counts.
