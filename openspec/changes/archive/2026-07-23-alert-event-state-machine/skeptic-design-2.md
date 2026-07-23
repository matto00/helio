## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read round 1's report (`skeptic-design-1.md`) in full to understand exactly what gap was flagged
  before re-reading the revised artifacts cold.
- Read `ticket.md` again — reconfirmed the dedup AC's wording ("two breaches of the same rule with
  no intervening resolution yield exactly one active event with updated `lastEvaluatedAt`") is not
  qualified to only apply while `firing`, which is the textual anchor the revision uses to justify
  extending `ReFire` to all active states.
- Read the revised `design.md` in full:
  - `Decisions` → state-machine section (`design.md:52-74`) now enumerates all four `ReFire`
    branches explicitly (`firing->firing`, `acknowledged->acknowledged`,
    `snoozed->snoozed` (unexpired), `snoozed->firing` (expired)), each stating the `state`/
    `acknowledgedAt`/`snoozedUntil` outcome and confirming `lastEvaluatedAt`/`value`/`severity` are
    refreshed in every case. `resolved` has no legal `ReFire` edge — stated explicitly and
    consistent with "a breach against a resolved event is not a `ReFire`" being handled by the
    insert branch.
  - A new "`severity` refresh policy" paragraph (`design.md:76-81`) states `severity` is refreshed
    on every legal `ReFire` identically to `value`, and that `Acknowledge`/`Snooze`/`Resolve` never
    touch `value`/`severity` — closes round-1 Change Request 2.
  - "Dedup / upsert path" (`design.md:87-97`) now says the active-row branch applies "in any active
    state (`firing`, `acknowledged`, or `snoozed` — expired or not)" and routes unconditionally
    through `transition`+`ReFire`, with the state machine (not the repository) deciding the
    resulting state — this matches the state-machine section exactly; no more general-prose-vs-
    enumeration mismatch.
  - `Planner Notes` (`design.md:164-172`) records the round-1 self-approved revision and its
    rationale (why extending `ReFire` rather than adding a raw-update bypass was chosen) — directly
    answers round 1's "either answer is implementable, pick one" ask, and picks the
    routes-through-`transition` answer, preserving single-source-of-truth.
  - Risks section gained a new entry (`design.md:137-143`) acknowledging the consequence of
    refreshing `severity` while acknowledged/snoozed (a transient severity spike being persisted
    even though the user isn't actively notified) — reasonable, not a design defect.
- Read `specs/alert-event-state-machine/spec.md` in full: the "Single-source-of-truth transition
  function" requirement (lines 15-37) now states the same four `ReFire` branches with the same
  outcomes as design.md, word-for-word consistent. Eight `ReFire`-related scenarios now exist
  (`firing->firing`, `acknowledged->acknowledged`, `snoozed` expired/unexpired, "never touches
  firstFiredAt", plus the illegal-`ReFire`-from-`resolved` scenario) — one scenario per branch, as
  tasks.md 4.1 promises. The "De-duplication contract" requirement (lines 106-112) now explicitly
  says a breach against an already-active event "regardless of whether that event is currently
  `firing`, `acknowledged`, or `snoozed`" updates in place via `ReFire`, with three matching
  scenarios (re-breach while firing / acknowledged / snoozed-not-expired) plus the resolve-then-
  reopen scenario. No remaining 2-branch enumeration anywhere in this file.
- Read `specs/alert-event-persistence/spec.md` in full: the `upsertFiringInternal` requirement
  (lines 49-57) now explicitly states it routes through `transition`+`ReFire` "uniformly — never a
  raw field update" and calls out "covering all three reachable active states (`firing`,
  `acknowledged`, `snoozed`)". Five scenarios now exist: no-active-row insert, active-firing,
  active-acknowledged (new), active-snoozed-not-expired (new), active-snoozed-expired — exactly the
  two missing branches from round 1 are now present, each specifying `value`/`severity`/
  `last_evaluated_at` update and the unchanged field (`acknowledged_at` / `snoozed_until`
  respectively). This directly closes round-1 Change Request 1's required revision.
- Read `tasks.md` in full: task 1.3 (unchanged shape, `ReFire` action definition), 1.4 (now says
  "encoding every legal edge from design.md — including all four `ReFire` branches" with the same
  enumeration as design.md/spec.md), 2.4 (now says "if an active row exists in **any** active state
  ... route it through `transition` ... do **not** hand-branch on state in the repository"), 4.1
  (transition matrix task now lists all four `ReFire` branches by name), 4.2 (repository spec task
  now lists dedup coverage "across all three active states" — firing/acknowledged/snoozed-unexpired/
  snoozed-expired, four re-breach cases plus breach-after-resolve). All five task references now
  match the 4-branch enumeration in design.md and both spec files — no more 2-branch mismatch.
- Cross-checked all four artifacts against each other pairwise for the specific outcomes per branch
  (state, which timestamp is touched/untouched, severity/value refresh) — found no residual
  contradiction. The "single source of truth" claim holds: every artifact that describes the
  upsert/dedup path (design.md, both specs, tasks 2.4) explicitly forbids a raw-field-update bypass
  and routes through `transition`; no artifact proposes or implies a bypass for the two previously-
  gapped states.
- Re-verified round-1's already-confirmed items lightly, since this is a planning-only round with no
  code changes yet (`git status --short` shows the entire `openspec/changes/alert-event-state-
  machine/` dir as the only untracked content; `git log` confirms HEL-447 (76a1071d) is the tip,
  i.e. still the same base round 1 verified against):
  - `backend/src/main/scala/com/helio/api/routes/ServiceResponse.scala:63` — `ServiceError.Conflict`
    still maps to `StatusCodes.Conflict` (409) centrally; tasks.md 3.3's wording is still imprecise
    but harmless, as flagged non-blocking in round 1.
  - No code files were touched by the round-1-to-round-2 revision (confirmed via `git status`), so
    the RLS-pattern, repository/service-shape, and `ServiceError`/`ServiceResponse`-mapping findings
    from round 1 (verified against the real HEL-447 code on disk) still stand unchanged.
- Checked for any *new* gap introduced by the revision: the four-branch enumeration is exhaustive
  over `AlertEventState` (`firing`/`acknowledged`/`snoozed`/`resolved`), and `resolved` is explicitly
  and consistently excluded from `ReFire` everywhere (design.md, state-machine spec's "no legal edge
  from resolved" + illegal-transition scenario, persistence spec's "no active row" insert-branch
  language, tasks 1.4/4.1). No fifth state or edge case (e.g. a `snoozed` event with `snoozedUntil ==
  now()` exactly) is introduced or left dangling; the persistence spec's "expired" scenarios use "in
  the past"/"still in the future" consistently, matching the state-machine spec's language — no new
  boundary ambiguity introduced by the revision.

### Verdict: CONFIRM

The round-1 gap is closed, not just reworded: design.md, the state-machine spec, the persistence
spec, and tasks.md now all specify the identical four-branch `ReFire` behavior
(`firing`/`acknowledged`/`snoozed`-unexpired/`snoozed`-expired), the `severity`-refresh-on-update
question from round-1's secondary note is explicitly answered and consistent everywhere it appears,
and the single-source-of-truth guarantee is preserved (no raw-field-update bypass was introduced —
the resolution instead extended `transition`'s legal-edge set, which is the answer round 1 called
"cleaner"). No new contradiction or scope gap was introduced by the revision.

### Non-blocking notes

- Round 1's three non-blocking notes (no dedicated `owner_id`-alone index, no validation on
  `snoozedUntil` being in the future for the snooze endpoint, tasks.md 3.3's "map Conflict to 409"
  wording being technically automatic rather than new work) were not addressed in this revision and
  remain open as non-blocking polish items — none are required for round-2 sign-off, but worth
  carrying into implementation review if not otherwise resolved.
- The new Risk entry on transient-severity persistence while acknowledged/snoozed (design.md:137-
  143) is a reasonable, explicitly-accepted trade-off, not a defect — flagging only so it's visible
  to whoever reviews the eventual delivery-channel design (HEL-432), since a snoozed/acknowledged
  event silently escalating in severity underneath a suppressed notification could matter there,
  even though it's correctly out of scope for this storage-only ticket.
