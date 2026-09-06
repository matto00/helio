## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: `85c53504`. All gates re-run by me in the worktree (not trusted from
`files-modified.md`).

### Phase 1: Spec Review — PASS

Issues:

- AC1 (restated), AC2 (`derived-plus-column`), the `firstRootIdAction` proof-by-absence and the
  schema update are all addressed at the backend/spec level, against the ruled whole-pipeline
  semantics (request shape unchanged, no `rootId`). AC1's restatement and AC2's correction are
  both stated explicitly in `design.md` with their reasoning, per the ticket's requirement.
- Verified independently:
  1. **Per-root partition, not a flat chain.** `PipelineStepRepository.scala:660-679`:
     `unionWithLabels` labels each step with the root whose `trunkOfRoot` walk produced it,
     `orderedTrunkIds.groupBy(labelOfStep)` partitions, and each partition is relinked with its
     own parentless head carrying its own `root_id` and later members chained *within the same
     partition*. No cross-partition parent is constructible. `labelOfStep` is total over the
     request because `validateTrunkReorderRequest` runs first and rejects any non-union id.
  2. **AC2's derived owning-root map is genuinely independent.** `owningRootMap`
     (`PipelineStepRepositorySpliceSpec.scala:641-652`) walks `parentStepId` to the parentless
     ancestor and reads that ancestor's `root_id` via raw SQL (`rawRootIdColumn`), not via
     `trunkOfRoot`/`rootIdsOf`. The test also pins non-vacuity (`headsBefore(root1) shouldBe a.id`
     / `headsAfter(root1) shouldBe b.id`), so the map cannot pass by nothing having changed.
  3. **`firstRootIdAction` deleted, not guarded.** `sed -n '641,690p' … | grep firstRootIdAction`
     → zero hits (method body is 641-685). The definition (`:44`) and the out-of-scope call sites
     (`:100`, `:283`, `:396`, `:469`, plus `OutputRepository`) are untouched, as required.
  4. **The HEL-913 fence is gone,** along with the `listRootDataSourceIdsInternal` call that only
     fed it (`PipelineService.scala:2118-2144`); the other `listRootDataSourceIdsInternal` call
     sites remain. The route test that asserted the 400 is *restated* as a live two-root success
     test, not deleted.
  8. **No migration added or edited** — `git diff --name-only main...HEAD -- backend/src/main/resources/db/migration` is empty; V98-V100 untouched.

### Phase 2: Code Review — PASS (with one test-quality finding, see CR1)

Gates, all re-run by me at `85c53504`:

| gate | result |
| --- | --- |
| `cd backend && sbt test` | `Tests: succeeded 3896, failed 0` — `[success] Total time: 337 s` |
| `npm test` | 256 suites / 2655 tests passed (+ helio-mcp 24/238) |
| `npm run lint` | clean (`--max-warnings=0`) |
| `npm run typecheck` | clean |
| `npm run format:check` | clean |
| `npm run check:schemas` | in sync (74 schemas / 48 protocol files) |

Code quality: no inline FQNs, no `any`, no dead code, no TODO/FIXME introduced, comments carry
reasoning rather than restating the code. The refactor is behaviour-changing by design and the
diff matches the design decisions cited in it. Scaladoc, the protocol comment and the JSON-Schema
`description` are all updated consistently to the union-of-every-root's-trunk contract.

Mutation evidence (task 7 of the brief): the task 4.3 mutation's red is real and isolated — I
confirmed by reading that reintroducing `firstRootIdAction` for every partition head makes root 2's
head carry root 1's id, producing two parentless heads under root 1 and no head for root 2. AC1 and
AC2 are two genuine axes (chain-order-within-a-root vs. head-marker/membership), not one axis twice.
See the non-blocking note on which of AC2's two axes actually fired.

Finding (blocking, but rooted in Phase 3 — see CR1): the new frontend test
`PipelineDetailPage.test.tsx:747` is constructed so that the moved step is never the lane head
(its own comment says so: *"never touching a1's head position"*). That is exactly the case that
fails live. The test therefore passes on code that is broken for the interaction the UI actually
offers.

### Phase 3: UI Review — FAIL

Servers started via `scripts/concertino/start-servers.sh` (`assert-phase.sh servers` → `PASS`).

**Reproduced defect: a multi-root reorder from the UI fails with a 422 and an error toast.**

Fixture (dev DB, pipeline `924b1996-c1f9-42a1-ac8d-3181e12aa1d8`, "HEL-968 eval multi-root"):
root 1 (`7e4d7dc3…`) trunk `select c52f9157 → limit c35223f5` with a `union` tail `a4b7d371`
(position 1) branching off the trunk; root 2 (`04824d4b…`) trunk `limit 4605ab3a`.

Steps: open the pipeline detail page → click the one enabled **"Move step up"** (root 1's second
trunk step).

Observed: `PUT /api/pipelines/…/steps/order` → **422**, toast:

```
Failed to reorder steps: orderedTrunkIds must be exactly the permutation of the union of every
root's current trunk step ids: unexpected step ids (tail ids are not accepted here, only current
trunk ids across all roots): a4b7d371-4dea-485b-af03-dacaa9070145
```

Captured request body (instrumented `fetch`/`XHR`):

```json
{"stepIds":["4605ab3a-…","c52f9157-…","a4b7d371-…","c35223f5-…"]}
```

— i.e. the **tail id `a4b7d371` is in the payload**, and root 1's entire chain is emitted *after*
root 2's head in raw array order.

Backend is not at fault: replaying the correct payload
`["c35223f5…","c52f9157…","4605ab3a…"]` by hand returns **200** with root 1's head marker moved to
`c35223f5` and root 2's head untouched — exactly AC1/AC2. Nothing is written on the 422 (verified:
`GET /steps` identical before and after).

Root cause (diagnosed, matches the captured payload signature exactly):
`stepTree.ts:263-266` (`reorderLane`) relinks the reordered lane's new head to
`parentStepId: lane.parentStepId` (i.e. `undefined` for a root lane) **but never moves the lane's
`rootId` onto that new head**. In `buildLaneGraph` (`stepTree.ts:104-116`) a step with no parent
and no `rootId` falls into `unassignedRootLevel`; the rescue at `:151` is gated on
`rootStepsByRootId.size === 0`, which is false on a multi-root pipeline (the *other* root's head
still carries its id). So root 1 gets no root-level lane at all — an `empty-root:` lane is
synthesised at `:191-202` — the new per-root lookup in `usePipelineDetailPage.ts:1004-1009` finds
that **empty** lane and contributes nothing for root 1, and root 1's three orphaned steps
(including the tail) are swept into the first non-empty lane (root 2's) by the totality sweep at
`:207-224`. That sweep is why the tail id ends up in the payload, and why the ids appear in raw
array order.

Scope: this is HEL-973's, not pre-existing debt. On a single-root pipeline the `:151` rescue keeps
this path working; before this change the multi-root route was fenced with a 400 and unreachable.
Unfencing it is precisely this ticket's deliverable, and the unfenced UI path is broken on the
first interaction it offers.

Other Phase 3 checks: page renders both roots correctly at 1440 wide, "Move step up/down" are
disabled correctly on the head/tail of each lane, the failure surfaces a visible error toast (not a
blank screen), and no unhandled exception occurs. The only console errors were the 422 above and a
pre-existing `GET …/schedule` 404 (unrelated, present before the interaction).

### Overall: FAIL

### Change Requests

1. **Fix the multi-root reorder payload so a lane-head move does not orphan the root.** The new
   head of a reordered root lane must carry that root's `rootId` in the optimistic `Step[]`, so
   `buildLaneGraph` attaches it to its root instead of dropping it into `unassignedRootLevel`. The
   natural place is `frontend/src/features/pipelines/state/stepTree.ts:263-266` (`reorderLane`):
   when `lane.parentStepId === undefined`, the `i === 0` step must also get `rootId: lane.rootId`
   (and the step that *lost* the head slot must lose its `rootId`, mirroring the backend's
   head-marker semantics). Verify against the live repro above — the payload must become exactly
   `[<root1 trunk ids in new order>, <root2 trunk ids>]` with no tail id.
2. **Make `usePipelineDetailPage.handleReorderSteps` fail loudly rather than silently contribute
   nothing when a root has no resolvable trunk lane** (`usePipelineDetailPage.ts:1004-1009`).
   Today `trunkLane?.steps ?? []` turns "this root's chain was orphaned" into a silently truncated
   payload, which is how CR1's defect reached the wire as a *wrong* request instead of an obvious
   one. At minimum, do not send a payload derived from a root whose lane came back empty while that
   root demonstrably has steps.
3. **Extend `PipelineDetailPage.test.tsx:747` to cover the head-moving case.** The current fixture
   deliberately avoids moving the lane head (see its own comment), which is the only case that
   fails. Add an assertion that moving root 1's *second* trunk step into the head slot on a
   two-root pipeline with a tail produces a payload of exactly both roots' trunk ids and no tail
   id, and confirm it goes red against the current implementation before the CR1 fix.

### Non-blocking Suggestions

- In the AC2 spec test (`PipelineStepRepositorySpliceSpec.scala:672-694`), `headsAfter` is computed
  *before* the `ownershipAfter shouldBe ownershipBefore` assertion runs, so under the task 4.3
  mutation the failure reported in `files-modified.md` came from `headMarkerMap`'s internal
  head-count clue, not from axis (a). Axis (a) is genuinely fireable (a flat-chain implementation
  makes it the first failure), but the executor's transcript does not actually demonstrate it.
  Asserting `ownershipAfter shouldBe ownershipBefore` immediately after computing it — before
  `headsAfter` — would make each axis's red independently observable.
- `PipelineStepRepositorySpliceSpec.scala:688-690` calls `owningRootMap(pid, all)` four times (and
  twice more in AC1), each doing its own SQL round trip. Hoisting it to a `val` would be clearer.
- Dev-DB state note for the skeptic: I added two steps to the shared-dev-DB pipeline
  `924b1996-c1f9-42a1-ac8d-3181e12aa1d8` and left them in place so the repro above is directly
  reusable.
