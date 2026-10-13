## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `c3c91ed0e697ad2a118985a901068f6beab490c0` (branch `bug/lane-link-cycle-rejection/HEL-1521`).
Diff base was resolved live with `resolve-review-base.sh`: `67cf9e0e0451b781be463e82db25c57a8c8795bf` (origin/main, HEL-1523).
23 files changed. **No migration**: nothing under `backend/src/main/resources/db/migration/` is in the diff.

### Phase 1: Spec Review — PASS

- **AC1 (update/create reject lane-transitive cycles, existing cases unchanged)**: met.
  - `PipelineService.validateLaneReference` now takes its relation from `LaneCycleViolations.relationOf`.
  - The self 400 / missing 422 / ancestor 400 / descendant 400 order is unchanged, and those messages are byte-identical to base.
  - The new `DependentViaLane` branch returns 400 `Lane reference '<id>' would create a cycle (it depends on this step through a lane link).` This matches design D3 exactly, and I confirmed the string live (see Phase 3).
  - Update seeds the dependents closure with `{existing}`. Create seeds it with `StepPlacement.reparentedIds`.
  - Persistence is untouched on reject: the route specs assert `storedConfigOf(a)` is unchanged and `stepCountOf == 4`.
- **AC2 (reorder)**: met.
  - `LaneCycleViolations.of` now reports `DependentViaLane`.
  - `introduced` is still keyed on `(step, target)`, so a pre-existing violation still does not block a reorder.
  - The repository message (`PipelineStepRepository.scala:918`) uses `relation.describe`. The route spec asserts both the 400 and that the layout is unchanged.
- **AC3 (one pure implementation)**: met.
  - `ancestorsFrom`, `descendantsOf`, `dependentsOf` and `relationOf` live only in `LaneCycleViolations`.
  - `LaneScope.of` is the single construction used by create, update and duplicate, and builds every set from those functions.
  - `of` no longer has its own private walk.
  - `grep LaneCycleViolations backend/src/main` shows no second relation implementation.
  - `PipelineService.ancestorChainOf` has been deleted; it has zero remaining code references. `descendantStepIds` remains only for `PipelineRootWrites`, which design D2 places out of scope.
- **AC4 (picker)**: met. `SecondaryInputPicker` disables `ancestorIds ∪ computeDependentIds(...)`, using the existing `(would create a cycle)` label and the existing `Select` disabled state.
- **AC5 (spec deltas)**: met.
  - Both deltas are MODIFIED requirements, and I compared them against the main specs.
  - Every pre-existing scenario is preserved, and the new scenarios are added.
  - `openspec validate lane-link-cycle-rejection --type change` reports the change as valid.
- **AC6 (red-first, unit tests on both sides, e2e)**:
  - Unit tests exist in `LaneCycleViolationsSpec` (closure, diamond, legacy cycle, own-edge, precedence) and `laneLayout.test.ts`. There is a picker test and an e2e.
  - Red-first was verified by reading the base code, **not by running it**. On `67cf9e0e0`:
    - Update: `validateLaneReference` checks only self, ancestor chain and parent-chain descendants. For the spec's `a -> x` (x a tail of head, laning to d), x is in neither set, so the base answers 200.
    - Create: the re-parented descendants are `{d}`, so the base answers 201.
    - Reorder: base `of` checks direct relations only, so the base answers 200.
  - That is consistent with the executor's claim of 4 red cases.
- **Duplicate regression check** (requested): no regression for a legitimate duplicate.
  - The clone copies `existing`'s config, so it carries the same lane target `t`.
  - Its re-parented seeds are `existing`'s children: `reparentedIds(Some(existing))` returns all direct children, which matches `spliceInsertReportingInternal`, which re-parents trunk and tails.
  - `dependents(children of existing) ⊆ dependents(existing)`. So if `existing -> t` is valid, `t` is not a dependent of `existing`, and the clone is accepted.
  - Only a duplicate of an already-cyclic stored lane is now rejected. That clone would have been unrunnable anyway, so this is correct, not a regression.
- **Scope**: no edits outside the planned files.
  - The HEL-1542 items are not touched.
  - `computeAncestorIds` is unchanged; its over-disabling is tracked as HEL-1543, per design.
- **Assumed product calls**: the widened rule and the new wording are recorded in `workflow-state.md` `ASSUMED_PRODUCT_CALLS` and in design D3. As instructed, the absence of an owner ruling is not a FAIL.
- **CONSTRAINTS**: none (`[]`).

Issues: none blocking.

### Phase 2: Code Review — PASS

Gates were run fresh by me in `WORKTREE_PATH` at `c3c91ed0e` (`CLEAN_WORKTREE` was not set). Every run was in the foreground, under `nice -n 19`, with workers capped.

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 (zero warnings) |
| `npm run format:check` | All matched files use Prettier code style |
| `npm run typecheck` | clean |
| `npm test` (HELIO_JEST_MAX_WORKERS=3) | 49 suites / 458 tests passed (root); 584 suites / 6998 tests, 19 snapshots passed (frontend); exit 0 |
| `npm --prefix frontend run build` | exit 0 |
| `sbt -J-Xmx3g "testOnly com.helio.domain.pipelines.* com.helio.services.patchsets.*"` | 290 run, 290 succeeded; hel1468-guard failed=0 aborted=0 |
| `sbt -J-Xmx3g "testOnly com.helio.api.routes.pipelines.*"` (includes StepLaneTransitiveCycleRoutesSpec) | 673 run, 673 succeeded; guard failed=0 aborted=0 |
| `sbt -J-Xmx3g "testOnly com.helio.services.pipelines.* com.helio.infrastructure.persistence.pipelines.*"` | 850 run, 850 succeeded, **1 canceled** (assume-gated; not identified, no failure); guard failed=0 aborted=0 |
| `npm run check:scala-quality` | clean (soft size warnings only, none new from this diff) |
| `openspec validate lane-link-cycle-rejection --type change` | valid |

The backend gate was run as package shards, not a whole-suite `sbt testFull`. A whole-suite run exceeds 600 s, so the brief requires shards. What ran is exactly the table above. Packages outside those shards were not run, but they compile: `testOnly` compiles the whole test tree.

Checklist:
- Canonical code-quality ([mechanical]): no inline FQNs, imports are used, and the new files are within size budgets.
- Design-standard ([mechanical]): no CSS or token changes. The picker reuses the shared `Select` and its existing disabled-option state and label, with no new UI element.
- DRY: the one closure (`reverseClosure`) serves both `descendantsOf` and `dependentsOf`. `LaneScope.of` replaces three inline constructions.
- Type safety: `stack.pop()!` in `computeDependentIds` is guarded by `stack.length > 0`, and lint accepts it.
- Error handling: unchanged ServiceError mapping.
- Tests meaningful:
  - The route spec has a run-time BACKSTOP showing that the written graph actually fails `executeTree` with `Cyclic or unresolved lane reference`.
  - Guards cover re-saving the current target, a node upstream only through another step's lane, attachAsTail, duplicate, and a non-cyclic reorder.
  - The domain spec pins precedence and cycle-safety.
- Cycle-safety: both the Scala and TS closures are visited-set walks. The legacy-cyclic-graph tests terminate.
- Behaviour-preserving parts:
  - `ancestorsFrom` keeps `ancestorChainOf`'s stop-at-missing-parent semantics and adds loop safety.
  - `descendantsOf(seeds) - self` is equivalent to the old `ancestors(target).contains(s)` descendant test on an acyclic graph.

Issues: none blocking. See Non-blocking Suggestions.

### Phase 3: UI Review — PASS

Servers were started with `start-servers.sh` (ports 6953/9860, `PASS servers`) and stopped with `stop-servers.sh` (`STOPPED ports=6953,9860`).

- **e2e**: `DEV_PORT=6953 BACKEND_PORT=9860 HELIO_PLAYWRIGHT_WORKERS=1 npx playwright test e2e/hel1521-lane-picker-dependents.spec.ts` gave 1 passed (4.1 s). Its throwaway user was deleted by the registry teardown.
- **Manual check in the running app**:
  - Setup: a throwaway user `hel1521-eval-1791899884410@example.test` (id `6efed88f-0635-43d8-86b6-46201ffb28a1`). Pipeline: head (Limit) -> Union -> Sort; tails Join (lanes to Sort) and Select.
  - The picker on Union listed Limit, Join and Sort as `(would create a cycle)` with `[disabled]`, and Select fields as enabled. The accessibility snapshot confirmed this.
- **Keyboard**: ArrowDown from the open listbox moved `aria-activedescendant` to "Lane node: Select fields", skipping the disabled options. The combobox keeps its accessible name "Other source".
- **Server agreement (live)**:
  - PATCH Union -> lane Join returned `400 {"message":"Lane reference '<join id>' would create a cycle (it depends on this step through a lane link)."}`. This is the exact D3 string.
  - PATCH Union -> lane Select returned 200.
- **Themes**: the disabled options render as muted text in both dark and light. The enabled option and the selected highlight are distinct. Both themes are consistent with the existing ancestor-disabled presentation.
- **Breakpoints**: at 1280, 768 and 375 the listbox renders without clipping or overflow.
- **Console**:
  - No errors from the feature.
  - Pre-existing, unrelated 404 on `GET /api/pipelines/:id/schedule` when no schedule is set.
  - 401 on `/api/auth/me` before login.
  - The only other errors came from my own deliberate 400 probe and a bogus probe URL.
- **Cleanup**: the user was deleted by exact (id, email) using `buildUserDeleteSql`, and a follow-up count returned 0. The browser theme was restored to `dark`.

Evidence (persisted with persist-evidence.sh):
- dark 1280: `/home/matt/Development/helio/.concertino/runs/HEL-1521/evidence/test-results/hel1521-eval-picker-theme1.png`
- light 1280: `/home/matt/Development/helio/.concertino/runs/HEL-1521/evidence/test-results/hel1521-eval-picker-light.png`
- light 768: `/home/matt/Development/helio/.concertino/runs/HEL-1521/evidence/test-results/hel1521-eval-picker-768.png`
- light 375: `/home/matt/Development/helio/.concertino/runs/HEL-1521/evidence/test-results/hel1521-eval-picker-375.png`

Note on the 768/375 screenshots: they were taken after the probe PATCH re-pointed Union's lane to Select. Select fields therefore also shows "(would create a cycle)" there. That is the pre-existing `computeAncestorIds` behaviour of disabling the step's own current lane target, which design Non-Goals defers to HEL-1543. It is not caused by this change.

Issues: none.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `backend/src/main/scala/com/helio/domain/pipelines/LaneCycleViolations.scala:93`: the scaladoc for `introduced` lost its two-space indent and now sits at column 0 inside the object. Re-indent it.
- `backend/src/main/scala/com/helio/domain/pipelines/LaneCycleViolations.scala:57-60`: the `extends` column alignment has an extra space or two on the `DependentViaLane` line. This is cosmetic.
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala:1375`: the scaladoc still cites `ancestorChainOf` as an example of the companion-object pure-helper convention. That symbol was removed in this change; drop or replace the citation.
- `backend/src/test/scala/com/helio/api/routes/pipelines/StepLaneTransitiveCycleRoutesSpec.scala`, "400 through two lane hops":
  - `d should not be empty` is filler that only silences the unused binding.
  - The test also does not assert that the stored config is unchanged. Assert `storedConfigOf(a) shouldBe before`, as the one-hop case does.
- `StepLaneTransitiveCycleRoutesSpec.scala`, duplicate GUARD: it duplicates `x`, which has no children, so the new re-parented-seed path is exercised with an empty seed set. A duplicate of a lane step that has children would actually exercise the `reparentedIds(Some(existing.id))` seeds.
