## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: a59bd053ee34a5eed6c4107f808579be79219d30. The diff base was resolved live: 46ab3251e0677951520fe948f21bc9f716fc9369.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/draft-structural-operations/HEL-1684`.

### Fresh gate runs (mine, in WORKTREE_PATH)
- `npm run lint`: exit 0. `npm run format:check`: clean. `npm run typecheck`: exit 0.
- `npm test`: root 66 suites / 579 tests, frontend 774 suites / 9515 tests, all passing (jest maxWorkers 3).
- `npm --prefix frontend run build`: exit 0.
- `node_modules` against the lockfiles: only optional platform packages (`@img/sharp-*`) differ, so `npm ci` was not needed.
- e2e: `DEV_PORT=7116 BACKEND_PORT=10023`, 2 workers, `e2e/hel1684-draft-structural.spec.ts` plus `e2e/hel1631-draft-mode.spec.ts` gave **36 passed** (26 + 10). Before running, I confirmed that the reused servers' cwd is this worktree and that Vite serves the new `draftOps.ts`.

### Phase 1: Spec Review — FAIL
- ACs:
  - Add, insert, duplicate, "+ lane" and reorder (Move up/down, drag) are draft entries on desktop and phone. They are applied by one `draft/save` or dropped by Discard.
  - Kept-draft v2, v1 restore and the stale-base path are present.
  - Roots, shapes and Outputs stay blocked, matching the owner ruling `split-as-proposed`.
- **Server-primitive mirroring.** I checked each applier in `state/draftOps.ts` against the Scala:
  - insert/duplicate → `spliceInsertReportingInternal` (`PipelineStepRepository.scala:699`): the new step is the anchor's sole child at position 0, and the old children move under it with their positions kept.
  - head → the explicit-root variant: only that root's parentless steps move.
  - append → `resolveRootTrunkAnchor(None)` (`PipelineService.scala:414`), which is `trunk.lastOption` followed by a splice.
  - lane → `attachTailInternalAction` (`:810`): `max(maxPos+1, 1)`.
  - reorder → `reorderTrunkAction` (`:906`): exact-set check, trunk relinked at position 0, tails untouched.
  - delete → `deleteInternal` splice.
  - Each matches. I also confirmed one live: a draft "+ lane" off Sort plus a Move down on Filter saved as `sort(root, pos0) → limit(parent sort, pos1)`, `filter(parent sort, pos0) → compute`, and the selection moved to the saved id. That is exactly what the server primitives produce.
- **Save never sends a reduced tree.** `usePipelineDraftSave.ts:307-312` replays over the freshly read steps and returns with the `dropped` notice when `replay.dropped > 0`. The code is correct, but the planned test is missing (see CR2).
- **v1 restore.** `keptDraft.ts` maps `deleted[]` to delete ops. It is covered by unit tests and by the e2e `[guard]` test, which passed in my run.
- **Tasks.** Each task is marked done, but two claims do not hold:
  - task 2.6 / D1a lists "`post()` with a dropping replay sends nothing" as a unit test, and that test does not exist (CR2);
  - task 6.2's evidence file is not what it claims to be (CR4).
- **Evidence claims:**
  - **"26/26 green": not shown by the committed evidence.** `evidence/green-run.txt` holds a 4-test `hel1675-shared-hover` run with **2 failures**, not the hel1684 spec. My own run does show 26/26, so the claim is true, but the evidence file is wrong.
  - **"99/99 regression": TRUE.** `evidence/regression-run.txt` ends with `99 passed (6.7m)` across hel1631, hel1632, hel1582, hel1668, hel1685, hel1705, hel1579, hel1007 and hel908.
  - **Red-first: TRUE.** `evidence/red-run.txt` shows 25 failed and 1 passed. Every failure resolves to a `disabled` control with `title="Save or discard your draft first"`. The one pass is the `[guard]` v1 test, which is expected because the old code reads v1.
  - **The [guard] mutation transcript is unverifiable.** `evidence/guard-mutation.txt` is 3 lines: one failing test and "1 failed". It does not say what was mutated (CR4).
  - **The 4.5 gap: confirmed as stated.** The prune/count effect in `usePipelineDraft.ts:98-103` has no hook-level test. This is non-blocking (see the suggestions).
  - **Screenshots exist but are gitignored** (`*.png`). They will not survive cleanup unless persisted.
- **Scope and constraints.** No scope creep. No backend or schema change, and the draft-save schema already accepts `clientId`/`parentClientId`. `workflow-state.md` CONSTRAINTS is `[]`.

### Phase 2: Code Review — FAIL
- **Accessibility / correctness: the enabled "Branch from here" item still carries the block reason.** `frontend/src/features/pipelines/ui/spine/useSpineStepActions.tsx:179-180` sets `disabled: blocked && isTempStepId(step.id)` but still passes `reason` unconditionally. `ActionsMenu` renders `reason` as the item's `title`, and per `shared/chrome/ActionsMenu.tsx:15` that is also its accessible description.
  - I reproduced it live with a draft open. The menu showed `Branch from here|disabled=false|title=Save or discard your draft first`.
  - Users and screen readers are told to save first on an action that works (CR1).
- **Tests meaningful:**
  - The `post()` refusal has no test. A mutation that deletes `usePipelineDraftSave.ts:308-311` passes every existing test (CR2).
  - The e2e "+ lane step" case cannot tell a lane from an insert. Both give titles `[Filter, Limit, Sort, Compute]`, and the body is checked only for clientId count and length (`e2e/hel1684-draft-structural.spec.ts:368-373`). So a routing regression that sends Branch to `insertStep` would pass end to end. This is the design's own "[Emulation drift] → e2e" mitigation, and it is blind exactly here (CR3).
- **E2e readiness:**
  - Waits use real signals: the loaded row count `Step 1: Filter rows, 14 rows`, `aria-current`, the `Saved.`/`Undone.` toasts, and `.spine-row` titles, which are real rows and not skeleton markup.
  - The negative "no request" checks use fixed `waitForTimeout(800/1200)` windows. That is acceptable for an absence check.
- **Other checks:**
  - Type safety is fine. The `as unknown as DraftOp` casts in `keptDraft.ts` follow a field-by-field validation.
  - No dead code, no TODOs, and no over-engineering.
  - Design [mechanical]: no new styles or tokens. Controls reuse the existing spine and menu components.
- **File size (soft budget, CONTRIBUTING.md:24).** `usePipelineDetailPage.ts` went from 513 to 562 lines and `usePipelineDraftSave.ts` is 433 lines, both over ~400. A split should be proposed in the PR body (non-blocking).

### Phase 3: UI Review — PASS (with CR1 counted under Phase 2)
I checked the running app on this worktree's servers.
- **Happy path:**
  - Desktop "+ lane": recorded in the draft; the only request was `/api/pipeline-step-catalog`.
  - Desktop Move down: no request.
  - Save & run: one `draft/save`, then the server structure was correct.
  - Desktop append (light): the new step shows only its draft count.
  - Phone duplicate from the sheet: the sheet follows the copy, and the copy holds the draft-edited config (320).
- **Discard on phone:** zero `/api` requests, and the saved tree was restored exactly.
- **Per-step fetches:** no request named a `draft-` id at any point, including while a new step was selected.
- **Console:** the only error is `GET /schedule` 404, which is pre-existing (no schedule).
- **Breakpoints:** at 1440, 1100, 768 and 375 there is no horizontal overflow (`scrollWidth == clientWidth`).
- **Cohesion in light and dark, desktop and phone:** the new and lane rows render with the existing spine and lane chrome. Visual judgement is left to the skeptic.
- **Evidence (persisted):**
  - `/home/matt/Development/helio/.concertino/runs/HEL-1684/evidence/openspec/changes/draft-structural-operations/evidence/eval-1-desktop-light-lane-draft.png`. This one is **dark** theme despite its name: the stored theme was dark at capture time.
  - `.../eval-1-desktop-light-append-draft.png` (light)
  - `.../eval-1-phone-light-duplicate-sheet.png`
  - `.../eval-1-phone-light-duplicate-spine.png`
  - `.../eval-1-phone-dark-duplicate-spine.png`
- **Observation:** after Discard with a new step selected, the URL keeps `?step=draft-…` while the selection falls back to step 1 (see the suggestions).

### Overall: FAIL

### Change Requests
1. `frontend/src/features/pipelines/ui/spine/useSpineStepActions.tsx:180`: pass `reason` for "Branch from here" only when the item is disabled (`reason: blocked && isTempStepId(step.id) ? reason : undefined`), so an enabled item has no title and no accessible description.
   - Add an assertion to `PipelineDetailPage.draftMode.test.tsx` (the "what stays blocked" test) that the enabled Branch item has no `title` and no accessible description.
   - Do the same for the enabled Move/Insert items, which already drop `reason`.
2. Add the test planned in task 2.6 / design D1a: `post()` with a dropping replay sends nothing.
   - Setup: a page-level or hook test where the draft holds an insert anchored on step X and the save-time `?definition=true` read returns a definition without X (the base fingerprint mocked to match, so the stale branch is not taken).
   - Assert: no `POST …/draft/save` is made and the `dropped` notice is shown.
   - Confirm it fails when `usePipelineDraftSave.ts:308-311` is removed, and record that in the evidence.
3. `e2e/hel1684-draft-structural.spec.ts`: make the end-to-end check tell the ops apart via the Save & run body.
   - "+ lane": the `clientId` step must have `parentStepId === stepIds[0]` and `position >= 1`, and step 2 must keep `parentStepId === stepIds[0]` at position 0.
   - "insert": the `clientId` step must have `parentStepId === stepIds[0]`, `position === 0`, and step 2 must carry `parentClientId` equal to that clientId.
   - "duplicate": the clone's `parentStepId === stepIds[1]`.
   - Mirror these in the reload check if that is cheap.
4. Fix the evidence files:
   - Replace `openspec/changes/draft-structural-operations/evidence/green-run.txt`, which currently holds a 2-failure hel1675 run, with the actual green transcript of `e2e/hel1684-draft-structural.spec.ts`.
   - Rewrite `evidence/guard-mutation.txt` to state the exact mutation applied (file, line, before → after) beside the failing transcript.
   - Persist the evidence PNGs, which are gitignored, with `persist-evidence.sh`.

### Non-blocking Suggestions
- Task 4.5: add a hook-level test of the prune/count effect (`usePipelineDraft.ts:98-103`). It should cover:
  - a base change that drops an op, which increments `droppedCount` once and prunes the op;
  - a stale-restored draft, which is NOT pruned.
- After Discard (and after an op drop) with a new step selected, clear or replace `?step=draft-…` so the URL does not name a dead client id.
- `applyOp`'s `head`/`append` anchors do not check that the root still exists. A root removed in another tab would place a parentless step under a non-existent root, and the save would 400. Consider refusing when no step of that root exists and the root is unknown, or document that the server 400 is the backstop.
- PR body: propose splitting `usePipelineDetailPage.ts` (562 lines) and `usePipelineDraftSave.ts` (433 lines), per CONTRIBUTING.md:24. Also carry the 7.4 note and the incomplete-config duplicate 400 note from the Planner Notes.
- `withConfig`/`withEnabled` while `staleRestored` call `pruneOverlay`, which silently drops non-applying ops before "Reload" counts them. This is the same class as HEL-1631's behavior. Consider skipping op pruning while stale, to fully honor D1's "not pruned while stale".
