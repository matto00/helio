## Evaluation Report — Cycle 2 (evaluation-2.md)

**What was reviewed:**
- HEAD: `26028b96d963a297d63da2c0fdadb9d0392f4da6`.
- Diff base: `3962e6eb2c09a009259c8f75f2cf1aa4c1fe3526`, resolved live.
- The cycle-2 delta is commit `26028b96d` alone, on top of `85a90496d`, which `evaluation-1.md` reviewed in full.
- Scratch logs are in the session scratchpad with the `hel1345-eval2-` prefix.

### Phase 1: Spec Review — PASS
Issues: none.

- **Spec delta, persistence:** `specs/pipeline-steps-persistence/spec.md` now says ALL of the anchor's existing children move under the new step, tail lanes included. That matches `spliceInsertReportingInternal` with `Some(anchor)` and the scaladoc and schema text.
- **Spec delta, guard:** the guard list now names `position == trunk length` onto a trunk-last step that has tails. This closes the evaluation-1 suggestion.
- **Validation:** `openspec validate rootid-step-create-placement --strict` reports the change as valid.
- **Unchanged since cycle 1:**
  - every AC, constraint (C1–C9) and planned-test-edit finding in evaluation-1;
  - backend placement and lane-check behaviour (cycle 2 only adds an annotation import);
  - the `applyCreatedStep` and hook logic.
- **Committed copy of evaluation-1:** `evaluation-1.md` is committed byte-identical to the report I wrote.

### Phase 2: Code Review — PASS
**CR1 (evaluation-1):** fixed.
- `PipelineService.scala:30` adds `import scala.annotation.tailrec`, and the use site is now `@tailrec`.
- `grep scala.annotation` on that file finds only the import.
- `npm run check:scala-quality` is clean.

**Non-blocking items:** all addressed.
- `CreatedPipelineStepWire` is removed. The single `CreatedPipelineStep` is used for both the `httpClient.post` type and the return type. This is a type-only change, erased at runtime.
- The 20 s bound is now scoped to case (a) only, as the third argument of `it`, with a reason. No `jest.setTimeout` is left in `frontend/src`.
- The retargeted `draftCreate` assertion now pins which card is open: `toggles[0]` (ai-1) is `aria-expanded="true"` and `toggles[1]` (the duplicate) is `"false"`. This is stricter than the old count-based check.

**Gates, run fresh in `WORKTREE_PATH`:**
- `npm run lint`, `npm run format:check` and `npm run typecheck`: exit 0.
- `npm --prefix frontend run build`: exit 0.
- Backend, affected specs: `PipelineStepRootIdPlacementRoutesSpec`, `PipelineStepReparentRoutesSpec` and `PipelineStepRoutesSpec` gave 109 succeeded, 0 failed. This compiled the changed `PipelineService.scala`.
  - I did not re-run the full `sbt testFull`. The only backend change is an import plus an annotation identifier. The full 6051/6051 run in evaluation-1 still covers the logic.
- `npm test`: root 375/375 passed. The first frontend run had 1 failure, 4615/4616:
  - The failure was `PanelCard.test.tsx` "PanelCardBody does not re-render when only unrelated PanelCard state changes" (expected 2, received 3). It came with an `act(...)` warning from `useOutputMeta.ts:37`, an async `setIsLoading`.
  - The diff touches no `features/panels` file (0 files).
  - The suite passed 3 out of 3 times in isolation.
  - A full frontend re-run with `--maxWorkers=2` passed 442 suites and 4616/4616 tests.
  - Conclusion: a timing flake in an untouched suite during a loaded run, not a regression. See the suggestion below.

### Phase 3: UI Review — PASS
- Cycle 2 makes no runtime UI change. The frontend edits are a TypeScript type alias, which is erased, plus two test files.
- The UI evidence from evaluation-1 therefore still applies: e2e seam spec, keyboard gap insert, failure toast, no console errors, and 0 overflow at 1440/1100/768/375.
- Servers: `assert-phase.sh servers` passed. The process cwds are `.../HEL-1345/frontend` (6777) and `.../HEL-1345/backend` (9684), checked with `readlink /proc/<pid>/cwd`. Both servers were left running.
- No users or rows were created this cycle.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `frontend/src/features/panels/ui/PanelCard.test.tsx:625` flaked once under load. The cause is an un-awaited `Promise.resolve().then(setIsLoading)` in `useOutputMeta.ts:37`, which adds a render the test does not expect. This predates the change and is outside its scope; it could be a follow-up ticket.
