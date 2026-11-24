## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `e6bdfb578d571955c1abb44007fc58bd7a7f62dc` against the live-resolved base `a6ac494b47f756d38520e17b4fb5aeab898ace6b`
(commits `eee05b85b` red, `e6bdfb578` implementation). The diff touches no files under `frontend/**`, so it is backend only.

### Phase 1: Spec Review — PASS
Issues: none

- AC1 (a test that fails first on each path): `FormMinRowsPathsSpec` was committed in `eee05b85b` before any main-source
  change, and `git diff eee05b85b e6bdfb578` shows no edit to the spec. I re-ran it myself at `eee05b85b` in a
  throwaway detached worktree. The result was 3 FAILED (duplicate line 107, apply-proposal line 127, PUT contents
  line 152, each "4 was not equal to 5") and the other 6 passed. At HEAD it passes.
- AC2 (compact counter unchanged): checked on all three paths (duplicate, apply-proposal, PUT contents), with
  4 -> 4 asserted on each.
- AC3 (import unchanged, pinned by a guard): the test is `GUARD: dashboard import`. Dashboard duplicate also gets a GUARD,
  following the owner ruling `dashboard-duplicate=exclude-with-guard-test`.
- PUT `/contents` goes beyond the two paths the ticket names. It is backed by a recorded owner ruling
  (`workflow-state.md` SCOPE_RULINGS `contents=include`), so it is not scope creep.
- Path enumeration: grep shows that `duplicateSizes` has one production caller (`PanelMutationRepository.duplicate`)
  and `buildLayout` has two (`DashboardProposalService.applyLayout`, `DashboardContentsService.buildAndReplace`). Both
  match files-modified.md. The design said `PanelLifecycleWrites.duplicatePlaced` would compute minH. Instead it is
  computed from the in-transaction source row in the repository, and this deviation is documented in files-modified.md.
- The spec delta (`form-panel-rendering`) and tasks.md match what was implemented. CONSTRAINTS is `[]`.

### Phase 2: Code Review — PASS
Issues: none blocking

Gates (fresh, my own runs, lane DB `helio_hel1834`, `-J-Xmx3g`, `nice -n 19`):
- The full backend suite ran as `sbt testFull` in 10 exact-once shards (`HELIO_TEST_SHARD_COUNT=10`, index 0..9). It
  covered **782 suites, 10,381 tests, 0 failed, 0 aborted**, and the hel1468 guard reported `failed=0 aborted=0` on every shard.
  There were 5 canceled tests, all opt-in `HELIO_MEASURE` measurement specs (e.g. `OutputFilteredMetricMeasurementSpec`,
  `RunPathHeapSpec`) that cancel by design. This closes the executor's reported gap: the api, pipelines, sources and spark
  packages are all included.
- `check:scala-quality` clean. In changed files the only warning is the pre-existing soft budget on `FormPanel.scala`
  (389 lines; +6 here). `check:openspec`, `check:spec-structure`, `check:repo-integrity` and
  `check:no-credential-leak` passed, and `format:check` passed.
- Frontend gates were not run because no `frontend/**` file changed.

Mutation evidence (my own, applied in a throwaway detached worktree at HEAD, one at a time, reverted):
- Import remap floors h at 5 (`DashboardSnapshotRepository.remapLayoutItem`): only `GUARD: dashboard import` fails.
- Dashboard-duplicate remap floors h at 5 (`remapItems`): only `GUARD: dashboard duplicate` fails.
- Unconditional lift (remove `isSpaceBelowFree` from `ProposalLayoutSupport.buildLayout`): the route test for the
  neighbour below, the unit test for the neighbour below, and the stacked-forms unit test all fail.
- `isCompactCounter` always false: all three compact-counter route tests fail (duplicate, apply, PUT).
These match the executor's `evidence/mutations.txt` entries `guard-import`, `guard-dashdup`, `lift-ignores-free` and
`counter-not-exempt`. Both guards are labelled `GUARD`, and the two mutations above show each can fail.

Mirror check against the client:
- `FormPlacementRule.isSpaceBelowFree` uses the same arithmetic as `isSpaceBelowFree` in `panelGridConfig.ts`:
  top `y+h`, bottom `y+rows`, half-open column and row overlap, target excluded by panelId, and no bottom edge.
- `FormPanelConfig.isCompactCounter` matches `isCompactCounterConfig`: exactly one field and its control is `counter`.
  The Empty or zero-field config counts as a plain form on both sides.
- The lift condition matches `liftResizedForm`: the target is a non-counter form, `h < 5`, and the space below is free.
  Then only `h` changes. The backend applies it to authored lg items in proposal order against the running layout, so
  the result has no overlaps (a unit test checks `LayoutValidator` at every breakpoint).

Code quality: no inline FQNs, no `Any`/casts, no dead code or TODOs. The defaults (`minH = 1`, `minRows = Vector.empty`)
keep other callers unchanged.

### Phase 3: UI Review — N/A
No trigger path changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**` and `openspec/specs/**` are untouched; the spec
delta lives under `openspec/changes/`).

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `evidence/red-route-spec.txt` cites failure lines 105/125/150, but the committed red spec fails at 107/127/152. That
  means the recorded run came from a slightly earlier draft of the file, not the exact committed version. The red is
  still real (I reproduced it on `eee05b85b`). In future, record the red run after the test file is final.
- `evidence/mutations.txt` records outcomes but not the mutation diffs. Including the one-line diff per mutation would
  make it self-authenticating.
- The route tests for apply-proposal and PUT contents assert only `lg`. A one-line md/sm/xs check would pin the claim
  that "reflow carries the lift".
