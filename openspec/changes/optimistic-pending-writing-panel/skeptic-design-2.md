## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

1. **Round 1's blocking gap (single-value `submitState` guard silently drops all clicks after the
   first) is structurally closed by D9.** Re-read `frontend/src/features/panels/ui/form/
   FormPanelView.tsx:114-150` — confirmed the shipped `handleImmediateStep` guard
   (`if (!schema || submitState === "pending") return;`) is still exactly the pre-existing HEL-1087
   code (unchanged, as expected — this is the design gate, execution hasn't started; no commits
   exist yet on this branch, `git log` shows HEAD still at `bf02f384`, and `git status --short`
   shows only the untracked `openspec/changes/optimistic-pending-writing-panel/` directory).
   `design.md` D9 (new, inserted after D5/before D6) now explicitly directs replacing this guard
   with a `Map<token, delta>` so every burst click fires its own request — this genuinely resolves
   round 1's specific complaint ("clicks 2..N are dropped before becoming a second in-flight
   request, so `pendingDeltaSum` is vacuous"). `tasks.md` 2.2/2.3/2.4 assign this as explicit,
   verifiable Frontend tasks, and Standing Constraint C8 was added to both `tasks.md` and
   `workflow-state.md`'s `CONSTRAINTS` (with `CONSTRAINT_REVIEWS` recording `verdict_seq:2,
   gate:"design", round:1, verdict:"REFUTE", promoted:["C8"]` — correct provenance).

2. **D8 and Risks section were actually updated to reference D9**, not left stale. D8 now reads
   "computed from the pending-delta map D9 introduces (`pending map size > 0`), not the old
   single-value `submitState`" — this closes round 1's specific worry that D7/D8 read "as if
   `submitState` itself survives unchanged."

3. **D9's scoping claim ("the full multi-field form's own submit button... untouched") is
   architecturally sound, not just asserted.** Checked `FormPanelView.tsx:234-236`: `isCompactCounter`
   gates a fully separate early-return render branch, and `handleSubmit`'s own `submitState ===
   "pending"` guard (line 154) and the base `form-panel-submit` spec's existing "No double submit"
   scenario (`openspec/specs/form-panel-submit/spec.md:26-27`, the pre-existing spec, not this
   change's delta) belong to the mutually-exclusive full-form path. A panel instance is never in
   both render modes at once, so D9's `handleImmediateStep`-only scope doesn't create a hidden
   interaction with the untouched `submitState`/`handleSubmit` path.

4. **The three cosmetic hygiene nits round 1 flagged are fixed, verbatim.** Compared `tasks.md`'s
   `## Standing Constraints` C1/C3/C6 against `workflow-state.md`'s `CONSTRAINTS` C1/C3/C6
   character-for-character: C1 and C6 now match casing exactly ("This DELIBERATELY reinterprets…",
   "COMPUTED ARIA state"), and C3 now carries the trailing "(schema-drift gate)" parenthetical in
   both files. No remaining drift.

5. **The spec delta's rewording is consistent with D9's relative-subtraction model.**
   `specs/form-panel-submit/spec.md`'s rollback requirement now reads "a rejected request's rollback
   SHALL subtract only that request's own delta from the currently displayed value, never restore an
   earlier snapshot," with a new scenario "A rollback while a sibling click is still in flight
   subtracts only its own delta" — this matches D9's bullet 4 exactly and is a genuine improvement
   over round 1's absolute-revert wording.

### A new soundness gap D9 itself introduces (blocking)

**D9's success-side reconciliation formula (`fetchedAggregate + sum(remaining pending map
values)`) conflates "this client hasn't received its own response yet" with "this write isn't yet
reflected in the aggregate" — these are different facts once genuine concurrency exists, and
conflating them lets the display transiently overcount and then visibly snap backward, which is
exactly the failure mode C4 / the spec's own "never regress" scenario exists to forbid.**

Concrete trace (two concurrent clicks, A then B, each `delta = +1`, over Pekko HTTP — which
processes concurrent requests on its actor/thread-pool without any guarantee that response-return
order matches commit order, and axios/fetch does not reorder responses to match request order
either):

1. Click A fires → pending map `{A:1}`, displayed = X+1.
2. Click B fires → pending map `{A:1, B:1}`, displayed = X+2.
3. B's row commits to `dataset_rows` first (real aggregate is now X+1), but B's HTTP *response*
   is delayed in transit (ordinary network/thread-scheduling jitter — not a contrived scenario).
4. A's row commits next (real aggregate is now X+2); A's response returns to the client quickly,
   **before** B's delayed response arrives.
5. Per D9 bullet 3: A's success removes token `A` (pending map now `{B:1}`), then calls
   `fetchFieldAggregate`. This is a fresh GET issued *after* step 3 and 4, so it reads the true
   current aggregate: **X+2** (both rows already committed).
6. Displayed is set to `fetchedAggregate + sum(remaining pending)` = `(X+2) + 1` (B's delta, still
   "pending" from the *client's* point of view even though B's row is already committed) = **X+3**
   — an overcount by exactly B's delta, double-counting a write that is both already in the fetched
   aggregate *and* still being added as an optimistic delta.
7. B's delayed response eventually arrives. Per D9 bullet 3: B's success removes token `B` (pending
   map now empty), fetches the aggregate again → **X+2** (no new writes since step 4). Displayed
   becomes `(X+2) + 0` = **X+2**.
8. Step 7 is a **visible decrease from X+3 to X+2**, occurring exactly at "a reconciliation landing
   mid-burst" — a direct violation of Standing Constraint C4 ("the displayed value must never snap
   back below the in-flight optimistic sum") and the spec's own scenario ("A reconciliation landing
   mid-burst does not snap the display backward" — `specs/form-panel-submit/spec.md:54-58`, "never a
   value lower than what was already displayed").

This is a genuinely new hole, not a restatement of round 1's: round 1's guard made concurrency
*unreachable*, so this race couldn't manifest. D9 makes concurrency reachable, which is exactly
what exposes it. D5's own justification for skipping "a request-ordering/sequence-number protocol"
("each click's own refetch is independent and idempotent... always re-derives from the full
current aggregate") is true of *that one fetch in isolation*, but the surrounding arithmetic
(`+ sum(remaining pending)`) implicitly assumes "remaining pending" means "not yet reflected in any
fetched aggregate," which is only guaranteed under total ordering between commit-and-response
per request — an ordering Pekko HTTP's concurrent request handling does not provide and D9 never
asserts.

Two reasons this can ship invisibly rather than get caught in execution:

- Task 2.3's own acceptance test ("a unit test simulating two overlapping clicks where the first's
  reconciliation resolves while the second is still pending") and task 3.3's ("an intermediate
  aggregate refetch resolves mid-burst") both mock the aggregate fetch's return value directly —
  a mock fully controls what value comes back, so a test author following these tasks literally has
  no reason to construct the specific "sibling's write already landed server-side, but its own
  response hasn't arrived at the client" case; nothing in tasks.md instructs it. Both tests can be
  green while this bug ships.
- `dataset_rows` already carries exactly the primitive needed to close this (`seq`, a per-source
  monotonic counter — `V106__dataset_rows.sql:33/37/40`, already cited by D4). Neither the aggregate
  endpoint (D2) nor the submit response is designed to surface it, so there is currently no way for
  the client to distinguish "sibling write not yet committed" from "sibling write committed but its
  response hasn't arrived yet."

Note the failure-side path (D9 bullet 4 / task 2.4) does **not** share this defect: a
rejected/failed request either never committed, or its commit-vs-response ambiguity on network
failure is the same one HEL-1087's original code already has and D7 explicitly keeps unchanged
(out of scope) — so I am not re-litigating that. The defect is specific to the success-side
formula's treatment of *other, sibling* pending entries.

### Verdict: REFUTE

### Change Requests

1. **(Blocking)** Close the response-ordering-vs-commit-ordering gap in D9's success-side
   reconciliation. The design needs an explicit decision on how "remaining pending map values" is
   computed such that a sibling's already-committed-but-not-yet-responded-to write is never summed
   *and* separately counted in the fetched aggregate. A concrete direction that fits the existing
   schema: have the aggregate-fetch endpoint (D2) return the current max `seq` for the source
   alongside the aggregate value, and have the submit endpoint's success response include the
   newly-inserted row's own `seq`; the client then only includes a pending-map entry in the sum if
   it has no confirmed `seq` yet, or its confirmed `seq` is greater than the fetch's reported
   max-`seq` — never merely "I haven't received my own response yet." Whatever mechanism is chosen,
   design.md needs to state it explicitly (a sibling decision to D9, or an amendment to it) and
   tasks.md needs a corresponding task and test that actually exercises out-of-order response
   delivery (not a same-order mock) — otherwise this ships as an untested, intermittent visible
   regression in exactly the scenario C4 and the spec's own "never regress" requirement exist to
   prevent.

### Non-blocking notes

- The concrete race above is timing-dependent and will not reproduce reliably under a naive local
  click test; if the fix in CR1 lands, verify its regression test forces the out-of-order condition
  deterministically (e.g., resolve the mocked responses in reverse-of-request order) rather than
  relying on real timing.
