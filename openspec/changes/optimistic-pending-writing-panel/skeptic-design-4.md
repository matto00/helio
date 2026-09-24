## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

1. **Round 3's own trace no longer reproduces against the new `reconcileGeneration` + map-empty
   guard.** Re-read `design.md` D9 (`openspec/changes/optimistic-pending-writing-panel/design.md:65-104`)
   and re-ran round 3's exact trace (click A fires and succeeds quickly, dispatching reconciliation
   fetch F1; click B fires before F1 resolves; F1 resolves with a value that predates B):
   - A fires → map `{A:1}`, displayed X+1.
   - A succeeds → map `{}` → `reconcileGeneration` 0→1, `myGen=1`, dispatch F1 (reads X+1).
   - B fires before F1 resolves → map `{B:1}`, displayed X+2.
   - F1 resolves. Guard check: `myGen(1) === reconcileGeneration(1)` — true, but **map is `{B:1}`,
     non-empty** — guard fails, F1's result is discarded. Displayed stays X+2.
   - B settles (success) → map `{}` → gen 1→2, `myGen=2`, dispatch F2, reads X+2, both guards pass,
     applies. Displayed sequence: X+1 → X+2 → X+2 (no dip). **Round 3's trace is genuinely closed.**

2. **The "response only sent after commit" premise re-verified.** Re-read
   `backend/src/main/scala/com/helio/api/routes/panels/PanelRoutes.scala:44-53` and
   `backend/src/main/scala/com/helio/services/panels/PanelService.scala:117-136` again — still true,
   nothing in this round's diff touches this code path.

3. **A new, reproducible interleaving defeats the two-part guard (Blocking).** The guard's two
   conditions (`myGen === reconcileGeneration`, map currently empty) are together **not sufficient**
   to detect every state change that could invalidate an in-flight reconciliation fetch. The root
   cause: only the **success** branch of D9 ever increments `reconcileGeneration` or dispatches a new
   fetch, and only when a success's own token-removal happens to leave the map empty
   (`design.md:75-76`: "**Success:** remove the token from the map. **Only if that leaves the map
   empty**, increment `reconcileGeneration`... and call `fetchFieldAggregate`"). The **failure**
   branch (`design.md:95-98`) removes its token and subtracts its own delta, but never touches
   `reconcileGeneration` and never dispatches anything — even when its own removal leaves the map
   empty. This creates a blind spot: **a sibling click that fires, succeeds, and commits while a
   different click is still outstanding never re-arms anything (because the map wasn't empty at the
   moment it succeeded), and if that other outstanding click subsequently *fails* rather than
   succeeds, the map becomes empty without any generation bump — so an *earlier*, already-in-flight,
   now-stale fetch can pass both guard checks and get applied, silently discarding the sibling's real,
   already-committed, already-displayed contribution, with nothing left to ever correct it.**

   Concrete trace (three overlapping clicks, mixed success/failure — exactly the shape task 2 of the
   brief asked me to hunt for):
   - Displayed = X, real server total = X.
   - Click A fires (`delta=+1`). Map `{A:1}`. Displayed = X+1.
   - A succeeds (commits; real = X+1). Remove A → map `{}` → empty → `reconcileGeneration` 0→1,
     `myGen=1`, dispatch **F1** (a live `GET .../rows/aggregate`).
   - Before F1 resolves, click B fires (`delta=+1`). Map `{B:1}`. Displayed = X+2.
   - Before F1 resolves, click C fires (`delta=+1`). Map `{B:1,C:1}`. Displayed = X+3.
   - B's request succeeds (commits; real = X+2). Remove B → map `{C:1}` — **non-empty, so per the
     literal Success-branch text no generation bump and no new fetch dispatched.** Displayed stays
     X+3 (success doesn't otherwise touch displayed — it was already advanced when B fired).
   - C's request is **rejected** by the server (genuine validation failure, never committed). Remove
     C → map `{}` (empty) — **per the literal Failure-branch text, this never bumps
     `reconcileGeneration` and never dispatches a fetch.** Subtract only C's own delta from the
     *current* displayed value: X+3 − 1 = X+2. This is locally self-consistent (real committed total
     from A+B is indeed X+2) — **until F1 resolves.**
   - F1 finally resolves. It was dispatched right after A's success, before B's write reached the
     server — it is entirely plausible (a live `GET` racing a concurrently-dispatched `POST`, no
     ordering guarantee between them) that F1's underlying `SUM` query executed on the server
     *before* B's row committed, so F1 reports **X+1**, a value that predates B's now-committed
     write. Guard check at resolution: `myGen(1) === reconcileGeneration(1)`? **True** — nothing ever
     bumped the generation counter past 1, because B's success didn't empty the map and C's failure
     doesn't bump generation at all. Map currently empty? **True** — map is `{}` right now. **Both
     guards pass.** F1's stale result is applied: displayed is set to **X+1**.
   - **Displayed drops from X+2 (correct) to X+1 (wrong — B's real, committed +1 has been silently
     discarded).** No further click will occur (the burst has ended) and no further success-driven
     empty-transition will ever fire to correct it — this is not "fixed by the next natural quiesce"
     the way D9's own reasoning for a discarded result assumes (`design.md:92-94`, "whichever event
     invalidated it... will itself drive a future correct reconciliation once things quiesce again")
     because in this trace **nothing did invalidate F1 in the guard's own terms** — the guard has no
     way to see B's successful, map-non-emptying commit at all. The user is left staring at a value
     that is durably wrong, with no future event scheduled to correct it.

   This reproduces the exact same class of defect rounds 2 and 3 already found (a stale fetch result
   silently overwriting a value that has since legitimately advanced) — relocated to a third layer:
   not "a stale submit-success fetch" (round 2), not "the reconciliation fetch's own unguarded
   resolution racing a *pending* new click" (round 3), but **the reconciliation fetch's resolution
   racing a sibling click that has already *succeeded and committed*, whose success never registered
   with the guard because it didn't itself empty the map, combined with the map's next emptying event
   being a failure that (by design) never re-arms anything.**

   I also checked the two-click and simpler variants to confirm this genuinely needs three clicks with
   a mixed outcome (matches the brief's framing that a fourth defect, if real, would need this shape):
   a plain two-click A-succeeds/B-fails sequence is safe — B's failure-driven rollback subtracts
   exactly what B added, and since B never committed, there is no committed value for a stale fetch to
   miss. The defect requires a *middle* click that commits successfully without itself causing an
   empty-map transition (because a *further* click is still outstanding at that moment), so its
   success is invisible to the generation counter.

4. **Answering the brief's explicit question 3 directly: no, not every settle-to-empty transition
   unconditionally dispatches a new fetch.** Only a *success*-driven empty transition does
   (`design.md:75-76` vs. `:95-98`). In the narrowest case (a burst that ends on a failure with no
   stale fetch already in flight) this alone doesn't produce a visible error, because the
   failure-branch's relative-subtraction happens to stay locally correct on its own. But combined with
   an *already in-flight* earlier fetch (item 3 above), this asymmetry is exactly what lets a stale
   result slip through the guard undetected — the guard's blind spot and the "fetch dispatch is
   success-only" design choice are two sides of the same gap.

5. **`aria-busy` scope decision does not reopen any HEL-1090 requirement.** Read
   `frontend/src/features/panels/ui/form/FormPanelView.tsx:306-319` (HEL-1090's `aria-disabled`
   vs. native-`disabled` requirement on the multi-field submit button, "focus SHALL remain on or
   return to the submit control") and `frontend/src/features/panels/ui/form/CounterControl.tsx:33-90`
   (current `role="spinbutton"` props: no `aria-busy` prop exists today). Grepped
   `openspec/specs/form-panel-submit/spec.md` and the whole frontend tree for any pre-existing
   `aria-busy` requirement — none exists; this is a wholly new addition scoped to the compact-counter
   `spinbutton`, and D9 explicitly states the full multi-field submit button/its HEL-1090 focus
   behavior is untouched. No regression found here.

6. **`workflow-state.md`/`tasks.md` bookkeeping is in sync.** `CONSTRAINTS` C8 text is byte-identical
   between `workflow-state.md:39` and `tasks.md:41`. `CONSTRAINT_REVIEWS`'s last entry is
   `{"verdict_seq":4,"gate":"design","round":3,"verdict":"REFUTE","promoted":[]}`, matching round 3's
   REFUTE with no new constraint promoted, consistent with `skeptic-design-3.md`'s own description.
   `SKEPTIC_CYCLE:3`, `LAST_SKEPTIC_VERDICT:REFUTE` match. Methodology carryover is sound.

### Verdict: REFUTE

### Change Requests

1. **(Blocking)** Close the gap identified in item 3 above: the guard on a reconciliation fetch's
   resolution must be invalidated by *any* settle event since the fetch was dispatched, not only by
   (a) a newer fetch having been dispatched or (b) the map being currently non-empty. Concretely,
   `design.md` D9 needs an explicit amendment so that `reconcileGeneration` (or an equivalent
   invalidation signal) is bumped on **every** token removal from the map — success or failure alike
   — not only on a success-driven transition to empty. The *dispatch-a-new-fetch* trigger can stay
   success-and-empty-only (matching the spec delta's "a rejected or failed submit request is NOT a
   trigger for this reconciliation" wording, which only governs whether a *new* fetch is fetched, not
   whether an *existing in-flight* fetch remains valid) — but the *invalidate an in-flight fetch*
   signal must not have that restriction, since a plain success that doesn't itself empty the map is
   exactly the case this round's guard fails to track. `tasks.md` task 2.3 needs to state this
   explicitly (generation increments on every settle, not just success-driven empty ones), and a new
   test is needed: three overlapping clicks — the first settles and dispatches a reconciliation fetch;
   before it resolves, a second click fires and *succeeds* while a third is still outstanding (so the
   map does not empty on the second click's own success); the third then *fails*, emptying the map;
   only then does the first fetch resolve (force this ordering, not a same-order mock) — assert the
   stale fetch's resolution is discarded and the displayed value still reflects the second click's
   committed contribution. Standing Constraint C8 (and its `workflow-state.md` mirror) should be
   reworded to state the invalidation-on-settle invariant covers *every* settle event in the map's
   lifetime, not only success-driven empty transitions.

### Non-blocking notes

- Separately from this round's fix: D9's failure branch (`design.md:95-98`) and existing HEL-1087
  behavior conflate "the request was rejected" with "the request failed at the transport level" for
  rollback purposes (`C2`/`D7`: "rejected/network" both trigger rollback). A network failure where the
  write actually committed server-side but the client never received the acknowledgment would, under
  this rule, incorrectly roll back a persisted write. This is pre-existing behavior carried over from
  HEL-1087 and unchanged by any of this ticket's three prior rounds or this round's fix — I am not
  blocking on it, but flagging it since ticket.md's own open product question #2 explicitly warns "a
  write that persisted... must not be silently rolled back," and this scenario is exactly that. Worth
  a note in `design.md`'s Risks section acknowledging it as an accepted, pre-existing gap outside this
  ticket's scope, so a future skeptic round doesn't need to re-derive it from scratch.
- Item 1's fix (CR1) is timing-dependent in the same way rounds 2 and 3's were — a naive test with
  same-order mock resolution will not reproduce it. The new test needs to force: click 2's success to
  resolve before click 3's failure, and the original reconciliation fetch (F1) to resolve strictly
  after both.
