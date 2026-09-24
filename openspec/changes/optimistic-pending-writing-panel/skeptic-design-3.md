## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

1. **Round 2's specific race is genuinely closed by the quiesce-gating mechanism.** Re-read
   `design.md` D9 (D9/old-D10 are now merged into one heading, as flagged in the brief — confirmed no
   separate "D10" heading exists anywhere in the file) and `tasks.md` 2.3/3.3, and `workflow-state.md`
   `CONSTRAINTS` C4/C8 (both files reworded consistently; `CONSTRAINT_REVIEWS` correctly appends
   `{"verdict_seq":3,"gate":"design","round":2,"verdict":"REFUTE","promoted":[]}` — no new constraint
   id promoted this round, matching the brief's description of C4/C8 being amended in place).
   Re-ran round 2's own two-click trace (A then B, `delta=+1` each, B's write commits first but A's
   HTTP response arrives first) against the NEW mechanism:
   - A fires → map `{A:1}`, displayed X+1. B fires → map `{A:1,B:1}`, displayed X+2.
   - B's row commits (real total X+1), B's response delayed. A's row commits (real total X+2), A's
     response arrives first.
   - A's success removes token A → map `{B:1}`, **non-empty → no fetch** (this is the actual fix: the
     old formula fetched on every success; the new one only fetches when the map is empty).
   - B's response eventually arrives → removes token B → map `{}` → **now** fetch, reads X+2 (both
     rows already committed) → displayed set to X+2.
   - Displayed sequence: X+1 → X+2 (optimistic) → X+2 (reconciled). No overcount, no backward snap.
     **Round 2's trace does not reproduce.** The mechanism is sound for the case it was built to fix.

2. **The rejected seq-based alternative's stated rejection reasoning is not hand-waved.** D9's text:
   comparing a pending entry's confirmed `seq` against the fetch's reported max-`seq` only
   disambiguates entries that *already have* a confirmed `seq` — round 2's defect was specifically an
   entry with **no** confirmed `seq` yet (response still in flight) whose write may already be
   committed. That's correct and precise: a `seq`-comparison scheme has nothing to compare for an
   unconfirmed entry, so it cannot close this specific defect without a further protocol change
   (pre-commit token echo) the design explicitly declines as unwarranted for this ticket's scale. This
   is a real, specific reason, not a generic "too complex" dismissal.

3. **Verified the "response only sent after commit" premise the whole mechanism depends on is an
   actual property of this codebase, not an assumption.** Read
   `backend/src/main/scala/com/helio/api/routes/panels/PanelRoutes.scala:44-53`
   (`completeSubmit` uses `onSuccess(result) { ... }`, i.e. the HTTP response is only completed once
   the `Future[Either[FormSubmitError, RowWriteResult]]` resolves) and
   `backend/src/main/scala/com/helio/services/panels/PanelService.scala:117-136` (`submitForm`
   synchronously `flatMap`s through `dataSourceService.appendFormRow`, the DB write, before the
   `Future` completes — no fire-and-forget). D9's core premise ("a response is only sent after its
   write commits") is genuinely true of this code, not hand-waved.

### A new soundness gap the quiesce mechanism itself introduces (blocking)

**The pending-delta map only tracks *submit-request* tokens — it does not track the lifetime of the
reconciliation fetch itself. A new click that fires during that fetch's own round trip (after the map
has emptied and the fetch has been dispatched, but before it resolves) is not accounted for when the
fetch resolves, so the literal mechanism in D9/task 2.3 ("remove the token; if that empties the map,
call `fetchFieldAggregate` and set `displayed = fetchedAggregate`") unconditionally overwrites
`displayed` with a now-stale value — discarding the new click's already-shown optimistic delta. This
is the exact visible-backward-snap failure mode C4 and the new spec's own "never visibly decrease
during a burst" requirement exist to forbid, reintroduced one layer up.**

Concrete trace (one click, then a second click racing the first's own reconciliation fetch):

1. Click A fires (`delta=+1`). Map `{A:1}`. Displayed = X+1.
2. A's request resolves (success) quickly. Per D9 bullet 3 / task 2.3: remove token A → map `{}`.
   Map is empty → trigger `fetchFieldAggregate()` ("Fetch1"), an async GET. Per D8, `aria-busy` is
   computed from `pending map size > 0` — the map is now `{}`, so **`aria-busy` goes false right at
   this instant**, even though Fetch1 is still outstanding. Nothing in D9 gates new activations on
   an in-flight reconciliation fetch (the guard that used to block re-entrancy, `submitState ===
   "pending"`, is exactly what D9 replaces/removes); the spinner clearing is precisely what invites
   the next click.
3. Before Fetch1's response returns, the user clicks again. Click B fires (`delta=+1`). Map `{B:1}`
   (B is a brand-new, separate map — A's token is long gone). Displayed = (X+1) + 1 = X+2, per D9's
   "every activation... advances the displayed value by delta on top of whatever is already shown."
4. Fetch1 resolves. It was issued right after step 2, before B's write reached the server, so it
   correctly reports the aggregate as of that moment: **X+1**. Per the literal D9/task-2.3 text, the
   success handler for this fetch does `displayed = fetchedAggregate` unconditionally — there is no
   re-check of whether the map is *still* empty at resolution time, and no accounting for deltas
   accrued since the fetch was dispatched. Displayed is set to **X+1**.
5. **Displayed visibly drops from X+2 to X+1** — a backward snap, even though click B's own request
   is still legitimately outstanding and its optimistic delta had already been rendered. This
   reproduces the same class of defect round 2 found (a stale fetch result overwriting a value that
   has since advanced), just relocated from "a stale submit-success fetch" to "a stale
   reconciliation-fetch's own resolution."
6. B eventually succeeds; map empties again; a second fetch resolves to X+2, correcting the display
   back up. Net user-visible sequence: X+1 → X+2 → **X+1 (visible dip)** → X+2.

This is not a contrived corner case: the ticket's own accepted use case is literally "rapid
clicks in quick succession" (task 3.3, spec.md's "Ten rapid increments" scenario), and step 2's
`aria-busy` transiently going false between the first burst's last token removal and its own
reconciliation fetch resolving is an active invitation to exactly the click in step 3, not an
unlikely edge condition.

Neither `design.md`, `tasks.md`, nor the spec delta addresses this. D9's Risks-adjacent prose only
discusses (a) a long-running straggler request delaying reconciliation, and (b) a leaked map entry on
unmount — both different issues. Task 2.3 and the spec's "No reconciliation is fetched until the
whole burst settles" scenario (`specs/form-panel-submit/spec.md:59-62`) define "burst" purely in
terms of the *submit-request* pending map; they say nothing about a reconciliation-fetch's own
in-flight window needing to be treated the same way. I also checked the existing
`FormPanelView.tsx:114-150` `handleImmediateStep` for any pre-existing "stale response" guard
(`AbortController`, a request-generation counter, a ref comparing "is this still the latest fetch")
that an implementer might be expected to reuse by convention — there is none; this file has no such
pattern today, so a literal implementation of task 2.3 has no reason to invent one.

A concrete direction that fits the existing design without reintroducing round 2's problem: when a
reconciliation fetch resolves, only apply `displayed = fetchedAggregate` if the pending map is *still*
empty at that moment; if new entries have been added since the fetch was dispatched, discard the
stale result and do nothing — the new burst's own eventual quiesce will trigger a fresh fetch that
already reflects every write committed so far (including the one this stale fetch was for), so nothing
is lost and no double-count risk is introduced (this doesn't resurrect the round-2 defect because it
never sums a possibly-uncommitted pending delta against a fetched value — it just drops a stale
result entirely and relies on the next natural quiesce-fetch, which is exactly the mechanism already
proven safe in verification item 1 above).

### Verdict: REFUTE

### Change Requests

1. **(Blocking)** Close the reconciliation-fetch race identified above. `design.md` needs an explicit
   amendment to D9 (or a new sibling decision) stating that a reconciliation fetch's resolution must
   check the pending map's *current* state before applying `fetchedAggregate` to `displayed` — a
   fetch whose triggering condition (map empty) no longer holds by the time it resolves must not
   unconditionally overwrite `displayed`. `tasks.md` task 2.3 needs to state this check explicitly
   (not just "set the value to fetchedAggregate"), and a corresponding test needs to exercise it: a
   click fires, its success triggers a fetch, and a *second* click fires before that fetch resolves —
   assert the fetch's resolution does not drop the second click's already-shown optimistic delta (a
   same-order mock resolving strictly after the second click's own state update, analogous to how
   task 3.3 now forces out-of-order resolution for the previous defect). Standing Constraint C4 (and
   its `workflow-state.md` mirror) should be reworded to state the invariant covers reconciliation
   fetches racing new activations, not just submit requests racing each other.

### Non-blocking notes

- Item 1's fix is timing-dependent in the same way round 2's was — a naive local test with same-order
  mock resolution will not reproduce it. Whatever regression test lands for CR1 should force the
  reconciliation fetch to resolve strictly after a new click has already updated the pending map and
  `displayed`, not rely on real timing.
