## Skeptic Report — design gate (round 0, skeptic-design-1.md)

Note on tooling: `scripts/concertino/next-report-number.sh`, `persist-evidence.sh`, and
`emit-event.sh` do not exist in this worktree (this worktree's `scripts/concertino/` predates
those scripts landing on `main` — confirmed via `git log --oneline -- scripts/concertino/` at the
repo root, which shows them present on `main` but absent here). Wrote directly to
`reports/skeptic-design-1.md` per this task's explicit instruction ("use next-report-number.sh
*if applicable*"); no persist/emit step attempted since the scripts aren't present to run.

### What I verified (with evidence)

**Ticket / AC grounding**
- Read `ticket.md`: two ACs — (1) no duplicate/near-duplicate user turn on retry of an
  already-landed send, (2) post-error displayed state reflects whether the message landed.
  Mechanism deliberately unprescribed.

**Root-cause claim (proposal.md/design.md) vs. real code**
- `backend/src/main/scala/com/helio/api/routes/AssistantConversationRoutes.scala:114-146`
  (`converseFlow`): confirmed exact shape claimed — `service.get` → `assistantService.converse` →
  (on `Right`) `AssistantTelemetry.emitToolLoopOutcome` → `service.appendTurn` → final `service.get`
  re-fetch that shapes the response via `detailOfConverse`. A failure in that final re-fetch (or
  the HTTP round-trip) surfaces as total failure after persistence already happened. Real, not
  fabricated.
- `AssistantConversationService.appendTurn` (`AssistantConversationService.scala:72-89`): confirmed
  the "ONE atomic blob write" claim — `findById` → `fileSystem.read` → `deserialize(bytes) ++
  turns` → **one** `fileSystem.write` of the whole re-serialized blob → `repo.touchUpdatedAt`. User
  turn + Claude reply land in a single write, as design.md D1/D6 assumes.
- `AssistantConversationRepository.touchUpdatedAt` (`AssistantConversationRepository.scala:114-124`):
  single `.update((gcsBodyRef, now))` tuple — confirms D3's claim that adding the key to the SAME
  update tuple (`(gcsBodyRef, now, key)`) is mechanically straightforward and genuinely atomic with
  the `updated_at`/`gcs_body_ref` write.

**Migration numbering**
- `ls backend/src/main/resources/db/migration/` → current max is `V86__pipeline_steps_enabled.sql`.
  `V87` is correct and uncollided.

**Wire/protocol claims**
- `AssistantConversationProtocol.scala`: `ConverseRequest(message: String)` is currently
  `jsonFormat1` (line 35, 67-68) → design's `jsonFormat2` after adding `idempotencyKey` is correct.
  `AssistantConversationResponse` has 7 fields, currently `jsonFormat7` (line 47-55, 73-74) →
  `jsonFormat8` after adding `lastIdempotencyKey` is correct. Only one construction site
  (`detailOf`, named args) — appending a field is safe, no positional-call breakage.
- spray-json `None`-omission claim verified against the actual library source
  (`spray-json_2.13-1.3.6-sources.jar`, `ProductFormats.scala:46`:
  `case _: OptionFormat[_] if (value == None) => rest` on write, plus `fromField`'s
  `OptionFormat`-aware missing-field handling on read) — this is a real library guarantee, not an
  assumption, and is already exercised by this exact codebase (existing test asserts
  `obj.fields.keySet should not contain "hopBudgetExhausted"` in
  `AssistantConversationRoutesSpec.scala:353`). Keyless-caller back-compat claim is sound.
- `POST /:id/converse`'s only real caller is `frontend/.../MessageComposer.tsx` (confirmed via
  grep — no other `converse(` call site, no `helio-mcp` consumer of this route). The `/messages`
  route (`AppendAssistantConversationTurnRequest`) has **zero current callers** anywhere in the
  codebase (frontend or backend) — confirmed via grep. Task 1.8's "confirm unaffected" claim is
  correct and low-risk in practice.

**Frontend claims**
- `MessageComposer.tsx`: confirmed current `handleSubmit` shape (single `converse({id, message})`
  dispatch, `sending` guard blocking concurrent submits, input cleared only on success, preserved
  on failure) matches what design.md D6 says it's building on.
- `assistantConversationsSlice.ts`: confirmed `converse` thunk's current try/catch →
  `rejectWithValue` shape, and that `converse.fulfilled`'s reducer derives `lastTurnOutcome` from
  `action.payload.hopBudgetExhausted ?? false` — consistent with D6's claim that a reconciled
  (GET-sourced) fulfillment naturally derives `{false,false}` without special-casing.
- `crypto.randomUUID()` (D6/task 3.4, no existing precedent in this frontend codebase) — verified
  it actually works in this repo's real Jest/jsdom setup (`jest-environment-jsdom ^30.4.1`) by
  running a throwaway test in the frontend package; not a blocker.
- All referenced test files for tasks 4.1-4.5 exist and have the right shape to extend:
  `AssistantConversationRepositorySpec.scala` (has a `touchUpdatedAt` describe-block already),
  `AssistantConversationServiceSpec.scala`, `AssistantConversationRoutesSpec.scala` (has a working
  embedded-Postgres + RLS harness), `assistantConversationsSlice.test.ts`. `MessageComposer.test.tsx`
  genuinely doesn't exist yet — "New" is accurate.
- Schemas (`converse-request.schema.json`, `assistant-conversation.schema.json`): read both, confirm
  current field sets match what design.md D5/tasks 2.1-2.2 say they're adding to.

**Non-goals claim (proposal.md)**
- Traced the "lost create-response leaves an empty shell, not a duplicate message" claim through
  `MessageComposer.handleSubmit`: on `createConversation` failure, `setSelectedConversationId` never
  fires (it's downstream of a successful create), so a retry re-creates a *second* conversation and
  sends the message only to it — no duplicated user turn anywhere, correctly out of AC1's scope.

### Residual race analysis (design.md D3 Planner Notes) — the one real gap

D3 discloses and bounds exactly one race: two requests carrying the **same** key K, both reaching
`appendTurn`'s `findById` before either's `touchUpdatedAt` commits (a millisecond-scale window
against multi-second Claude calls) — genuinely narrow, and honestly framed (the spec delta's own
"Concurrent duplicate" scenario is worded to match: "one completes its append first").

But D2's *own* semantics create a second, wider race that Planner Notes never mentions: the column
holds the **last-applied key only**, and D2 explicitly says *any* append — keyed or keyless —
overwrites/nulls it ("the transcript has advanced past whatever the old key described"). Trace:

1. Tab A sends converse with key K. Its Claude call completes; `appendTurn(K)` runs: `findById` sees
   no K yet → writes the blob → `touchUpdatedAt(K)` commits. `last_idempotency_key = K`.
2. The response never reaches Tab A (network drop). Before Tab A retries, a **different concurrent
   sender to the same conversation** — another tab/device (this app ships a PWA — mobile+desktop use
   of one conversation is plausible), or (currently moot, but real if it's ever wired up) the
   already-defined-but-uncalled `/messages` route — appends anything, keyed or keyless.
   `touchUpdatedAt` runs again and overwrites `last_idempotency_key` away from K.
3. Tab A retries with the *same* key K. Route-entry check: `existing.record.lastIdempotencyKey != K`
   now → not recognized as a replay → proceeds. `assistantService.converse` runs again;
   `appendTurn(K)`'s `findById` also sees `!= K` → proceeds → **appends a second time**. Genuine
   duplicate/near-duplicate user turn — the exact outcome AC1 exists to prevent.

Unlike the D3 race, this window isn't milliseconds — it spans the client's entire timeout-to-retry
interval (seconds, possibly tens of seconds), and its trigger (a second concurrent sender to the
same conversation) doesn't require any adversarial timing, just ordinary multi-device/multi-tab use.
Design.md's Non-goals section only rules out a "multi-key idempotency table with TTL" as
over-engineering for "a single-owner chat" — but it never states the load-bearing assumption that
makes "last-key-only" safe (*single active sender per conversation at a time*), and Planner Notes'
residual-race paragraph only bounds the narrower same-key race, giving a false impression that the
race analysis is complete. This is the "honestly bounded" gap the review brief specifically asked me
to check for, and it's real, not a nitpick — I traced it through actual code (`converseFlow`'s
route-entry check, `appendTurn`'s append-time check, `touchUpdatedAt`'s unconditional overwrite),
not inferred from the prose alone.

### Verdict: REFUTE

### Change Requests

1. **design.md D3 (Planner Notes) must disclose and bound the multi-sender reset race**, not just
   the same-key millisecond race. Add: this design assumes a single active sender per conversation
   at a time (mirrors the composer's own single-flight `sending` guard); a second concurrent append
   to the same conversation — another tab/device, or a future caller of the currently-uncalled
   `/messages` route — landing between an original send's successful append and a same-key retry's
   append-time check resets `last_idempotency_key` and un-protects the retry, which can then produce
   a real duplicate turn. State explicitly that this is accepted as out of scope for this ticket
   (single-composer, single-tab retry is the ticket's actual scenario), on the same footing as the
   already-declared "multi-key idempotency table" Non-goal — don't leave it as an undisclosed
   assumption.

2. **Recommended (not strictly required) cheap mitigation**, to close the free half of change #1 at
   near-zero cost: don't have `touchUpdatedAt` null out `last_idempotency_key` on a *keyless* append
   — only overwrite it when the incoming key is `Some`. Since `/messages` currently has zero real
   callers and the only real converse caller (`MessageComposer`) will always attach a key once this
   ships, a keyless append is either dead code today or (if ever wired up) genuinely ambiguous about
   whether it "supersedes" an outstanding keyed retry — leaving the last real key in place rather
   than nulling it is strictly safer and doesn't cost anything the design doesn't already have. This
   doesn't close the different-tab/different-key sub-case (which requires change #1's disclosure
   either way), but it's a one-line strengthening worth adopting.

### Non-blocking notes

- A timeout-retry race (the D3 same-key case, before either side has appended) causes a **second,
  full Claude API call** for the retry even though no duplicate turn results — wasted latency/cost,
  not covered by either AC, not addressed anywhere in design.md. Worth a one-line acknowledgment but
  not blocking.
- Everything else — the D1 two-mechanism split, D4 replay-response shape (dropping the HEL-667
  ephemeral badge signals), D5 wire contract, D6 client key lifecycle/reconciliation, the
  create-idempotency Non-goal, and all task-level file/line targets — checked out cleanly against
  ground truth with no placeholders, contradictions, or missing contract updates found.
