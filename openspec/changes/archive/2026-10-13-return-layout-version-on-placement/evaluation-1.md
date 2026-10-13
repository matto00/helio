## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `2963aba5ffc8088a574f1f4ca708b3c5b26a7231`. Review base (resolved live): `f3490d1d8c81a5082c973c21462ace3089d7183a`.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (create/duplicate/batch carry the new `layoutVersion`): `PanelLayoutPlacement.insertAndAppend` re-reads
  `layout_version` after the layout UPDATE, in the same transaction, while the row is still `FOR UPDATE`
  (PanelLayoutPlacement.scala:56-59). `placedResponse` copies it onto the create/duplicate `PanelResponse`, and the
  batch route puts one top-level value on `CreatePanelsBatchResponse` and clears it from the items
  (PanelRoutes.scala:63, 85-90). Checked live against the running backend: create 201 v=1, duplicate 201 v=2, batch
  201 top-level v=3 with no item key, then a dashboard read gave 3. Panel PATCH has no `layoutVersion` key, and an
  empty batch is 400.
- AC2 (adopt only when consecutive): the slice adopts only at `store + 1` with an append in every breakpoint
  (dashboardsSlice.ts:353-363). The hook advances `persistedVersionRef` only in class 3, when the store version moved
  in this render to exactly `baseline + 1` (useLayoutSave.ts:206-218). Two independent `+1` proofs.
- AC3 (create then drag gives a single 200 and no 409): `DesktopPanelGrid.placementVersion.test.tsx` asserts
  `calls == [[2, 200]]` and that a second flush makes no further call. The fake server 409s any stale
  `expectedLayoutVersion`, so a non-adopting implementation would record `[[1,409],[2,200]]` and fail. The duplicate
  variant is covered too. Checked live in the UI: duplicating "b1" from the panel menu, dragging and pressing
  Save now produced exactly one `PATCH /api/dashboards/:id/update` (200) and no 409 (network log entries 682-684).
  Server version went 3 → 4 (duplicate) → 5 (PATCH).
- AC4 (I1 regression, concurrent writer): the test asserts the store stays at 1 for a v=3 response, then
  `[[1,409],[3,200]]`, and the other writer's `panel-3` survives. The in-flight-PATCH case (task 3.5) is also covered.
- Tasks 1.1-3.6 are all done and match the diff. No scope creep: `git diff --stat ... -- helio-mcp` is empty. No
  migration. Schemas were updated in the same change, and `npm run check:schemas` passes.
- CONSTRAINTS C1 is honoured: `prevStoreVersionRef` is written only inside the layout effect
  (useLayoutSave.ts:184-185). It is not written in the every-render effect at :135-137.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates I ran myself in `WORKTREE_PATH`:
- `npm run lint`: clean (0 warnings). `npm run format:check`: clean. `npm run typecheck`: clean.
- `npm test` (HELIO_JEST_MAX_WORKERS=3, nice 19): 584 suites / 6993 tests passed, plus the root suite of 49 / 458
  tests passed.
- `npm --prefix frontend run build`: success.
- `sbt testFull`, run as four fresh-JVM shards via `HELIO_TEST_SHARD_INDEX/COUNT` (0..3 of 4). This covers the whole
  suite, including `com.helio.spark` and `testkit`, which the executor did not run. Results: 2081 + 1886 + 1902 + 1880
  = **7749 passed, 0 failed**, with `[hel1468-guard] failed=0 aborted=0` on every shard. The changed specs
  (`DashboardLayoutVersionSpec`, `PanelBatchCreateSpec`) were also run directly with `testOnly`: 25/25 passed,
  including all 5 new "placement responses" cases.
  - A warning on method: my first attempt used `sbt --client`. The server kept the first command's env, so all three
    "shards" reported the identical 2081. I discarded those runs, shut the server down, and re-ran every shard in a
    fresh JVM. The numbers above come only from the fresh runs.
- `node scripts/check-scala-quality.mjs`: clean. `npm run check:openspec`: clean.

Specific judgements requested:
- **`PlacedLayouts.layoutVersion: Option[Long] = None` default.** I see no silent-omission risk on any current
  path. `PlacedLayouts` is constructed in one place only, `CreatePlacement.append` (CreatePlacement.scala:86). Its
  only production consumer is `insertAndAppend`, which unconditionally maps every placed item to
  `Some(version)`. All three route-reaching callers (`insertPlaced`, `duplicate`, `insertBatchPlaced` in
  PanelMutationRepository.scala:27/75/173) go through it. The `.result.head` re-read fails the transaction rather
  than returning `None` if the row vanished, which can't happen under the held `FOR UPDATE` lock. The default is
  also fail-safe by construction: a `None` is omitted on the wire, the client keeps its old version, and the
  pre-existing 409-and-rebase path runs. It can never be serialised as a wrong number, which is the hazard D1
  actually forbade (`0L`). Acceptable.
- **Do the AC tests prove a single 200 with no 409?** Yes, see Phase 1 AC3. The assertion is on the exact call
  list, including outcomes, against a fake server that enforces the precondition. I did not re-run the executor's
  mutation (Iron Law: I don't modify code). By inspection, removing the hook's `persistedVersionRef` assignment would
  send `expected=1` and turn `[[2,200]]` into `[[1,409],[2,200]]`. Removing the slice adoption would also fail
  `expect(dashboard().layoutVersion).toBe(2)`.
- **helio-mcp untouched:** confirmed (empty diff).

Other checklist items:
- Canonical code quality: there are no inline FQNs and no `any`. `dashboardsSlice.ts` is 499 lines (it was already
  over the 400 split threshold before this change, at about 480), and `panel.ts` is 499. CONTRIBUTING asks for a
  split proposal in the PR description; see suggestions.
- DRY, readability and modularity are fine. Error handling: the empty batch is rejected upstream with 400, and a
  missing row raises `PlacementTargetMissing` as before. No dead code.

### Phase 3: UI Review — PASS
Issues: none.

Servers were started with `start-servers.sh` and the `assert-phase.sh servers` check passed. I used a throwaway user
`hel1525-eval-1791888146440@example.test` (id `97f42f1d-b9b8-48d5-b51a-52f5807aa112`) and deleted it afterwards
with `buildUserDeleteSql` by exact (id, email). Its dashboard is gone too: users=0, dashboards=0.
- Happy path (duplicate via the panel menu, then drag, then Save now): exactly one PATCH, 200, no 409.
- Racing writer (a panel created out-of-band, server v6; then a UI duplicate, response v7, not adopted; then drag
  and save): the panels refetch saw the other writer's panel, and the pre-existing HEL-1233 owner repair
  (`POST .../layout/repair`, 200) re-baselined the store before the save. The PATCH then landed 200. The final
  server layout has all 7 panels in all 4 breakpoints (7/7/7/7) and nothing was lost. The literal 409 branch of AC4
  is covered by the unit test; live, the repair path pre-empted it, which is existing behaviour and is safe.
- Console: the only error is the 400 from my own deliberately malformed out-of-band PATCH. The app itself raised
  none.
- Breakpoints 1100 / 768 / 375 render all 7 panels with no horizontal overflow. 1440 was the default viewport used
  for the flows above.
- This change has no new visible UI surface, so there is nothing to check for accessible names or loading/empty
  states.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `DashboardLayoutVersionSpec.scala` "omit the version on an empty batch": the `if (status == Created)` branch is
  dead, because `PanelService.batchCreate` (PanelService.scala:245) always 400s an empty batch. The test can only
  ever assert `status shouldBe BadRequest`. Rename it, or assert 400 directly, so it doesn't read as proving an
  omission it never exercises.
- Unverified executor claim: the executor reported "2318 + 5694 passed" (8012) without spark/testkit. My full fresh
  sharded run, which includes spark/testkit, totals 7749. Both are green. The discrepancy is probably overlap or
  double-counting in the executor's package split, but nothing here depends on it.
- PR body: note the `dashboardsSlice.ts` (499) and `types/panel.ts` (499) split proposal required by CONTRIBUTING's
  400-line rule, and the HEL-1524 note that the batch response gains an optional top-level `layoutVersion`.
- `files-modified.md` lists repo-root-relative paths, not absolute ones. They are complete and unambiguous, but if
  the driver's "full paths" rule means absolute paths, prefix them with `WORKTREE_PATH`.

Follow-ups filed by this evaluation: none. (HEL-1539, the DELETE response version, was already filed at design time.)
