## Skeptic Report — design gate (round 5, skeptic-design-5.md)

### What I verified (with evidence)

1. **Round 4's exact three-click trace no longer reproduces against the unconditional-bump fix.**
   Re-read `design.md` D9 (`openspec/changes/optimistic-pending-writing-panel/design.md:65-104`) and
   replayed round 4's trace against the new mechanism (success AND failure both unconditionally bump
   `reconcileGeneration`, dispatch stays success-and-empty-only):
   - A fires → map `{A:1}`, displayed X+1.
   - A succeeds → remove A → map `{}` → gen 0→1 (unconditional) → since empty, `myGen=1`, dispatch F1.
   - B fires → map `{B:1}`, displayed X+2. C fires → map `{B:1,C:1}`, displayed X+3.
   - B succeeds (commits) → remove B → map `{C:1}` (non-empty) → gen **1→2** (this is the round-4
     fix: previously this branch never touched gen because the map didn't empty; now it does). No
     dispatch (map still non-empty).
   - C fails (never committed) → remove C → map `{}` (empty) → gen **2→3** (unconditional, failure
     branch). Subtract only C's delta: X+3−1 = X+2. No dispatch (failure branch never dispatches).
   - F1 resolves. Guard: `myGen(1) === reconcileGeneration(3)`? **False.** F1 is correctly discarded.
     Displayed stays X+2, which is exactly the real committed total (A+B). **Round 4's defect is
     closed** — the guard now sees B's success via the unconditional bump, even though B's own
     removal didn't empty the map.

2. **Independent adversarial interleaving — dispatch/invalidate/dispatch/invalidate/apply chain (task
   2 of the brief).** Constructed: A fires+succeeds → gen 0→1, dispatch F1 (`myGen=1`), map empty. B
   fires+succeeds while F1 still in flight → gen 1→2, map empties again → dispatch F2 (`myGen=2`). F1
   resolves → `myGen(1) !== gen(2)` → correctly discarded (F1 predates B's commit). C fires+succeeds
   while F2 still in flight → gen 2→3, dispatch F3 (`myGen=3`). F2 resolves → `myGen(2) !== gen(3)` →
   correctly discarded. F3 resolves with nothing further having happened → `myGen(3) === gen(3)` and
   map still empty → **applies**, reflecting A+B+C. This confirms (a) the guard correctly invalidates
   every superseded fetch in a chain of overlapping fetches, (b) it does **not** degenerate into
   discarding every fetch — the last-dispatched fetch in an otherwise-quiet window still applies, so
   the mechanism is not "self-defeating." I also re-verified the base single-burst case (dispatch,
   nothing else happens, fetch applies) still holds — unaffected by the unconditional-bump change,
   since no intervening settle exists to bump `reconcileGeneration` past `myGen`.

3. **A genuine, narrower residual effect of the fix — checked against D6/C5, found non-blocking.**
   Traced: A fires+succeeds → gen 0→1, dispatch F1 (`myGen=1`), map empty, real total now X+1. Before
   F1 resolves, a concurrent OTHER user's write lands server-side (real total → X+6), invisible to this
   session's map. B (this session) fires → map `{B:1}` → displayed X+2. B **fails** (never committed)
   → remove B → map `{}` (empty) → gen 1→2 (unconditional, failure branch) → subtract B's delta:
   X+2−1 = X+1 (still correct for *this session's own* writes). F1 now resolves — regardless of what
   it fetched, `myGen(1) !== gen(2)` → discarded. Net effect: this quiesce point (map genuinely empty,
   burst genuinely over) concludes with **zero** reconciliation fetches applied, so the other user's
   +5 stays invisible until *this session's own next successful quiesce* re-dispatches a fresh fetch.
   This is strictly a round-4-fix side effect: pre-round-4, B's failure would not have bumped gen at
   all, so F1 would still have passed the guard and applied at this exact point. I confirmed this is
   **not a correctness violation**: the session's own local bookkeeping (`baseline + Σ successful
   deltas` with failed ones subtracted back out) is exact and self-consistent independent of whether
   any fetch is discarded — discarding a fetch never produces a *wrong* displayed value, only a
   delayed pickup of an *external* writer's concurrent commit. D6/C5 promise concurrent writers
   "legitimately appear in the refetched aggregate" and show up in "a future reconciliation" — neither
   promises immediacy, and a future reconciliation is guaranteed the next time this session's own
   burst ends on a success (an inescapable eventuality for an active counter control). I checked
   design.md for overclaiming language that this trace would falsify (`grep -n
   "guarant\|always\|eventually"`) — the two hits (`design.md:60,81`) are about the display never
   regressing below what's shown, and about a *dispatched* fetch's own query correctness at dispatch
   time, respectively; neither claims every dispatched fetch is guaranteed to be *applied*, so nothing
   in the document is falsified by this trace. This is a real but bounded widening of the
   already-documented "quiesce-gating delays reconciliation" risk (`design.md`'s Risks section,
   bullet 2) rather than a new class of defect — noted below as a non-blocking documentation
   suggestion, not a Change Request.

4. **`reconcileGeneration` dispatch-time correctness re-verified against the backend.** Re-read
   `backend/src/main/scala/com/helio/api/routes/panels/PanelRoutes.scala:44-53` (`completeSubmit`
   only completes the HTTP response after the `Future[Either[...]]` resolves) and
   `backend/src/main/scala/com/helio/services/panels/PanelService.scala:117-122` — unchanged since
   round 4, still true that a success response is never sent before the write commits, which is the
   premise the quiesce-gated dispatch (D9, D5) depends on for "the triggered fetch is guaranteed to
   include all of them" (`design.md:81`).

5. **`workflow-state.md` / `tasks.md` bookkeeping in sync.** Extracted `CONSTRAINTS[C8].text` from
   `workflow-state.md` and the `[C8]` line from `tasks.md`'s Standing Constraints programmatically,
   normalized whitespace/dash variants, and diffed: the only difference is backtick code-formatting
   present in `tasks.md` (e.g. `` `reconcileGeneration` ``) and absent in the plain-text
   `workflow-state.md` copy — byte-equivalent modulo markdown formatting, as required.
   `CONSTRAINT_REVIEWS`'s last entry (`{"verdict_seq":5,"gate":"design","round":4,"verdict":"REFUTE","promoted":[]}`)
   correctly reflects round 4's REFUTE with no new constraint promoted (the fix is an amendment to the
   existing C8 text, not a new constraint) — consistent with `skeptic-design-4.md`. No prior report's
   evidence directory or mtimes were relied on here; this comparison is by direct file-content diff
   (self-authenticating), not temporal/positional inference, so no gate-defect disclosure applies.

6. **`design.md` line budget and internal coherence.** `wc -l design.md` → exactly 150 lines, within
   budget. Grepped every `reconcileGeneration` reference in `design.md` (`:68,73,74,83,87,90,95`) — all
   consistent with the unconditional-bump-on-every-settle model; no stale reference to the old
   "success-driven-empty-only" bump rule remains anywhere in the document. `tasks.md` 2.3/2.4 and the
   `form-panel-submit` spec delta's new scenario ("A sibling's success that doesn't empty the pending
   set still invalidates a stale fetch") match design.md's D9 text and round 4's trace precisely.
   `design.md`'s Risks section carries the new, explicitly-labeled non-blocking D7/C2 rollback-vs-network-failure
   note verbatim as described in the brief, correctly flagged as pre-existing/out-of-scope.

### Verdict: CONFIRM

### Non-blocking notes

- (from item 3 above) `design.md`'s Risks section could optionally gain one more sentence
  distinguishing "a long-running burst delays reconciliation until it quiesces" (already documented)
  from the narrower case surfaced this round: a burst that quiesces via a **trailing failure** after
  an earlier **success** already dispatched a now-superseded fetch concludes with *zero* reconciliation
  fetches applied at that quiesce point, so an external concurrent writer's commit during that window
  stays invisible until this session's own next successful quiesce. This never produces an incorrect
  displayed value for the session's own writes (local bookkeeping stays exact independent of any
  discard) and is self-correcting on the session's next successful action — not a defect, just an
  under-documented corollary of the round 4 fix's deliberately conservative "any settle invalidates an
  in-flight fetch" rule. Purely optional; does not block.
