## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `d8e43ec95277f87a4c9f3ccb6cad0d60c876c7a0` against base `56b4ae1ffa590fe40065da983cb6234094cb5520` (resolved live).
Verdict category: `mechanical` (a shared e2e spec fails, a new backend test is flaky, and required guard tests are missing or do not fail under their mutations).

### Gates I ran myself
| Gate | Result |
|---|---|
| `npm run lint` | pass |
| `npm run format:check` | pass |
| `npm test` (root jest plus the full frontend suite) | pass: 66 suites / 579 tests; 824 suites / 9963 tests |
| `npm --prefix frontend run build`, `typecheck` | pass |
| jest: insight panel, outputEditor, ask (`--testPathPatterns`) | pass: 42 suites / 560 tests |
| `npm run check:scala-quality` | clean (soft size warnings only) |
| `sbt -J-Xmx3g testFull` (nice 19) | **FAIL**. ScalaTest line: `Tests: succeeded 9978, failed 1, canceled 5`. Failing test: `InsightRenderServiceSpec` "stay succeeded and record a failed attempt when the model throws", `NoSuchElementException: empty.head` at InsightRenderServiceSpec.scala:107. The same spec passed 33/33 on a rerun, so the test is flaky (CR3). The 5 cancels are the existing report-only measurement specs. |
| e2e `hel1743-insight-refresh.spec.ts` | pass (1/1) |
| e2e `hel1744-insight-panel.spec.ts` | pass (5/5) |
| e2e `hel1746-ask-ui.spec.ts` | **FAIL 4/4** (light/dark x desktop/phone; CR1) |

Setup: lane servers via `start-servers.sh` on 7175/10082, lane DB `helio_hel1743` (`DATABASE_URL` set), and `ANTHROPIC_API_KEY` set empty. The backend logged `insight renders disabled ... Missing required environment variable ANTHROPIC_API_KEY`, so no model call was possible. I made no live model call and read no `.env` file. The eval user was created on the lane DB and deleted by exact id through `buildUserDeleteSql`. Servers were stopped with `stop-servers.sh`. Mutations ran in a throwaway detached worktree under `.concertino/scratch/HEL-1743/evalmut`, which has since been removed; the executor's worktree was never edited.

Evidence (persisted):
- `/home/matt/Development/helio/.concertino/runs/HEL-1743/evidence/.concertino/scratch/HEL-1743/eval-mutations.out`
- `/home/matt/Development/helio/.concertino/runs/HEL-1743/evidence/.concertino/scratch/HEL-1743/eval-testfull-failure.txt`
- `/home/matt/Development/helio/.concertino/runs/HEL-1743/evidence/.concertino/scratch/HEL-1743/eval-hookmut-excerpt.txt`

### Phase 1: Spec Review — FAIL
Issues:
- The pin fold-in (D13a) changed the behaviour that the merged sibling spec `e2e/hel1746-ask-ui.spec.ts` asserts, and that spec was not updated (CR1). Every new pin now shows "The last update failed" on a keyless backend.
- ER1 is only half met (CR2). Round 6 required this test: "run 2's write phase begins before render 1 starts and commits after render 1 reads its inputs". It is missing.
- Task 4.14 is marked done but its "disabled ops ignored" and "read Output on another node" tests do not exercise those cases (CR5).
- Constraints: C1, C3, C13, C14, C15, C16 and C18 are honoured in the diff and evidence. C12 is not satisfied as a whole (see the C12 section). C17 is not satisfied, because the ER1 overlapping case is untested.

### Phase 2: Code Review — FAIL
Production code reads correct against D1–D14. Issues:
- The `testFull` gate is red because of a fixture race (CR3).
- The guard test for hook placement does not fail when the hook is moved into the writes chain (CR4).
- The `mutations.md` R3b entry targets code that no longer exists (CR6).

### Phase 3: UI Review — PASS (except the hel1746 regression, counted in Phase 1)
- The panel Refresh button renders for the owner. Keyboard focus plus Enter posts `refresh` and gets `202`. It renders without breakage at 1440, 1100, 768 and 375 (at 768/375 the card shows the skeleton briefly after a resize, then the failed state).
- No console errors in the tested flows. The only error is a pre-existing `404 /schedule` on the pipeline page.
- The Output editor offers the selector "Model": Server default, Haiku 5.5, Sonnet 5.5, Opus 5.5.
- `PATCH` with `model:"claude-bogus"` returns 400, and the message names `model`.
- A refresh body of `{"trigger":"daily"}` returns 400.

### Named checks
- **ER1, overlapping — NOT VERIFIED.** The test "catch up a run that overlapped an in-flight render" starts run 2 after render 1 is already in flight, so run 2's `last_run_at` is later than render 1's start. That does not reproduce the round-6 counterexample (`L2 < s1`). I applied a mutation that removes the overlap grace (`InsightSchedule.scala:40`, `!run.isBefore(att.minus(overlapGrace))` changed to `run.isAfter(att)`), and the whole spec stayed green (33/33). The code implements the grace, but nothing tests it.
- **ER1, success then a failed run — VERIFIED.** I applied a mutation that limits the candidate `last_run_at` to `last_run_status='succeeded'`. Exactly "catch up a throttled success even though a failed run came after it" went red.
- **ER2 — VERIFIED.** A mutation of `(row.status != Failed || newest.model.isEmpty)` to `true` made "never alter a failed row that carries a model, tokens or cost" go red. The code at `InsightRenderService.scala:327` is correct.
- **Run unaffected by a render failure or timeout** — the code is correct: `published.foreach` side callback, and the future is returned unchanged (`PipelineRunSucceededWrites.scala:335-347`). The guard is weak (CR4): with the hook mutated into the writes chain, "stay succeeded ... when the model never answers" still passed in my run. The log shows the render timing out at 3 s while the test passed (eval-hookmut-excerpt.txt). Only the incidental ER1 overlapping test went red.
- **Free tier: zero sends, one coalesced `skipped_quota` row** — covered by tests that pass.
- **Ten identical runs, one call** — covered. A digest mutation adding `capturedAt` turns it red; I reproduced that.
- **R1 model key** — `OutputConfigValidation.isSelectableModel` feeds create, update, draft save and patch-set via `validate`, and `PipelineCreatePreflight`/`InsightReadsCheck` via a required parameter. Covered by unit tests plus my live PATCH 400. The wire test asserts none of temperature/top_p/top_k/thinking/tool_choice/budget_tokens for each catalog model.
- **R2 weights 1/4/8 plus the env override (6), owner uncounted, AI step weight 1** — covered.
- **R3/R3b per role on both GET routes** — covered. My equivalent mutation on `OutputInsightRecord.forViewer` turned both R3b tests red.
- **Refresh route** — 202, viewer 403, one 404 for stranger/unknown/non-insight, own limiter (the 7th request is 429), pin trigger. Covered by route tests, the e2e and my manual check.
- **InsightRendered seam / `latestFor`** — covered.
- **Daily at 06:00 UTC on the existing tick, two-instance lock** — covered (05:59 none, 06:00 one, 06:10 and 06:30 none; two instances make one send; a held lock skips).
- **D14 cap 4096 on the wire** — covered. Reverting `MaxOutputTokens` to 400 turns both tests red; I reproduced that.
- **Failed rows that reached the model carry usage and cost** — covered. A mutation dropping usage from failed rows turns it red; I reproduced that.
- **D13 fold-ins** — the refresh button, model selector and quota wording are present and tested. Render-on-pin is present, but it breaks hel1746 (CR1).
- **Live evidence** — accepted. Render 2 logs `requesting model 'claude-haiku-5-5'` at INFO before the call, and both hops log `requested=claude-haiku-5-5 response-model=claude-haiku-5-5`. There were exactly two hops (the original plus the single validator retry), both `end_turn`. The row is `ok` with `cost_micros` 1155 ($0.0012), well under $0.50. Total across both renders is about $0.0015.

### C12 (red first) — honest judgement
- **Stage 1 and cycle 2 are credibly red first.**
  - Stage 1 has compile red, then assertion red on `OutputKindDriftSpec`.
  - Cycle 2 has assertion reds such as `400 was not equal to 4096` and `(None,None,None) was not equal to ...`, recorded before the fix.
- **Stages 2–4 are not red first, and the executor says so.**
  - The "stash main, then `Test/compile`" red only proves the tests reference APIs that did not exist yet. It is not a behavioural red.
  - The first-run failures listed in red-runs.md were fixture defects, not behaviour under test.
- **Re-running the recorded mutations:**

  | Mutation | Result in my run |
  |---|---|
  | digest | red, reproduced |
  | ER2 | red, reproduced |
  | ER1 catch-up (my variant) | red, reproduced |
  | D14 | red, reproduced |
  | failed-row usage | red, reproduced |
  | R3b | Cannot be re-run as recorded: its target, `if (!privileged && (r.status` in `OutputInsightProtocol.scala`, is not in the committed code. The logic now lives in `OutputInsightRecord.forViewer`. An equivalent mutation does turn the tests red. |
  | Hook placement | The "re-run alone ... FAILED" claim in mutations.md did not reproduce. The dedicated test passed under the same mutation in my run. |

- **Two extra mutations of mine survived:**
  - the overlap grace;
  - `parentChainOps`' `.filter(_.enabled)`.
- **Verdict on C12:** the evidence is NOT sufficient. Most guards are real and failable. However, the hook-placement guard (a named acceptance criterion), the ER1 overlap guard (a named execution requirement) and the disabled-step guard have no test that fails under their defect, and one recorded mutation is stale.

### Overall: FAIL

### Change Requests
1. **Fix the hel1746 e2e regression.** `e2e/hel1746-ask-ui.spec.ts:396` expects "Not yet rendered" after a pin. Because `useAskPin.ts:53` now starts a `pin` refresh, the keyless e2e backend records a no-model `failed` attempt, and the card shows "The last update failed / No insight has been rendered yet. / Refresh" (all 4 variants fail).
   - Update the assertion to the new contract: the card shows the keyless failed state, and `GET /api/outputs/:id/insight` has `lastAttempt.trigger == "pin"`. Alternatively, take a different approach agreed in design D13(f).
   - Then rerun all three e2e specs (hel1743, hel1744, hel1746) with 2 workers on the lane DB, and record the results.
2. **Add the ER1 overlapping test that round 6 required.** In it, run 2's write phase begins (its `last_run_at` is stamped) BEFORE render 1 starts, and run 2 commits AFTER render 1 has read its inputs, so `last_run_at(run 2) < render1.created_at`.
   - Assert that the tick pass after the hour renders run 2's data.
   - One way to set this up: drive `last_run_at` and the render start from the shared `ShiftedClock`, or hold run 2's writes chain with a gate.
   - Record the mutation `InsightSchedule.scala:40` → `run.isAfter(att)` going red in mutations.md.
3. **Fix the flaky `RecordingTrigger`** (`InsightRenderFixture.scala:69-83`). `calls.incrementAndGet()` runs before `futures.add(f)`, so `settle(n)` can see `calls >= n` while `futures` is still empty. It then awaits nothing, and `rowsOf(...).head` throws, as it did at InsightRenderServiceSpec.scala:107 in my `testFull` run.
   - Add the future before incrementing, or make `settle` wait until `futures.size >= n`.
   - Then rerun `sbt testFull` to green.
4. **Make the hook-placement guard fail first.** "stay succeeded, with the same event sequence, when the model never answers" (InsightRenderServiceSpec.scala:65) passed with the hook moved into the writes chain (`published.flatMap(v => insightTrigger.afterRunSucceeded(...).map(_ => v)...)`).
   - Use a render timeout far longer than the assertion window (e.g. 60 s), keep the model promise pending, and assert that `realRun` returns and the `succeeded` event arrives while the render is still in flight (`model.sends == 1`, no row yet). Only then release the promise.
   - Re-record that mutation as red in mutations.md, and correct the current "re-run alone" paragraph.
5. **Replace the vacuous inputs tests** at InsightRenderServiceSpec.scala:549-551. `parentChainOps(Vector.empty, None) shouldBe Vector.empty` does not exercise disabled steps.
   - Add a test with a disabled step on the parent chain whose op would change the inferred preset (or the returned ops), and assert it is excluded.
   - Fix "leave the preset alone for a read Output on another node" (line 539): it reads `["gone", insight]`, not an Output on another node. Seed a metric-with-compare Output on a different node, list it in `reads.outputs`, and assert the preset is unchanged.
   - Record the `.filter(_.enabled)` mutation going red.
6. **Re-record the stale R3b mutation** in `evidence/mutations.md` against `OutputInsightRecord.forViewer` (`status = ...NotUpdated else status` → `status = status`). Make sure every entry's target string exists in the committed code.

### Non-blocking Suggestions
- `InsightRenderService.scala` is 364 lines (soft budget 250). Consider moving the tick-pass section or `rowFor`/`write` into a collaborator.
- `InsightDigest.scala:43`: inline `java.lang.Double.toString`. Import `java.lang.{Double => JDouble}` per CONTRIBUTING's imports rule (the checker does not flag `java.lang`).
- `evidence/live-check.md`, render 2: "The same insight Output ``" has an empty id (it should be `c7fe3033-...`).
- The panel now shows two adjacent refresh controls with different meanings: the chrome "Refresh Eval insight panel" (re-read) and the new "Refresh" (re-render), and the new one sits inside a `role=status` region. Left to the skeptic for wording and placement.
- `useOutputKindState.ts`: `insightModel`/`setInsightModel` are declared between `insightPrompt` and `setInsightPrompt`. Reorder for readability.
- The model-key 400 is tested at the validator and preflight level. One route-level test on `PATCH /api/outputs/:id` would pin the wiring.
