## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review of commit `874c81041a901a4b4dee7d288b0f79f7aab3d36c` (single commit atop main's
`996f6501`), branch `bug/chat-send-idempotent-retry/HEL-698`. Evaluator cycle 1 PASS treated as a
claim, not fact — independently re-derived every conclusion below from the diff, the specs, and a
live-running instance.

### What I verified (with evidence)

**1. Diff read in full** (`git show 874c8104`) across all 17 non-openspec files: migration
(`V87__assistant_conversation_idempotency_key.sql`), `RequestValidation.scala`,
`AssistantConversationProtocol.scala`, `AssistantConversationRoutes.scala`,
`AssistantConversationRepository.scala`, `AssistantConversationService.scala`, the three backend
spec files, `assistantConversationsService.ts`/`.test.ts`, `assistantConversationsSlice.ts`/`.test.ts`,
`types.ts`, `MessageComposer.tsx`, `MessageComposer.test.tsx`, `ActiveConversationPanel.test.tsx`,
both JSON schemas, and both spec deltas. Confirmed the implementation matches design.md D1–D6
literally: two independent replay checks (route-entry in `converseFlow`, append-time in
`appendTurn`), the `Some`-writes/`None`-leaves-untouched `touchUpdatedAt` semantics, the wire
contract (`jsonFormat1→2`, `jsonFormat7→8`, both schemas gain the matching optional fields), and the
composer's `pendingSend` key-lifecycle + slice-level reconciliation-on-rejection.

**2. V87 migration number is correct** — `ls backend/src/main/resources/db/migration/` shows V86 as
the prior max on main; V87 is the next free slot, no collision. The dev backend (already running on
port 9037 for this worktree) applied it live to the shared dev Postgres without error (see live
checks below) — no `flyway_schema_history` conflict encountered.

**3. AC1 traced to code AND reproduced live against the real backend** (not just unit tests):
created a fresh conversation via the running app's own session
(`POST /api/assistant-conversations`, id `c4f982f2-ab00-405e-8ee2-90a045403b69`), then issued two
`POST .../converse` calls with the identical `idempotencyKey: "skeptic-live-key-1"` directly against
the live backend (port 9037, via the 6130 proxy). Result: both returned `200`, both
`lastIdempotencyKey === "skeptic-live-key-1"`, and the transcript stayed at **2** entries after the
second call (no duplicate turn) — confirmed again by loading the conversation in the real UI
(showed "2 messages"). This exercises the exact route-entry + append-time double-check design.md D3
describes, end-to-end through real Postgres, not a stub.

Also independently confirmed the *test* coverage genuinely exercises this: `AssistantConversationRoutesSpec`'s
"a second converse with the SAME key is a no-op replay" test asserts
`transport.receivedRequests should have size 1` — a regression to either check would make this test
fail by re-invoking the Claude transport, not merely fail to throw. Re-ran this suite fresh:
46/46 pass (`sbt testOnly ...AssistantConversationRepositorySpec ...AssistantConversationServiceSpec
...AssistantConversationRoutesSpec`).

**4. AC2 traced to code AND reproduced live in the real browser UI**, including the "landed but
client sees failure" race the ticket itself describes: monkey-patched `XMLHttpRequest` in-page to
let one live `POST .../converse` call actually complete against the real backend (turn genuinely
persisted — confirmed via the network log: request #357 shows the underlying request DID return
`200`), then forced the axios promise to reject anyway (simulating exactly the "response fails to
reach the client after landing" failure mode from `ticket.md`'s root-cause section). Observed:
- the thunk's rejection handler fired and issued a follow-up `GET
  /api/assistant-conversations/:id` (network log entry #358, confirming reconciliation actually ran,
  not merely available in test mocks)
- `lastIdempotencyKey` matched → `converse.fulfilled` path taken → transcript grew from 2→4 messages
  (new turn genuinely appeared), input field cleared, **no error banner rendered**, zero console
  errors
- Screenshot taken and inspected (`hel698-dark.png`, dark theme) — no stray error text, transcript
  render matches the existing turn bubble pattern used elsewhere in this view; deleted the stray
  screenshot afterward (a known artifact of this codebase's shared-Playwright-session hazard across
  concurrent worktrees, not a defect).

The evaluator's own live check covered the mirror case (genuinely-down backend → real failure UX,
error shown, input preserved) — I did not re-run that one since it's a lower-risk path (no
reconciliation branch to verify) and the report's description of it is internally consistent with
the code.

**5. Gates re-run fresh, not trusted from the evaluator's paste:**

| Gate | Result |
|---|---|
| `cd backend && sbt test` (full suite) | PASS — 3101 tests, 194 suites, 0 failed |
| `cd backend && sbt testOnly` (3 changed specs only) | PASS — 46/46, includes the idempotency-specific describe blocks |
| `cd frontend && npm test` (full suite) | PASS — 1863 tests, 180 suites |
| `cd frontend && npm test -- --testPathPatterns=assistant` | PASS — 86/86 |
| `cd frontend && npm run lint` | PASS — zero warnings |
| `cd frontend && npm run format:check` | PASS |
| `npm run check:schemas` | PASS — 61 protocols in sync |
| `npm run check:scala-quality` | PASS (clean; only pre-existing soft-budget line-count notes, none newly crossing a threshold because of this diff — `AssistantConversationServiceSpec.scala` at 269 lines and `AssistantConversationRepositorySpec.scala` at 312 are informational-only per CONTRIBUTING.md and this codebase's tests routinely exceed the soft budget) |
| `npm run check:openspec` | Expected-fail: "complete (20/20) but not archived" — matches the disclosed, accepted pre-archive deviation; not a defect |

**6. Design-gate decisions not re-litigated.** The multi-sender reset race (Planner Notes) and the
keyless-append-leaves-key-untouched semantics (D2) were both already skeptic-approved at the design
gate (skeptic-design-1/2.md). Checked only that the IMPLEMENTATION matches what was approved — it
does (`touchUpdatedAt`'s two-branch `updateAction`, verified directly in the diff and by the
`AssistantConversationRepositorySpec` "None key leaves a previously-set value untouched" test, which
I also confirmed passes).

**7. No UI/CSS surface changed** — `git diff --stat` confirms no `.css` file touched. No new DOM
elements introduced beyond the existing `InlineError`/spinner patterns already reused unchanged.
Light/dark parity risk from this diff alone is therefore inherently low; the dark-theme screenshot
above shows no visual regression in the one screen this diff touches (`/chat`).

### Verdict: CONFIRM

Both acceptance criteria are met and independently reproduced against a live backend + live UI, not
merely asserted by prior agents. All gates re-run fresh and green. The one `check:openspec` "fail"
is the explicitly pre-approved pre-archive deviation. No design-gate-approved trade-off was
re-flagged. No new defect found in the implementation, tests, or spec deltas.

### Non-blocking notes

- `MessageComposer`'s `pendingSend`/`message` local state is not reset on a `conversationId` prop
  change (no `key={conversationId}`, no reset effect) — pre-existing behavior, not introduced by
  this diff, and mechanically harmless here since the idempotency key is scoped server-side per
  conversation id (a stale key reused against a different conversation is just an opaque UUID, not a
  false replay). Worth a UX look independently of this ticket if it hasn't been already.
- Same non-blocking items the evaluator already flagged (missing `scripts/concertino/emit-event.sh`
  in this worktree; `AssistantConversationRoutesSpec.scala` now 475 lines) are environmental/informational
  only — confirmed, not re-flagging as new.
