## Skeptic Report — final gate (round 2, skeptic-final-5.md)

Axis: backend data-integrity and pipeline-structure correctness (dimension-split review).
Re-check of round 1's single REFUTE (`skeptic-final-2.md` CR1, `handleInstantiateShape`
phantom second tail). Cold instance; every conclusion below is first-hand.

### Ground truth re-established

- `git log`: HEAD = `9b3d0699`, tree clean (`git status --porcelain` empty).
- `git diff 649baa21..HEAD --stat` — **zero backend/Scala or schema changes this round**
  (`git log 649baa21..HEAD -- backend/` empty). The executor's "item 1's fix was
  frontend-only" claim is TRUE. `sbt test` therefore genuinely not needed.
- Backend PID 1706240 (this worktree's `backend/`, started 14:32). Last backend-touching
  commit remains `03ceb034` (a non-behavioral `attachTailInternal` type tightening); the
  last behavioral backend commit `72b0fc10` is included. Live probes below are current.
  `curl :9247/health` → `{"status":"ok"}`; `curl :6340` → 200.

### What I verified (with evidence)

**1. The fix, read as a diff (`git show 44cfc8b9`), not as a claim.** Two layers:
- `PipelineRiverView.tsx:305-310,457-467` — the bottom "Add Outputs from a shape" trigger
  now computes `trunkLastHasTail` from `stepTree.tailsByStepId[trunkLast.id]` and sets
  `disabled` + an explanatory `title`.
- `usePipelineDetailPage.ts` `handleInstantiateShape` — the shape's first step is now
  created with `attachAsTail: false` unconditionally (the `isFirstStep && anchorHasChild`
  expression is gone), plus a defensive `anchorHasTail` early-return with an error toast.

**2. Live reproduction of the original defect's anchor state, against the real backend**
(authenticated session, real `POST /api/pipelines/:id/steps` + `GET .../steps`):

- *The hazard is real and the refusal is load-bearing, not cosmetic.* On `A → B` with tail
  `T` on trunk-last `B`, issuing what the new handler would send if the gate were bypassed
  (`{parentStepId: B}`, no `attachAsTail`) produced:
  ```
  before: 27b0de72 p0 ROOT | 481b1255(B) p0 27b0de72 | bf4b46d3(T) p1 481b1255
  after : 27b0de72 p0 ROOT | 481b1255(B) p0 27b0de72 | 942c1db8(S) p0 481b1255
                                                      | bf4b46d3(T) p1 942c1db8   <-- T REPARENTED
  ```
  i.e. `spliceInsertAtInternal` silently reparents the pre-existing tail onto the new step.
  The `anchorHasTail` refusal is exactly what prevents this second, different defect —
  the fix is not merely trading one bug for a disabled button.
- *The healthy path still works.* Trunk-last `B` with no tail, shape chain `S1 → S2`
  appended: server order `A, B, S1, S2`, every child `position 0`, derived **server trunk
  = [A, B, S1, S2]**. Client `buildStepTree` on the same array walks single-`position-0`
  children → **client trunk = [A, B, S1, S2]**. Server and client now MATCH. The round-1
  mismatch (server `[A,B]` vs client `[A,B,S]`) is gone.
- *Round-1 CR item (b) — the "append at end of flat array / No resync needed here" hazard
  — is genuinely moot under the new invariant, verified live rather than assumed.* On a
  trunk with a MID-trunk tail (`A` has tail `T`, trunk-last is `B`), `executionOrder`
  returns `[A, T, B]` — a node's tail is emitted before its trunk continuation, so a
  childless trunk-last anchor is always the LAST array element. Appending the new chain is
  therefore the correct flat-array position. After the append: `[A, T, B, S]`; client
  `buildStepTree` takes A's `kids.length>1` branch → tail = `T` (earlier index), trunk
  continues to `B` then `S`; trunk `[A,B,S]` matches the server. The updated
  "No resync needed here" comment is now accurate.

**3. Is the fix SOUND or a narrow band-aid?** Sound, on my judgment:
- *Coverage of the reachable state space:* `grep -rn "setShapePickerAnchorStepId"` shows
  exactly two anchor sources — `undefined` (empty-pipeline state, `PipelineRiverView.tsx:344`)
  and trunk-last (`:473`). No mid-trunk anchor exists, so the handler's doc comment is
  factually correct and the gate covers 100% of reachable anchors.
- *No other scenario regressed:* under the new code, for every reachable anchor
  `attachAsTail` was ALREADY going to be `false` (empty pipeline: no anchor; trunk-last
  without a tail: no child). The changed line is provably behavior-identical on every
  non-refused path — the only behavior change is the refusal itself. Every other valid
  shape-instantiation scenario is untouched, and the existing shape tests (empty-state
  seed, append-after-existing-step, mid-loop failure, 422-from-expand) all still pass.
- *UX cost of disabling:* acceptable as an interim constraint. Single-tail-per-node is
  already this ticket's established invariant, enforced identically on the "+ tail"
  affordance. The disabled button carries a `title` naming both workarounds, and the
  adjacent "+ Add transformation step" button (not disabled) makes the workaround one
  click. I would not block delivery on this.

**4. Coverage is real, and red-then-green by construction.** Three new tests, all confirmed
to actually run (not skipped) via targeted `-t` runs:
- `PipelineRiverView.test.tsx` "trunk-last-tail gate" — 2 tests (enabled-when-no-tail /
  `toBeDisabled()`-when-tail). Pre-fix the button had **no `disabled` prop at all** (see the
  diff), so `toBeDisabled()` could not have passed — non-vacuous by construction.
- `PipelineDetailPage.test.tsx` "disables 'Add Outputs from a shape' once the trunk-last
  step already has a tail" — same, at the integration level, and additionally asserts
  `expandPipelineShapeMock` was never called.
- `stepTree.test.ts` new case is explicitly documentation of the invariant (it would pass
  pre-fix); the commit and comment say so honestly rather than dressing it up as a guard.

**5. Independent re-check of the non-goal-waiver primitives and the CR1-CR11 chain.**
`git log ea3da445..HEAD -- backend/` is empty; the last touch to
`.../persistence/pipelines/PipelineStepRepository.scala` and to
`PipelineStepRepositorySpliceSpec.scala` is `03ceb034`, i.e. BEFORE round 1's reviewed HEAD.
`attachTailInternal` / `attachTailInternalAction` / `reorderTrunkInternal` /
`spliceInsertAtInternal` all still present at the same definitions I read in round 1; the
mutation-proof specs are byte-identical to the ones I verified non-vacuous then. Nothing
since round 1 touched them unexpectedly. The `handleInstantiateShape` row in design.md's
enumeration table (`| No | n/a | OK |`) is now factually CORRECT under the new gate
(childless anchor → `spliceInsertAtInternal` reparents nothing; append is the right index).

**6. Full gate suite, re-run fresh by me:**
```
npm run lint         -> clean (eslint src --max-warnings=0, no output)
npm run format:check -> "All matched files use Prettier code style!"
npm run typecheck    -> tsc --noEmit, clean
npm test             -> 282 suites / 3013 tests passed
npm run build        -> succeeded (PWA precache 28 entries)
sbt test             -> not run; zero backend diff this round (justified above)
```

**Measurement stability note.** One intermediate probe batch returned garbled output; I
re-ran the diagnostic rather than concluding, and it was `HTTP 429 Rate limit exceeded`
from the dev rate limiter (`RATE_LIMIT_REQUESTS_PER_WINDOW`), not a defect. Re-ran after
the window and got the clean readings recorded above.

### Verdict: CONFIRM

Round 1's finding is genuinely fixed, at the right layer, with the reparenting hazard the
refusal actually prevents demonstrated live. Ships.

### Non-blocking notes

- No test asserts the changed argument itself (`createPipelineStep(..., false)`) for the
  **trunk-last** anchor path, nor the `anchorHasTail` refusal toast. Both are unreachable
  given the UI gate, and the empty-state test does assert the 6th arg — but a direct
  handler-level assertion would make a future re-introduction of `attachAsTail` on this
  path fail loudly instead of relying on the gate holding.
- design.md's enumeration table still shows `handleInstantiateShape | No | n/a | OK` with
  no annotation of round-1 CR1 or the new gate. The corrected reasoning lives (thoroughly)
  in the code comment. Now-accurate but historically silent; a `(CR1, round 1)` marker in
  the Verdict column would match how CR9/CR10/CR11 are recorded on the other rows.
- `ShapeInstantiateStep.tsx:232` is still absent from the enumeration table (round-1
  non-blocking note, unaddressed). Still safe today for the reason given then.
- Carried forward from round 1, unchanged and still non-blocking: `attachTailInternal`
  permits unbounded tails per node (the single-tail invariant lives only in the UI — this
  round's fix adds a second UI-layer guard rather than a service-layer one); `tailsOf`'s
  `expand` still uses `childrenOf(...).headOption` rather than the explicit `position == 0`
  rule.
