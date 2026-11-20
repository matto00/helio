## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 889e0c98f824938950d97af3eef49c3144196eb2. Base resolved live with resolve-review-base.sh: fef01cda9c089e90c2f93f65e1b59ee1f11d8a16. Working tree clean apart from the untracked evaluation-3.md.

### What I verified (with evidence)

**Diff read in full** (backend main, schema, frontend). Key mechanics:
- `ClaudeClient.loop`: `classify` runs only on calls that were actually dispatched (`!rejected.contains(tu.id)`). Failures are totalled across round trips. The budget check runs after the round trip's results and before the next round trip's hop check, so a third failure on round trip 12 is `failure_budget`. With `stopOnInputBudget && hopsUsed >= 1` the loop returns `InputBudgetExhausted`; hop 1 still returns `Failed(GuardrailExceeded)`. `failureBudget = None` follows the old path unchanged.
- `AssistantService` passes `maxHops = HopCeiling (12)`, `failureBudget = Some(3, classify)` and `stopOnInputBudget = true`. The old "Reached the maximum number of tool calls" string is gone; grep finds no hit in backend/main or frontend/src.
- `AssistantStopMessages.classify` counts `isError`, plus `test_connection` with JSON `ok:false` (the message comes from the `error` field, else a fixed phrase). Messages are built from classified text and never from raw JSON.
- Ask loop and insight client got exhaustive-match arms only. AskDataService `MaxHops = 4` is untouched.
- The beta charge site in AssistantConversationRoutes is unchanged; only the telemetry and response fields were added.

**Fresh test runs** (ANTHROPIC_API_KEY empty, lane DB, `-J-Xmx3g`, nice 19):
- `testOnly ClaudeClientSpec AssistantServiceSpec AssistantTelemetrySpec AssistantSystemPromptSpec ClaudeInsightClientSpec`: 5 suites, 112/112 passed (scratch `skeptic-shard1.txt`).
- `testOnly AssistantConversationRoutesSpec AskDataServiceSpec`: 2 suites, 45/45 passed (scratch `skeptic-shard2.txt`).
- Frontend jest `features/assistant`: 16 suites, 149/149 passed.

**Acceptance criteria traced:**
1. **6-successful-hop turn completes.** The AssistantServiceSpec test "complete a turn of 6 successful round trips followed by a final answer" passes. It asserts `hopBudgetExhausted false` and 7 transport calls. With the old MaxHops=4 the old code cuts the loop off at round trip 5, so this test is red there. That is confirmed by `.concertino/scratch/HEL-1637/red-run.txt` ("1 TEST FAILED" on exactly this test) and by mutation M4 in `mutations.md`.
2. **3 failures stop with a plain message, and the ceiling stops a pathological loop.** Tests cover:
   - failures interleaved with successes: total counting, with `hopsUsed 5` and the persisted assistant stop turn;
   - `test_connection ok:false` x3, giving "couldn't connect to the source after 3 tries" with no `{` and no `"ok"` in the text;
   - a third failure on round trip 12, which stops as failure_budget;
   - the ceiling: 13 responses, 13 transport calls, `hop_ceiling`, the dangling tool_use preserved.
   In ClaudeClientSpec: the exact transport count, once-per-response rejections not counted, and every parallel result returned.
3. **Web search, beta limit and input limit are unchanged and tested.**
   - "omit web_search after webSearchMaxUses across more than 4 round trips" passes.
   - Routes: "charge a beta turn of 7 round trips exactly the model weight once" (sonnet weight 4, so a per-hop charge would read 28) passes.
   - Hop-1 overrun: zero transport calls and `Failed` / 422 with nothing persisted (client, service and route tests).
4. **Measurements in the PR.** pr-notes.md reproduces turn-measurements.md faithfully: local hops 1:13, 2:5, 3:8, 4:1 censored at 4; prod calls 2,6,3,3,8,4,12 and failures 0,1,3,1,4,0,12. It also says plainly that the ceiling is an owner ruling and not a measurement.

**System prompt:** the hard rule is interpolated from `HopCeiling`/`FailureBudget` ("up to 12 hops ... stops after 3 failed tool calls"). AssistantSystemPromptSpec asserts it.

**Iron laws:** the red run is recorded. The mutation log `.concertino/scratch/HEL-1637/mutations.md` shows M1 to M8 each turning tests red. M7 was not red at first; the assertion was strengthened and then went red, which the log states honestly. I did not re-run the mutations (the skeptic is read-only). The tests I read assert the mutated properties directly.

**UI (my domain):** I started the servers with start-servers.sh; assert-phase servers PASS. I used a throwaway owner-tier user, `skeptic1637@example.com`. The real backend persisted the turns through the `/messages` append route. Only the converse POST was answered by an in-page XHR stub with the server's stop shapes, since no model was available.
- failure_budget, dark theme: the note "STOPPED AFTER REPEATED ERRORS" plus the server message, in the existing hop-budget bubble treatment (amber border, eyebrow note). Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1637/evidence/.skeptic-failure-dark.png`
- failure_budget, light theme: parity holds and contrast is fine. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1637/evidence/.skeptic-failure-light.png`
- hop_ceiling, dark theme: the fallback bubble shows "COULDN'T FINISH IN ONE GO" and "I stopped after 12 steps...". The `document.body` text contains neither "lookups" nor "maximum number". Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1637/evidence/.skeptic-ceiling-dark.png`
- No new CSS or component: it reuses `message-turn--hop-budget-exhausted` and `message-turn__outcome-note`, consistent with the sibling "Asking a follow-up" note.

The evidence is screenshots I captured and read myself. No claim here rests on mtime ordering.

### Verdict: CONFIRM

### Non-blocking notes
- pr-notes.md says "productive turns show 0-3 failures". Prod turn 5 was productive (it recovered) but had 4 raw failures, all parallel `propose_pipeline` calls. Under HEL-1639 and the per-call counting here, that would count as 1. Turn 3 (3 of 3 failed) is not clearly "productive". A one-line precision fix in the PR body would be enough.
- pr-notes.md cites `red-run.txt` and `mutations.md`, but both live only in `.concertino/scratch/HEL-1637/` and not in the durable evidence dir. Persist them before cleanup if the PR is meant to point at them.
- The failure-budget stop shows the note only on the live turn. After a reload the persisted stop text renders as a plain assistant bubble. That is acceptable: the text itself says what happened.
- Residue: my throwaway user was deleted from helio_hel1637 by exact id (buildUserDeleteSql). Its conversation file is still in the home directory, at `~/.helio/uploads/assistant-conversations/67f71f1f-0de3-45ee-84dd-aaa963b73cd8/`. I did not delete it because the home-directory rule requires approval.
