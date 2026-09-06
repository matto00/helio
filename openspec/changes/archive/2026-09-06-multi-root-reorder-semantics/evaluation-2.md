## Evaluation Report — Cycle 2 (evaluation-2.md)

Commit reviewed: `1f4a50d0` (on `85c53504`). Every gate re-run by me; every change request
re-verified by my own live repro / my own mutation, not from `files-modified.md`.

### Phase 1: Spec Review — PASS

Issues: none.

The cycle-2 diff touches only `stepTree.ts`, `usePipelineDetailPage.ts`,
`PipelineDetailPage.test.tsx` and the assertion ORDER inside the AC2 spec test. Re-confirmed that
none of cycle 1's passes regressed:

- Per-root partition relink (`PipelineStepRepository.scala:660-679`) — byte-identical to cycle 1.
- AC2's `owningRootMap` still walks `parentStepId` + raw SQL `root_id`, independent of
  `trunkOfRoot`/`rootIdsOf` — only the assertion order changed, the derivation did not.
- `firstRootIdAction` still absent from `reorderTrunkInternal`'s body (`sed -n '641,690p' … | grep`
  → zero hits); the definition and all out-of-scope call sites intact.
- HEL-913's fence and its `listRootDataSourceIdsInternal` call still gone from `reorderSteps`;
  other call sites intact.
- `git diff --name-only main...HEAD -- backend/src/main/resources/db/migration` still empty —
  no migration added or edited.
- Request shape still `stepIds` only, no `rootId`: whole-pipeline semantics unchanged.

### Phase 2: Code Review — PASS

Gates, all re-run by me at `1f4a50d0`:

| gate | result |
| --- | --- |
| `cd backend && sbt test` | `Tests: succeeded 3896, failed 0` — `[success] Total time: 323 s` |
| `npm test` | 256 suites / **2656** tests passed (+1, the CR3 test) |
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm run format:check` | clean |
| `npm run check:schemas` | in sync |

CR1's fix (`stepTree.ts:263-273`) is the right shape: it mirrors V98's head-marker semantics on the
client (`rootId` on the `i === 0` step of a ROOT lane, cleared on every other member) and is
explicitly a no-op for non-root lanes, where no step ever carries `rootId`. The comment states the
failure mode it closes rather than restating the code.

**AC2 axis independence — verified, not assumed.** The reordering at
`PipelineStepRepositorySpliceSpec.scala:715-723` now asserts `ownershipAfter shouldBe
ownershipBefore` immediately after computing it, before `headMarkerMap` is even called. The
executor's re-run transcript shows the failure arriving from line 721 (the map-equality assertion)
with all four step ids collapsed onto one merged root — that is axis (a) firing on its own, which
cycle 1 could only infer. The two axes are now demonstrably distinct observations, not one axis
wearing two labels.

### Phase 3: UI Review — PASS

Servers via `scripts/concertino/start-servers.sh` (`assert-phase.sh servers` → `PASS`).

Note: my own `sbt test` run wiped the shared dev DB mid-review, so cycle 1's fixture is gone. I
rebuilt an equivalent one through the live API + UI: pipeline
`bed244a7-d861-4632-b4b1-62b109deaa9a` ("EVAL973 c2 multi-root"), root 1 (`8fdfa227…`) trunk
`limit d12a9dd9 → rename 3a5ae03f → filter ceae4e65` with a real tail `limit 94e129da` (position 1,
created via the UI's own "Branch this step into a new lane"), root 2 (`c27fe845…`) trunk
`rename 3f182273`.

**CR1 — the cycle-1 repro no longer reproduces.** Clicking "Move step up" on root 1's *second*
trunk step (the head-moving case that 422'd in cycle 1) now sends:

```json
{"stepIds":["3a5ae03f…","d12a9dd9…","ceae4e65…","3f182273…"]}
```

— exactly root 1's trunk in its new order followed by root 2's trunk, **no tail id** — and the
request returns **200**, with no error toast. Persisted result: root 1's head marker moved to
`3a5ae03f` (carrying `8fdfa227`), the tail `94e129da` followed its trunk step, and root 2's head
`3f182273` is untouched with its own root id. Membership invariant holds end to end.

Repeated with the inverse interaction ("Move step down" on the new head): payload
`["d12a9dd9…","3a5ae03f…","ceae4e65…","3f182273…"]`, 200, original order restored, root 2 again
untouched. The only console error in either flow is a pre-existing, unrelated
`GET …/schedule` 404.

**CR3 — I confirmed the red myself,** rather than reading the executor's transcript: I restored
`stepTree.ts` to its `85c53504` version and ran the new test in isolation —

```
● … moving a root's SECOND trunk step into the head slot still produces exactly both roots'
  trunk ids with no tail id
    Expected value: not "tail1"
    Received array:     ["tail1", "b1", "a1", "x1"]
```

— then restored the fixed file (`git status` clean afterwards). The test genuinely fails against
the pre-fix implementation and its failure mode is exactly CR1's orphaned-root signature.

**CR2 — implemented as asked.** `usePipelineDetailPage.ts:1004-1027` builds a `previousGraph` from
`previousOrder`, and for any root whose post-reorder trunk lane is empty *while it demonstrably had
steps before*, pushes an error toast and returns — before the optimistic `setSteps` and before any
network call, so a refusal leaves nothing to revert. That is the literal ask ("do not send a
payload derived from a root whose lane came back empty while that root demonstrably has steps").

Other Phase 3 checks: both roots render; move up/down are correctly disabled at each lane's head
and tail; failures (when induced) surface a visible toast rather than a blank screen; no layout
overflow at 1440 / 1100 / 768 / 360 (`scrollWidth === clientWidth`, all four step sections still
rendered).

### Overall: PASS

### Non-blocking Suggestions

- The CR2 refusal branch (`usePipelineDetailPage.ts:1018-1026`) has **no test coverage** — nothing
  in the suite exercises the toast or the early return, and with CR1 fixed the path is not
  reachable from any known fixture. It is reasonable defense-in-depth, but consider a small unit
  test that stubs a graph missing a root's lane, so a future refactor cannot silently delete the
  guard. (Non-blocking: CR2 asked for the guard, and the guard exists and is correctly placed.)
- That toast interpolates a raw root UUID (`root ${r.id} lost its trunk lane`), which is
  developer-facing text in a user-facing surface. A root's `dataSourceName` (already on
  `PipelineRootSummaryResponse`) would read better. Flagged for the skeptic's judgment, not a gate.
- Dev-DB note: the shared dev database was reset by my `sbt test` run during this review. The
  fixture described above (`bed244a7-d861-4632-b4b1-62b109deaa9a`) is left in place for the
  skeptic to reuse.
