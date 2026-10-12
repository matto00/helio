## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `567001f48fbbe3ff946bd3cf8d62e8b89beb2148` (branch `task/shared-step-reference-checks/HEL-1515`).
Diff base: `849dd96c936182d4a8c8597c3cbdc92ae39fcb82`, resolved live by `resolve-review-base.sh` (main, origin).

### Phase 1: Spec Review — FAIL

| Check | Result |
|---|---|
| AC1 one shared chain, behaviour-preserving | PASS. `StepReferenceChecks.referenceChecksF` is the only site that orders ownership, lane, pre-upsert and upsert results. All three inline copies are gone, including `duplicateReferenceChecksF`. The existing specs pass unmodified (see Phase 2). The executor's mutation logs (`.concertino/runs/HEL-1515/logs/mut-chain-{a,b,c,d1,d2}.log`) show each of a/b/c red on create, update AND duplicate, d1 red on create only and d2' red on its guard. I read those logs but did not re-run the mutations, because code edits are outside this role. |
| AC2 message pins | PASS. `DuplicateStepReferenceChecksSpec` L147-154 and L173-181 compare duplicate's message to update and create. Both are pinned to the exact `validateLaneReference` literal. The change is additive only. |
| AC3 reproduce first, then fix | PASS on the backend. The repro and fix are recorded (`repro1/2.log`, `mut-m1..m4.log`). The BACKSTOP test proves the stored cyclic graph fails the run with the engine's named error. |
| AC4 hel908-tail-attach | PASS, and the non-repair is justified. Details are in the AC4 section below. |
| No AC silently reinterpreted | **FAIL.** design.md D4 says: "If [the picker offers descendants], the UI surfaces the 400 through its existing save-error path." That premise is false (see CR1). The change ships a write-time rejection that the editor still invites and then swallows. |
| Tasks match the implementation | PASS. All tasks are ticked. Task 1.8 only asked for a report, and the report it produced contradicts D4's assumption without the plan being revised. |
| Scope creep | None. |
| Regressions to other specs | **FAIL.** `openspec/specs/pipeline-lane-rejoin-picker/spec.md` L29-33 says the picker "SHALL render a node the engine would reject as disabled with a visible reason". The backend now rejects dependents at write time, but the picker still offers them as enabled options. L42-49 ("Any node that is not the step itself and not one of its ancestors SHALL be selectable") now contradicts the amended `pipeline-lane-rejoin-input` delta. The change has no delta for the picker spec. |
| API contracts / schemas | N/A. No shape change. The only new status is the conditional 400, and it is documented in the delta. |
| Planning artifacts reflect final behaviour | FAIL. D4's UI assumption is wrong (see above). |
| CONSTRAINTS C1/C2/C3 | C1: honoured in planning. The PR body is not written yet, so the orchestrator must check it at delivery. C2: honoured. The only edits to existing spec files are the AC2 pins, the C3 fixture change, and an additive defaulted `attachAsTail` parameter on `PatchSetUndoServiceFixture.seedPipelineStep`. C3: there is exactly one fixture hit (`PatchSetUndoLaneSpec` L141-147). It is fixture-only, it restores the "SIBLINGS" intent, and no assertion was edited. I independently confirmed it is the only hit: every spec in the repo that seeds a lane-kind secondary input was in my targeted run, and all were green. |

#### AC4: does hel908-tail-attach need a semantic rewrite? (orchestrator point 2)

Yes, so the executor's decision to leave HEL-951/HEL-962 alone is correct under D5.

- The "Add tail step" button and its `menuitem` palette no longer exist. Today every step renders `BranchAffordance` (`frontend/src/features/pipelines/ui/BranchAffordance.tsx` L28-35, accessible name "Branch this step into a new lane, without changing the rest of the pipeline"). `StepPalette` is now a modal `combobox`/`listbox` with `role="option"` items (`StepPalette.tsx` L241-289). Tests 2-4 could probably be fixed by swapping locators.
- Test 1 cannot. Its assertion `getByRole("button", { name: "Add tail step" })).toHaveCount(1)` after a tail is attached encodes "single-tail-per-node enforcement". HEL-912 Decision 1 deliberately removed that gate (`PipelineRiverView.tsx` L76 and L403, `LaneColumn.tsx` L66, `usePipelineLaneStepCreation.ts` L43-48). The Branch affordance now renders on every step, tails included. The faithful translation would assert 3 affordances, not 1. That reverses the assertion, which is a semantic change D5 forbids. Dropping it would weaken the test.
- One more risk for a future repair: in a non-compact branch lane (two or more steps), `LaneColumn` renders `StepCard` without `isTail`. The spec's trunk-card locator `.step-card:not(.step-card--tail)` would then count branch-lane cards as trunk cards.
- Recommended follow-up: un-quarantine tests 2-4 with locator-only repairs, and replace test 1's single-tail assertion with the current multi-branch contract under its own ticket.

### Phase 2: Code Review — FAIL

#### Gates (fresh, run by me in WORKTREE_PATH, `nice -n 19`)

- The changed files are `backend/**` and `openspec/changes/**`. No `frontend/**` files changed, so the frontend gates were not triggered.
- Backend targeted run (`sbt -J-Xmx3g testOnly`). It covered the 15 specs in the executor's `specs.txt`, the 4 new specs, `*PatchSet*`, every spec that seeds a lane-kind secondary input (grep), and the `*Lane*`/`*Rejoin*`/`*Upsert*`/`*StepCreate*`/`*StepWrites*`/`*Duplicate*` patterns. Result: **74 suites, 1392 tests, 0 failed, 0 aborted**, and `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0` was present. The new specs `StepLaneDependentsRoutesSpec`, `StepReferenceCheckChainSpec`, `StepPlacementAgreementSpec` and `PatchSetUndoLaneDependentsSpec` all ran, as did `DuplicateStepReferenceChecksSpec` and `PatchSetUndoLaneSpec`.
- I did not run a full `testFull`, because another lane's `sbt testFull` was already running on the machine. The executor's `testfull1.log` reports 7368 succeeded, 0 failed, 4 canceled, with the guard line present. That is the executor's own evidence, not a fresh run.
- `npm run check:scala-quality`: clean (no inline FQNs; soft warnings only, none for the new files).
- `openspec validate shared-step-reference-check-chain --strict`: valid.
- Affected e2e, run with `DEV_PORT=6947` against fresh servers started for this review after the commit (backend pid 3492470, cwd = this worktree): `hel1345-rootid-step-placement`, `hel1007-multi-root-reorder`, `hel908-step-card-split`, `hel908-trunk-reorder-drag` and `hel908-trunk-reorder-order` passed **5/5**. Two specs that would also cover these paths are quarantined and so excluded by `testIgnore`: `hel912-lanes-rejoin` (HEL-992) and `hel968-multi-root-editor-flow` (HEL-991).

#### Review

- Refactor fidelity: PASS. `resolveCreateAnchor` keeps every arm's rejection, message and precedence. `listWithRootIdsInternal` returns the same `executionOrder` as `listByPipelineInternal`, so `current(index-1)` is unchanged. `StepPlacementAgreementSpec` checks the lane check's reparent derivation against the insert's own `reparentedStepIds` over 11 arms.
- DRY, modular, readable and typed: PASS. The `laneDependencyOf` visibility change to `private[helio]` is minimal and justified.
- Tests: meaningful. Each test drives one path, there are GUARD tests for each placement-rejection arm, and the backend backstop is pinned.
- Defects: see CR1 (user-visible regression) and CR2 (stage execution order).

#### Orchestrator point 1: frontend facts and ruling

Both of the executor's facts are verified, by code reading and by a live probe.

- `frontend/src/features/pipelines/ui/stepConfigs/SecondaryInputPicker.tsx` L80-89 disables only `computeAncestorIds`. Descendants and lane-dependents are offered as enabled options.
- `frontend/src/features/pipelines/hooks/stepCardOpHandlers.ts` L87-119 has `onUnionChange`, `onLookupChange` and `onJoinChange` call `persist(...)` without `captureErrors`. `useStepCardPersist.ts` L94-110 then drops the rejection ("local state always reflects user intent even if the PATCH fails").

Live probe, run on this lane's servers as throwaway user `hel1515-eval-1791790204@example.test`, id `03bdad41-6fea-4591-873a-0e0eaf7eeb9e`, verified via `/api/auth/me`:

- Seeded pipeline `eb197ba6-4f11-4c34-a98e-4e50627ccf29` as trunk `Limit(A) -> Union(U, secondary = data source) -> Limit(C)`.
- API: `PATCH /api/pipeline-steps/U` with lane=C returned `400 {"message":"Lane reference 'e5a9a3a3-...' would create a cycle (it depends on this step)."}`.
- UI, via a headless Chromium script driving the real page:
  - The "Other source" options were `["Data source: hel1515 src", "Lane node: Limit rows (would create a cycle)", "Lane node: Limit rows"]`. The second option is the ancestor A, disabled. The third is the descendant C, **enabled**.
  - Selecting C sent one PATCH, which returned 400.
  - The combobox then showed "Lane node: Limit rows". No alert text appeared, and the page showed no "it depends on this step" text.
  - **After a reload the combobox showed "Data source: hel1515 src"**: the edit was silently lost.

**Ruling: yes, this change introduces a user-visible regression, and it must be fixed in scope.**

- Before this change, choosing a dependent in the picker saved, and the run then failed with the engine's named "Cyclic or unresolved lane reference" error. The user saw the problem.
- After it, the same click looks saved but is silently discarded. The pipeline keeps running on the previous secondary input, with no signal that anything happened. This is the silent-edit-loss class HEL-1514 just fixed for cast.
- This 400 is new in a way that matters: it is the first lane-check rejection the picker can actually reach. The picker disables ancestors, and it only lists existing steps, so the 422 "does not exist" case is also unreachable from it.
- D4 explicitly made the backend change conditional on the UI surfacing the 400, so the gap is part of this ticket and not a pre-existing follow-up.
- None of this is a new product call. C1 already assumed the rejection. Making the rejection visible, and disabling the options it rejects, follows the picker spec's own existing rule ("a node the engine would reject [is rendered] disabled with a visible reason").

### Phase 3: UI Review — N/A

No Phase-3 trigger path changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). The live UI probe above was run as evidence for point 1, not as a Phase-3 review. CR1 adds `frontend/**` changes, so Phase 3 becomes mandatory in cycle 2.

### Overall: FAIL

### Change Requests

1. **Fix the silent edit loss the new 400 creates in the lane picker (user-visible regression; this is design.md D4's false premise).** All three parts are required:
   - **(a)** In `frontend/src/features/pipelines/hooks/stepCardOpHandlers.ts`, have `onUnionChange` (L93), `onLookupChange` (L102) and `onJoinChange` (L113) call `persist({...}, true)`, so a rejected PATCH shows its server message through `saveError`. This is the same opt-in `onUpsertSourceChange`, the HEL-1416 handlers and HEL-1514's cast already use. Add a jest test per handler (or one parameterised test) that is red first: a mocked 400 must render the server's "would create a cycle (it depends on this step)" message on the card.
   - **(b)** In `SecondaryInputPicker.tsx`, disable the step's dependents as well as its ancestors, with a visible cycle reason. The dependents are every step that reaches the configuring step through a parent edge or a lane edge, which is the same closure as `StepPlacement.dependentStepIds`. Add `computeDependentIds` beside `computeAncestorIds` in `frontend/src/features/pipelines/state/laneLayout.ts`. Add unit tests for a descendant and for a lane-transitive dependent (X lanes into A's subtree, so X is disabled on A). The disabled reason may reuse "(would create a cycle)" or name the dependency, but it must be visible text, not colour only.
   - **(c)** Add a `## MODIFIED Requirements` delta for `pipeline-lane-rejoin-picker`. Its "Ineligible nodes are greyed" requirement must name dependents. Its "A non-ancestor node in any lane is selectable" scenario and "imposes no ordering restriction" requirement must exclude dependents, so the picker spec agrees with the amended `pipeline-lane-rejoin-input` delta.
   - Update design.md D4's last bullet to say what was actually built, and list the frontend files in `files-modified.md`.
   - Cycle 2 must run the frontend gates (`npm run lint`, `npm run format:check`, `npm test`, `npm --prefix frontend run build`). It must also include a live check that choosing a dependent is impossible, and that a forced 400 shows its message.

2. **Make create's pre-upsert stage lazy, so its execution order lives in the shared method too.** In `backend/src/main/scala/com/helio/services/pipelines/PipelineStepCreate.scala` L220, `val pipelineAccessF` is a strict `val`. `findByIdShared` and `requireEditorAccess` therefore start immediately, at the call site, in parallel with the ownership and lane checks, which defeats `referenceChecksF`'s by-name `beforeUpsertF`. Before this change, the pipeline lookup ran only after ownership and lane passed. Statuses and messages are unaffected, because results are still sequenced. But create now does extra DB reads on every request it rejects, and D1's "stage order lives in the shared method and nowhere else" holds for results only, not for execution. Change it to a `def`, or pass the expression inline. No test change is needed. The existing d1 mutation already pins result order.

### Non-blocking Suggestions

- The `pipeline-lane-rejoin-input` delta keeps the requirement title "A lane reference may name any non-ancestor node...", but its body now also excludes dependents. Consider retitling the requirement at archive time, using a RENAMED entry.
- Follow-ups to carry into the PR, along with the executor's list:
  - AC4: a partial un-quarantine of hel908-tail-attach tests 2-4 with locator-only repairs, plus a rewrite of test 1 for the multi-branch contract (see the AC4 section).
  - The patch-set undo regression (`PatchSetUndoLaneDependentsSpec`). Undoing a delete of a tail-sibling lane referrer now fails that edit instead of silently restoring a cyclic graph. The root cause is that the journal does not record `attachAsTail`. This belongs in OWNER REVIEW under C1.
- Process note: my first browser navigation used the Playwright MCP tool. That wrote one snapshot and one console log into the main checkout's existing, gitignored `.playwright-mcp/` directory. I switched to a scratchpad-only headless script for the rest of the probe.
