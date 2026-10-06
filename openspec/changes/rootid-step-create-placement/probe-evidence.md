# HEL-1345 probe evidence (groups 1-2, backend)

Commands run from `backend/` as `nice -n 19 sbt '<cmd>'`. Full logs: scratchpad `hel1345-*.log`.

## 1.1 Red: placement spec against unmodified `PipelineService.scala` (AC1/AC2)

`testOnly com.helio.api.routes.pipelines.PipelineStepRootIdPlacementRoutesSpec` -> exit 1, `Tests: succeeded 1, failed 9`
(log `hel1345-red1.log`). The one pass is the position-0 control (head insert is the old behaviour). Failing assertions:

- tail append: `Vector("6457a822-...") was not empty` (the old arm reports the old head as reparented)
- position 2: `Vector("6b7f0671-...") was not equal to Vector("56db2c98-...")` (reparented A, not C)
- position == trunk length: `Vector(...) was not empty`
- position 4 / -1: `201 Created was not equal to 422 Unprocessable Content`
- empty root position 1: `201 Created was not equal to 422 Unprocessable Content`
- multi-root tail append: `Vector(...) was not empty`; multi-root position 1: `Vector(...) was not equal to Vector(...)`
- position-1-only root: `Vector(...) was not empty`
- lane pre-check: `201 Created was not equal to 400 Bad Request`

## 1.2 Green with the fix, and mutation

- With the rootId arm fixed and the lane pre-check NOT yet changed (the D4 red state, see 1.3): `Tests: succeeded 9, failed 1` (`hel1345-red2-lane-only.log`).
- Fully fixed: `Tests: succeeded 10, failed 0` (`hel1345-green1.log`).
- Mutation (arm's splice call restored to `None, explicitRootId = Some(rootId)`): `Tests: succeeded 4, failed 6` (`hel1345-mut1.log`); tail, position 2, position == length, multi-root x2 and position-1-only cases are red again.

## 1.3 Lane pre-check (D3/D4) red

The test first asserts its own precondition: R1 (A->B) is seeded first, the GET order lists R1's head before R2's, and `stepRepo.trunkOf(...)` is exactly `[A, B]` (R1's chain). With the placement fix applied and `laneCheckF` unchanged, the request (union with lane Y, `rootId` R2, no position) returns `201 Created was not equal to 400 Bad Request` (`hel1345-red2-lane-only.log`). The old pre-check anchored on R1's B, so Y was not an ancestor.
Note: the design says "422"; the real status for a lane that is an ancestor is **400** (`validateLaneReference`'s cycle arm is `BadRequest`). The test pins 400 and `include("cycle")`.
Green after routing `laneCheckF` through the resolver: part of the 10/10 run above. Mutation (rootId branch of the lane pre-check disabled with `if false`): `Tests: succeeded 9, failed 1`, the lane test red again (`hel1345-mut2.log`).

## 1.4 `PipelineStepReparentRoutesSpec` rewrite

Run against the UNFIXED service (`git stash -- src/main`): `succeeded 9, failed 2` (`hel1345-reparent-unfixed.log`): the no-position tail case `did not include substring "<tail id>"` (old head-splice names the root head) and the childless-trunk-last append `422 Unprocessable Content was not equal to 201 Created`. The `position: 0` case is green both before and after (unchanged behaviour). With the fix: both specs together `succeeded 21, failed 0` (`hel1345-green2.log`).

## 1.7 `sbt testFull`

`Total number of tests run: 6051, Suites: completed 433, aborted 0, Tests: succeeded 6051, failed 0, All tests passed.`, exit 0 (`hel1345-testfull.log`).

## 2.1 `ac3-query.sql` on embedded Postgres (throwaway spec, deleted, not committed)

The exact file text was executed through a raw JDBC statement. The "unfixed arm" is the old service call reproduced at the repository level, `spliceInsertAtInternal(parent = None, explicitRootId = Some(root))` with no position, which is exactly what the unfixed `persistNewStep` rootId arm invoked. No production or shared-dev DB access (C9).

Legitimately built trunk (A, then anchored appends B, C, D): header row only, 0 rows.

```
pipeline_id | root_id | trunk_len | head_run_len | strong_inverted_edges | weak_inverted_edges | root_count | head_created_at
(no rows)
```

Root A->B plus two unfixed rootId appends, no position:

```
19a1f6db-2a94-4123-bb15-083169fd265c | 19a1f6db-2a94-4123-bb15-083169fd265c | 4 | 2 | 2 | 2 | 1 | 2026-10-06 12:13:17.047824
(trunk_len | head_run_len | strong_inverted_edges | weak_inverted_edges | root_count | head_created_at)
```

head_run_len = 2 as expected (log `hel1345-ac3.log`).

# Cycle 2 (frontend, groups 3-4)

Frontend commands run from `frontend/` as `nice -n 19 npx jest --config jest.config.cjs --maxWorkers=2 <files>`; logs in the scratchpad as `hel1345-fe-*.log`.

## 3.0 Merge

`git merge origin/main` (HEL-1340 05004f85, HEL-1297): clean, no conflicts. Both backend route specs re-run on the merged tree: `PipelineStepReparentRoutesSpec` + `PipelineStepRootIdPlacementRoutesSpec` -> `Tests: succeeded 21, failed 0` (`hel1345-merge-green.log`).

## 3.1 Unit tests: `applyCreatedStep.test.ts`, `insertAnchor.test.ts`

- Red: implementation moved aside, both suites fail to compile, `TS2307: Cannot find module './insertAnchor'` / `'./applyCreatedStep'`, `Tests: 0 total` (`hel1345-fe-red-unit.log`). Green with the implementation: `Tests: 19 passed, 19 total`.
- Mutations (each reverted, `applyCreatedStep.test.ts`): chain-skip disabled -> 2 failed; `claimedParent` ignored -> 2 failed; `rootId` not cleared on reparent -> 1 failed; case-3 user-removed guard deleted -> 1 failed.
- Unresolved-chain behaviour is option (b) (design D5, Risks): a chain through an absent step that does not reach `created.id` is applied. Pinned by "unresolved chain (r6 note 1, option b)".

## 3.2 RTL tests: `PipelineDetailPage.createPlacement.test.tsx`

Red run on the BASE hooks/service (the merged base's `usePipelineStepCreation`, `usePipelineDetailPage`, `pipelineService` stashed): `Tests: 9 failed, 2 passed, 11 total` (`hel1345-fe-place-red.log`). The 2 passes are the schema-fallback case (g) and the "created id already brought in by a duplicate's sync" case, which already behave on base.
Green with the implementation: 12 tests (including (i)), all pass.
Mutations (`hel1345-fe-pmut-*.log`): `reparentedStepIds` ignored by the hook -> 7 failed ((a), (b) x2, (c), (d) x2, (h)); anchor ignored (always append) -> 4 failed ((a), (c), (d) x2); case-3 append removed -> 1 failed ((f)); anchor-gone check removed -> 1 failed ((e)).

## 3.2(i) "a trunk-append AI draft vanishes until reload" (HEL-1340 handoff)

Reproduced against real servers (own ports 6777/9684, cwd verified via `readlink /proc/<pid>/cwd`) with a throwaway Playwright probe (deleted, not committed): pipeline with limit + sort steps, append a Generate-text AI draft through the bottom row, complete its config, wait 3 s, read the rendered labels and the steps API, reload.

| backend | frontend | after create (labels) | steps API | after reload |
| --- | --- | --- | --- | --- |
| unfixed (head-splice) | base | `Limit rows, Sort rows` (the new card is MISSING) | generatetext is the root, limit/sort children | `Generate text, Limit rows, Sort rows` |
| unfixed | new | `Generate text, Limit rows, Sort rows` | same | same |
| fixed | base | `Limit rows, Sort rows, Generate text` | limit root, sort, generatetext children | same |
| fixed | new | `Limit rows, Sort rows, Generate text` | same | same |

Root cause (probe-confirmed): the backend's rootId head-splice returned the appended step as a SECOND root-level step of the root (rootId set, no parent) while the old head stayed root-level locally (the reparent was never applied, no resync on the draft path). `buildLaneGraph` seeds two lanes for one root and the river renders only the primary lane, so the new card is on screen nowhere until a reload re-reads the tree. The backend fix alone resolves it (row 3). The delta application (D5) also makes the editor robust to it (row 2). Added the editor-side guard test "a trunk-append AI draft stays on screen after its create and after a later full sync"; red under the mutation that restores head placement in the mock (root-level response, no delta): `expect(labelsInOrder())` mismatch, 1 failed (`hel1345-fe-place-i-mut.log`).

## 3.3 Planned edits to existing tests (each with its reason)

1. `PipelineDetailPage.creatingStep.test.tsx` "disables the toggle ... until the create lands" and the lane-add in-flight case: the create-immediately paths no longer GET after the create, so the in-flight window is now the CREATE promise (`holdCreate`). Guard red under mutation (`markCreating(tempStep.id, true)` replaced by `false`): `Tests: 3 failed, 1 passed, 4 total` (`hel1345-fe-gmut-c1-never-creating.log`).
2. `PipelineDetailPage.draftCreate.test.tsx` "a later full resync keeps the created draft's card open": retargeted to a caller that still uses `syncStepsFromServer` (duplicate). Red under mutation (the `renderKey` carry in `syncStepsFromServer` removed): `1 failed, 11 passed` (`hel1345-fe-gmut-c2-no-renderkey-carry.log`).
3. `PipelineDetailPage.test.tsx`: the gap-insert wire pin changed from `position 1` to `parentStepId "x1"` (D11); the two queued post-insert `getPipelineSteps` once-values were removed (they leaked into later tests) and the server's post-insert truth is expressed through the create mock (`parentStepId: "x1"`, `reparentedStepIds`). Before the edits these 4 tests failed on the new code (`hel1345-fe-pipelines-after-impl.log`: `Tests: 4 failed`), exactly the planned ones.

## 3.4 D6: HEL-1340's `draftCreate` item-1 test ("a non-head reorder keeps a created draft's card open")

It was on the base and encoded head-splice placement in its GET mock and create response. Updated to the fixed placement (`ai-1` after `anchor-1`, `f-1` re-parented under it, `reparentedStepIds: ["f-1"]`) in its own commit. Guard check: with the updated mocks it is red under the mutation `renderKey: undefined` in `handleReorderSteps`' reconcile (`Tests: 1 failed`, `hel1345-fe-d6-mut2.log`). It is NOT red under "restore head placement in the mock" (the test guards the open card under a reorder, not placement), so that mutation is not claimed.

## 4.1 E2E `e2e/hel1345-rootid-step-placement.spec.ts` (DEV_PORT=6777, BACKEND_PORT=9684, 1 worker, nice 19)

Flow: throwaway user, static source, pipeline, limit + sort via API; UI append of "Select fields" through the bottom row; UI insert of "Cast type" through the gap between Limit and Sort; rendered order; reload; rendered order and the steps API parent chain.
- Red, against the backend with the rootId arm restored to the old head-splice call (`hel1345-e2e-red.log`): expected `Limit rows, Cast type, Sort rows, Select fields`, received `Select fields, Cast type, Limit rows, Sort rows`.
- Green, fixed backend (`hel1345-e2e-green.log`, `hel1345-e2e-green2.log`): `1 passed`.

## Dev-DB residue (shared dev DB), created and deleted by exact id

Throwaway users (all deleted with `DELETE FROM users WHERE id IN (...)` by exact id; no `matt@helio.dev`):
6d36da0b-c0ca-4cfc-8e0d-b62f130c0fde, f3dd334f-e9fa-4a00-9902-155446f883ba, 21cb3462-e4fd-47af-a0b0-6b4cabd445b0 (e2e);
024d3be0-7eaa-448c-b24b-3f187f5608a9, e032d5f5-d69d-471b-a1af-4dd2ecfe4d2c, a6205015-4abf-4228-b1c5-a538a73150f2, 2f9fc860-ff7e-4579-88ad-b8e02d9b7b82, 7afaa098-f0b0-4a8c-be65-a8e6bf08f82a, e57d9957-c34a-4d20-bafe-e05d3c1954b6, aa6af332-42de-44ab-9a51-e56aa23ed4a9, 7ca39c94-c83a-4c09-852a-e130d85d203f, 8b8158ca-4996-413a-9878-25aa0a805067, f4c453ce-0521-4630-9bcd-ddbe9e25245f (probe);
0e65cb60-103c-4988-a80a-39221d88933b (a `curl` register I ran to read the response shape).
Pipelines left behind by probe runs that failed before their own cleanup, deleted by exact id: 396227c2-ee5d-4588-882a-97bd03fd992e, 692fc319-a2b4-4758-b62c-9a4289712a94, 7a2730ed-1bfe-438b-a521-9df743e458fe, 7dd96f2f-af8d-4c80-b016-2be2d4432f48, 9944bf5f-0880-4beb-a4d3-6a178b258292, bd738c99-2c29-4cc6-bf3f-7687f30b7839.
Sources, same: 0190f806-5a8d-4aba-8f4f-d1a0944fc982, 16f272e9-def9-4034-be25-0516fffcbdb1, 2d04befd-5100-4ea7-8481-4702c2ba3b75, 40b083f4-3f3d-48b4-a02f-f293d550929e, c56cc59c-052d-470f-9125-b61a6fe55111, f5398667-c5fa-4ca5-beda-e83cfd09124a.
Pipelines/sources the specs deleted themselves through the API (verified absent by exact id afterwards): pipelines 2f901b5c-a654-48b7-9117-ae320c422118, ea2bf909-d584-4815-967f-91c003eaf183, cd3e92d3-0a5a-4e43-82a1-e0f633735a31, e696f323-6b2c-4eb5-9dd8-0f280147abfd, 46e10629-12bb-4c7e-a420-b48ea5658be6, 542d8741-0303-4610-acc4-991275f63081, f8ffe256-0331-4a25-988a-f37f2843e565; sources 8e250041-58a2-4144-a14d-401c9068c307, 855dd54c-2482-449b-9743-5d9c60701701, 24d59676-9df8-401c-b334-d0f8eab076da, 355cfae9-7129-4d8e-af37-f5f2ceffa047, f2a9ea55-8349-471e-a198-855398e43b4c, 8a5d544d-a026-4e72-b956-9999eed3ea9b, 9347c11c-69e7-4af6-99ad-de88044ee712.
Note: the user-delete had no API route, so it was a SQL delete by exact id on the dev DB (the exact-id procedure C8 allows); the dev DB, never production, was the only DB touched.

## 4.2 Gates on the final tree

- `npm run lint` exit 0; `npm run format:check` exit 0 ("All matched files use Prettier code style!"); `npm run typecheck` exit 0; `npm --prefix frontend run build` exit 0.
- Frontend Jest, whole suite, `--maxWorkers=2`: `Test Suites: 442 passed, 442 total`, `Tests: 4616 passed, 4616 total` (`hel1345-g-jest.log`).
- `nice -n 19 sbt testFull` re-run on the final tree (after the last backend spec edit): `Total number of tests run: 6051`, `Suites: completed 433, aborted 0`, `Tests: succeeded 6051, failed 0`, `All tests passed.`, exit 0 (`hel1345-testfull2.log`); `sbt --client shutdown` run as a separate call.
