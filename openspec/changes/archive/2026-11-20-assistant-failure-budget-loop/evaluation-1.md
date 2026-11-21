## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: b521e77d17a99bac68b8aa0bdf4ca9e68cfd34c1 (base fef01cda9c089e90c2f93f65e1b59ee1f11d8a16, resolved live with resolve-review-base.sh).

### Phase 1: Spec Review — FAIL

What holds:
- AC1 (6 successful round trips then a final answer complete): `AssistantServiceSpec` "complete a turn of 6 successful round trips followed by a final answer" passes on HEAD. The committed red run (`red-run.txt`, commit b79d8309f) shows it failing on the old code.
- AC2 (3 failures give a plain-language stop, and the ceiling still stops): `ClaudeClientSpec` and `AssistantServiceSpec` cover the 3rd failure with an exact transport-call count, interleaved successes, test_connection `ok:false` without raw JSON, the proposal wording, a 3rd failure on round trip 12 ending as `failure_budget`, and a ceiling of 12 (13 transport calls, the 13th tool_use not executed).
- AC3 (budgets unchanged):
  - Web search: `ClaudeClientSpec` "omit web_search after webSearchMaxUses across more than 4 round trips". I re-checked it with my own mutation, resetting `newWebSearchUsed` each hop; the test went red (`eval-mut-websearch.txt`).
  - Beta charge: the routes spec shows a 7-round-trip beta turn raises `assistant_daily_usage` by exactly the model weight, once. The charge site in `AssistantConversationRoutes` is unchanged.
  - Input refusal: a hop-1 overrun is still `Failed(GuardrailExceeded)` with zero transport calls, and the route still returns 422 with nothing persisted (routes spec plus client spec).
- AC4 (measurements in the PR): `pr-notes.md` carries the measured numbers (27 local turns with hops 1:13 / 2:5 / 3:8 / 4:1, censored at the cap; the 2026-10-16 transcript's calls and failures per turn). It says plainly that the ceiling of 12 is an owner ruling, not a measurement. It also covers the D1 reasoning and the HEL-721 interaction.
- Ask loop: untouched apart from the exhaustive-match arms (D9). Tasks are all checked and match the code.
- `workflow-state.md` CONSTRAINTS is `[]`. The lane constraints in tasks.md were respected (no live model call, fake transport).
- Web client: the "3 lookups" text is gone from `frontend/src` (the only hit is the negative assertion at `ActiveConversationPanel.test.tsx:388`).

Issues:
1. **The model is still told it has 4 hops (this misses the ticket's intent).** `backend/src/main/scala/com/helio/services/assistant/AssistantSystemPrompt.scala:154` still says "Hard rules: - You have at most 4 hops (tool-call round trips) to reach an answer." This hard rule ships on every hop of every turn. The server now allows 12 round trips and 3 failures, but the prompt tells the model to finish within 4. So in real turns the model is pushed to wrap up or give up at about 4, which is the behaviour the ticket exists to remove ("agents need more turns than we generally give them"). The fake-transport tests cannot catch this because they script the model's responses. `AssistantSystemPromptSpec.scala:95-96` ("state the updated 4-hop cap") pins the stale text. Precedent: HEL-756 changed this prompt line in the same change that raised `MaxHops` from 3 to 4.
   - design.md's non-goal "Prompt or tool-schema changes (HEL-1639)" defers prompt *improvements* to HEL-1639. It does not cover a hard rule that now states a cap the code no longer has. Neither design.md nor the skeptic reports mention this line.
2. **Missing spec delta for `chat-message-rendering`.** The canonical requirement "A turn signals when the assistant asked a follow-up or hit the hop cap" (`openspec/specs/chat-message-rendering/spec.md:89-108`) describes only `hopBudgetExhausted`/`searchedWithNoResults` and a "couldn't finish in time" treatment. The change adds `stopReason`-driven notes ("Stopped after repeated errors", "Stopped: conversation too long"), renames the ceiling note to "Couldn't finish in one go", and makes the fallback bubble render the server `stopMessage`. No delta records any of this, so the archived spec would be wrong about the shipped UI.

### Phase 2: Code Review — FAIL (one mechanical doc defect; gates all green)

Gates, run fresh in WORKTREE_PATH (logs in `.concertino/scratch/HEL-1637/eval-*.txt`):

| Gate | Result |
| --- | --- |
| Backend touched packages (assistant, ai, routes.assistant, ask, eval, insights) | 414 / 414 passed |
| `testOnly com.helio.api.routes.pipelines.*` | 1063 / 1063 passed |
| `testOnly com.helio.api.*` (excluding pipelines and assistant routes) | 1816 / 1816 passed |
| `testOnly com.helio.services.*` (excluding the touched packages) | 2300 passed, 5 canceled (pre-existing), 0 failed |
| All remaining packages | 4580 / 4580 passed |
| Backend total | 10173 tests, 0 failed, no compile warnings |
| `npm run lint` | clean |
| `npm run format:check` | clean |
| `npm run typecheck` | clean |
| `npm test` (root + frontend, 3 workers) | 617 + 10395 passed |
| `npm --prefix frontend run build` | OK |
| `check:schemas`, `check:spec-structure`, `check:openspec`, `check:scala-quality` | all pass |

Independent mutation re-runs, done in a throwaway detached worktree that has since been removed:
- Counting the once-per-response rejections as failures turns "not count once-per-response rejections as failures" red (`eval-mut-m2.txt`).
- Resetting the web-search count each hop turns the >4-round-trip web-search test red.

The executor's own mutation log agrees on M1-M7. I did not re-run M1 or M3-M7 myself.

Code-quality findings:
- **[mechanical] Doc comment detached from its function:** `frontend/src/features/assistant/ui/ActiveConversationPanel.tsx:23-27`. `CEILING_FALLBACK_TEXT` was inserted between `isVisibleTextBlock`'s JSDoc (line 23, "HEL-1636: a text block with something to show") and the function itself (line 27). The HEL-1636 comment is now orphaned above another JSDoc, and the function has no doc.
- Loop logic (`ClaudeClient.scala:151-160`) matches D1/D2: only dispatched calls are classified, failures are totalled across hops, and the budget check runs before the next round trip's ceiling check. The mid-loop input stop is gated on `hopsUsed >= 1` (D4).
- Stop messages come only from `classify`'s plain text. test_connection JSON is parsed for `error` and never echoed raw.
- Telemetry adds only integers and a fixed token.
- Schema, protocol and TypeScript types agree. `stopReason`/`stopMessage` are absent on GET (tested).
- Types are safe throughout; there is no dead code.

### Phase 3: UI Review — PASS

The servers were started with `start-servers.sh` on the lane DB `helio_hel1637` with `ANTHROPIC_API_KEY` empty, and `assert-phase servers` passed. A throwaway owner-tier user was registered and later deleted by exact id with `buildUserDeleteSql`. The servers were stopped with `stop-servers.sh`.

No model was available, so the converse POST was answered in-page by an XHR stub returning each `stopReason` shape the server produces. Every other request went to the real backend. Results:
- **failure_budget:** the last assistant turn shows the "Stopped after repeated errors" note and the server message ("I couldn't connect to the source after 3 tries. The last error was: DNS resolution failed ..."). No "3 lookups" anywhere. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1637/evidence/.concertino/scratch/HEL-1637/eval-ui-failure-budget.png`
- **hop_ceiling:** the fallback bubble shows "Couldn't finish in one go" and the server `stopMessage` ("I stopped after 12 steps ..."). Body text has no "3 lookups" (`document.body.innerText.includes('3 lookups') === false`). Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1637/evidence/.concertino/scratch/HEL-1637/eval-ui-hop-ceiling.png`
- **input_budget:** shows the "Stopped: conversation too long" note and the message. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1637/evidence/.concertino/scratch/HEL-1637/eval-ui-input-budget-1440.png`
- **Breakpoints:** at 375 (initial viewport), 768, 1100 and 1440 there is no horizontal overflow (`scrollWidth === clientWidth`), and the note stays inside the bubble.
- **Console:** no errors from this flow. The only console errors came from other lanes on port 7128 sharing the browser, plus my own first register attempt without the CSRF header.
- **Accessibility:** the notes are plain text inside the existing `role="log"` region. No new interactive elements.

Side observation, not attributed to this change: on the very first send of a brand-new conversation, the stubbed response was overwritten by the real GET of the then-empty conversation. This comes from the stub (the server had persisted nothing). In a real run the server persists the turn before responding, so this does not show up.

### Overall: FAIL

### Change Requests
1. **Update the hop rule in `backend/src/main/scala/com/helio/services/assistant/AssistantSystemPrompt.scala:154-155`.** Replace "You have at most 4 hops (tool-call round trips) to reach an answer." with wording that matches the new loop. For example: "You have up to 12 tool-call round trips per turn, and the turn stops after 3 failed tool calls. Use them efficiently ..." (keep the "search before proposing, don't repeat a call" guidance).
   - Then update `backend/src/test/scala/com/helio/services/assistant/AssistantSystemPromptSpec.scala:95-96` to pin the new text, ideally by interpolating `AssistantStopMessages.HopCeiling`/`FailureBudget` so the prompt and the constants cannot drift apart again.
   - Add a scenario to the `assistant-conversation-loop` delta stating that the system prompt names the ceiling and the failure budget.
   - If the orchestrator reads design.md's prompt non-goal as forbidding this, that conflict needs an owner ruling rather than shipping a prompt that contradicts the loop.
2. **Add a `specs/chat-message-rendering/spec.md` delta.** MODIFY "A turn signals when the assistant asked a follow-up or hit the hop cap" so that it:
   - names `stopReason` (`failure_budget` → "Stopped after repeated errors", `input_budget` → "Stopped: conversation too long");
   - renames the ceiling treatment to "Couldn't finish in one go";
   - states that the ceiling fallback bubble renders the converse `stopMessage`, with a generic fallback text and never a hop count.
3. **Fix the detached JSDoc in `frontend/src/features/assistant/ui/ActiveConversationPanel.tsx:23-27`.** Move the `CEILING_FALLBACK_TEXT` constant and its comment above line 23 (or below `isVisibleTextBlock`), so the HEL-1636 comment sits directly on `isVisibleTextBlock` again.

### Non-blocking Suggestions
- `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProtocol.scala:25` still says "the hard 3-hop cap". Change it to "the hop ceiling (12)".
- `ActiveConversationPanel.tsx` (around line 188, the comment above `showHopBudgetFallback`) still says "couldn't finish in time". Align it with the new note text.
- Two wordings have no test: "I couldn't put together a valid proposal after N tries" and "I couldn't read what I needed from your workspace after N tries". The propose-counter test at the end of `AssistantServiceSpec` could assert the proposal wording cheaply.
- `ClaudeClient.scala` (455 lines) and three spec files (765-943 lines) were already over the ~400-line soft budget and grew. Per CONTRIBUTING.md, `pr-notes.md` could propose a split.
- The web-search test uses `webSearchMaxUses = 1`. A case with the default 3, spread over hops 1/3/5, would show the tally carries across hops rather than only being spent on hop 1. The mutation above shows the current test already catches a per-hop reset.
