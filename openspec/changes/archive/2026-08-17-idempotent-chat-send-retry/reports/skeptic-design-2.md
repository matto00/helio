## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Note on tooling: `scripts/concertino/next-report-number.sh`, `persist-evidence.sh`, and
`emit-event.sh` are not present in this worktree's `scripts/concertino/` (only
`assert-phase.sh`, `cleanup.sh`, `setup-worktree.sh`, `start-servers.sh`, `README.md` exist —
confirmed via `ls`). Matches round-1's finding. Wrote directly to
`reports/skeptic-design-2.md` per the task's explicit fallback instruction; no persist/emit
step attempted since the scripts aren't present to run.

I am a fresh reviewer for this round — I did not take round-1's report, the orchestrator's
framing, or my own memory of round 1 (there is none) at face value. Every claim below is
re-derived from the artifacts and the actual code in this worktree, read directly in this
session.

### What I verified (with evidence)

**Round-1 Change Request #1 (multi-sender reset race disclosure) — applied and coherent**
- `design.md` Planner Notes (lines 107-118) now contains a dedicated bullet: "Multi-sender
  reset race — disclosed and accepted out of scope (skeptic design-gate round-1 change #1)".
  It states the load-bearing assumption explicitly ("last-key-only assumes a SINGLE ACTIVE
  SENDER per conversation at a time"), names the trigger (another tab/device, or a future
  caller of the currently-uncalled `/messages` route), traces the exact mechanism (a keyed
  append between an original send's successful append and a same-key retry's append-time check
  overwrites `last_idempotency_key` away from K), states the window size honestly ("the whole
  timeout-to-retry interval, not milliseconds" — not understated to milliseconds like the
  narrower D3 race), and explicitly accepts it out of scope "on the same footing as the
  multi-key-table Non-goal." This is exactly what round-1's CR#1 asked for — not a token
  acknowledgment, a full trace with the same rigor round-1's own report used.

**Round-1 Change Request #2 (leave-untouched-on-keyless mitigation) — applied and coherent
across every artifact, no leftover contradiction found**
- `design.md` D2 (line 33-37): "the column holds the key of the most recent KEYED append — a
  `None`-keyed append ... leaves it UNTOUCHED. Nulling it there would let an unrelated keyless
  append silently un-protect an outstanding keyed retry."
- `design.md` D3 (line 51-53): `touchUpdatedAt` "written in the SAME update as
  `gcs_body_ref`/`updated_at` when the key is `Some` ... a `None` key updates only
  `gcs_body_ref`/`updated_at`, leaving the column untouched (D2)."
- `design.md` Planner Notes closes the loop: "The *keyless*-append half of this race is closed
  outright by D2's leave-untouched semantics" — correctly distinguishes what's now closed
  (keyless) from what's still disclosed-and-accepted (a different sender's own *keyed* append,
  which legitimately overwrites per D2's "most recent keyed append" semantics — that's not a
  contradiction, it's the correct residual scope of CR#1).
- `proposal.md` (line 15-17): "the conversation row gains a `last_idempotency_key` column ...
  recording the key of the most recent *keyed* append (a keyless append leaves it untouched)."
  Matches D2 exactly.
- `specs/assistant-live-converse/spec.md`: the ADDED requirement text (line 9-10) states "an
  append carrying no key SHALL leave the column unchanged, so an unrelated keyless append can
  never un-protect an outstanding keyed retry," and a new dedicated scenario (line 37-42, "A
  keyless append does not disturb the recorded key") pins the exact behavior: append K, then a
  keyless append, then assert the row still reads K and a same-key retry is still a replay.
  This is the spec-level test of round-1's mitigation, not just prose.
- `tasks.md` 1.3: "`touchUpdatedAt` gains `lastIdempotencyKey: Option[String]`: when `Some`,
  written in the SAME update tuple ...; when `None`, the column is left UNTOUCHED (design.md
  D2/D3 — never null it out)." Task 4.1/4.2 both assert "a `None` key leaves a previously-set
  value untouched" / "keyless append leaves a previously-set key in place" at the repository and
  service layers respectively — both layers of the stack get regression coverage for this exact
  fix, not just one.
- I grepped for any leftover "null on keyless" language across `design.md`, `proposal.md`,
  `tasks.md`, and both spec deltas (`grep -rn -i "null\|overwrit\|advance\|reset\|clear"`) —
  every hit is either the new leave-untouched language, unrelated uses of "null"/"clear" (e.g.
  `pendingSend: {key, text} | null`, "clear the composer input"), or the correctly-scoped
  "keyed append overwrites" language describing the still-disclosed CR#1 race. No artifact
  anywhere still describes a keyless append as nulling/resetting the column.

**Ground-truth re-verification (code has not drifted since round 1 — this is the design gate,
pre-implementation)**
- `AssistantConversationRoutes.scala:114-146` (`converseFlow`): unchanged shape — get → converse
  → (on success) telemetry → `appendTurn` → final `service.get` re-fetch. Confirms the root-cause
  claim is still accurate against real code, not stale.
- `AssistantConversationService.scala:72-89` (`appendTurn`): still the single atomic blob
  write → `touchUpdatedAt`, exactly as D1/D2/D3 assume.
- `AssistantConversationRepository.scala:114-124` (`touchUpdatedAt`): still a single
  `.update((gcsBodyRef, now))` tuple, confirming D3's claim that adding the key to the same
  tuple (conditionally) is mechanically available.
- `backend/src/main/resources/db/migration/`: max is still `V86__pipeline_steps_enabled.sql` →
  `V87` in design.md remains uncollided.
- `AssistantConversationProtocol.scala:35,47-55,67-68,73-74`: `ConverseRequest(message: String)`
  is `jsonFormat1`; `AssistantConversationResponse` has 7 fields, `jsonFormat7`. Confirms D5's
  `jsonFormat1→2` / `jsonFormat7→8` claims are still accurate. Grepped for any other
  `AssistantConversationResponse(`/`ConverseRequest(` construction site outside the protocol
  file — only one (`AssistantConversationRoutes.scala:70`, named-args `detailOf`), so appending
  fields is still safe.
- `schemas/converse-request.schema.json` and `schemas/assistant-conversation.schema.json`: read
  both in full — current field sets match what design.md D5 / tasks 2.1-2.2 say they're adding
  to; `additionalProperties: false` is already the pattern in both, consistent with the design's
  claim that omitting the new fields would be a validation failure if forgotten.
- `MessageComposer.tsx`, `assistantConversationsSlice.ts`, `assistantConversationsService.ts`:
  read in full. Current `handleSubmit`/`converse` thunk/`converse()` service function shapes
  match exactly what design.md D6 says it's building on (single `converse({id, message})`,
  `sending` guard, input cleared only on success, try/catch → `rejectWithValue`,
  `converse.fulfilled` deriving `lastTurnOutcome` from `?? false`). No drift since round 1.

**Independent AC tracing (not just re-checking round-1's work)**
- AC1 (no duplicate/near-duplicate turn on retry of an already-landed send): traced the exact
  ticket.md scenario — append succeeds, final re-fetch/response fails, client sees an error,
  composer preserves input, user resubmits. `MessageComposer`'s key-reuse-on-same-text (D6)
  means the resubmit carries the *same* key K. Two independent layers catch this: (a) the
  thunk's automatic reconciliation on the *first* rejection (D6) resolves it without ever
  issuing a second converse call at all when the reconciliation GET succeeds and matches; (b) if
  reconciliation itself fails (e.g., network still down) and the user manually retries, D3's
  route-entry and append-time checks both catch the same key K and no-op. Both paths trace to
  real code changes (task 1.7 route-entry, task 1.4 append-time, task 3.3/3.4 client) with no
  gap I can find.
- AC2 (displayed state reflects reality): D6/spec `assistant-send-reliability` correctly
  produces a binary, evidence-based determination — matching key on reconciliation → treated as
  landed (transcript shown, input cleared, no banner); non-matching key or a failed
  reconciliation fetch → today's failure UX preserved, explicitly with the note that the retry
  is now idempotency-protected either way. This is a coherent, non-hand-wavy resolution of both
  possible determinations, not a partial fix.
- Traced the interaction between the two mechanisms once more independently (not merely
  repeating round-1's D1 justification): key-only would satisfy AC1 but leave a landed send
  showing a false failure banner (fails AC2); reconciliation-only cannot protect a retry that
  races an original still mid-Claude-call, since "not landed yet" isn't "will never land" (fails
  AC1). Needing both is architecturally justified, not scope creep — each closes a gap the other
  structurally cannot.

**Scope / contradiction check across all five artifacts**
- No `TODO`/`TBD`/deferred-decision language anywhere in `design.md`, `proposal.md`, `tasks.md`,
  or either spec delta.
- No contradiction between `proposal.md`'s "What Changes"/Non-goals and `design.md`'s D1-D6 or
  Planner Notes — the Non-goals list (multi-key idempotency table, streaming/SSE, removing the
  final re-fetch, create-idempotency) is consistent with, and narrower than, what Planner Notes
  additionally discloses (the multi-sender race) — the two don't compete, Planner Notes is a
  superset disclosure at the design-artifact level while proposal.md's Non-goals stays at the
  "what we're explicitly not building" level, which is the right division of labor between the
  two documents.
- Every task in `tasks.md` maps to a design.md decision point (D2/D3/D4/D5/D6) and a concrete
  file/method; no task is ambiguous about what "done" looks like for a competent implementer.
- Every AC has task-level coverage; no task exists that isn't in service of AC1 or AC2 (no scope
  drift).
- Schema deltas (2.1/2.2) are present for both wire-shape changes (`ConverseRequest`,
  `AssistantConversationResponse`) — no missing contract update.

### Verdict: CONFIRM

Both round-1 change requests are genuinely, not superficially, threaded through every artifact
(design.md's D2/D3/Planner Notes, both spec deltas' new scenarios, tasks.md's 1.3/4.1/4.2, and
proposal.md's "What Changes" wording) — I found no artifact still describing the old
null-on-keyless semantics, and no new internal contradiction introduced by the fix. Independent
re-tracing of the ground-truth code (routes/service/repository/protocol files, migrations,
schemas, and the three frontend files) confirms every factual claim in the design is still
accurate — nothing has drifted since round 1, as expected for a design gate before any
execution cycle. My own independent AC-by-AC trace confirms the two-mechanism design
(server-side idempotency key for AC1, client-side reconciliation for AC2) actually closes both
acceptance criteria for the ticket's real scenario, with the previously-open multi-sender race
now honestly bounded and accepted as out of scope rather than silently assumed.

### Non-blocking notes

- `proposal.md`'s Non-goals section doesn't itself mention the multi-sender reset race
  (it only lists the multi-key idempotency table). Round-1's CR#1 specifically asked for the
  disclosure in "design.md D3 (Planner Notes)," which is satisfied; mirroring a one-line pointer
  into proposal.md's Non-goals would give a reader who only skims the proposal (not design.md)
  the same visibility, but this is optional polish, not a gap in what was actually requested.
- Everything else — D4's replay-response shape, the wire contract, the client key lifecycle, the
  Testing section's coverage of both repository- and service-layer keyless-append behavior, and
  all task-level file/line targets — checked out cleanly with no placeholders or missing
  coverage.
