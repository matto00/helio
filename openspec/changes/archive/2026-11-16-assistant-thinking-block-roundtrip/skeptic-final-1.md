## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed head: 40eb222f4c2af1d81a63b954dd8c1423adf447c3. Review base, resolved live with
resolve-review-base.sh (exit 0): 0c699d2633e5dedbc14cb3bddaca6147dd6b6025.

### What I verified (with evidence)

- **Spawn-cwd guard:** assert-cwd.sh printed `READY ambient=/home/matt/Development/helio branch=bug/assistant-thinking-block-roundtrip/HEL-1636`.
- **Diff read in full** (`git diff 0c699d263...HEAD` over backend/src/main, the frontend panel, cd-backend.yml,
  deploy-backend.sh and CLAUDE.md). 59 files changed. The production code is limited to infrastructure/ai, the
  assistant service and route, the authoring and refinement error mappings, the repository block format and
  ActiveConversationPanel.

**AC1: seam test, red then green.**
- `AssistantThinkingSeamSpec` "save no empty assistant text and send no empty text or thinking block on the next
  turn" runs a real `AssistantService` and `ClaudeClient` over a recording transport. It uses the fixture
  `haiku55-thinking-then-text.json` (an empty `thinking` with a signature, then text).
- It round-trips the persisted turns through the repository JSON format and asserts four things: no `""` text, no
  `"thinking"` or signature in request 2, no empty text block, and the last message's role is `user`.
- The red run is recorded in evidence/red-first.md. On the unfixed code, `List("Hello", "", ...) contained element ""`
  appears in 6 failures.
- The fix that makes it pass: `ClaudeClient.toContentBlock`'s explicit `"text"`/`"thinking"`/`"redacted_thinking"`
  cases, and `AssistantService.persistable` (drops thinking, opaque and blank text from every returned turn while
  keeping the turn count).

**AC2: tool loop.** `ClaudeThinkingRoundTripSpec` asserts that hop 2's assistant message content is
JSON-equal to the fixture's hop-1 content: thinking with an empty string and `SIG_S1_opaque`, redacted_thinking
with its data, then tool_use. `ClaudeNoAnswerAndStripSpec` 5.6 covers the D3a strip point after a web-search tools
change. It also covers that a later thinking block stays byte-exact.

**AC3: guard.**
- The wire read has no `case _ => text` path. An unknown type becomes `raw = Some(obj)`, `text = None`
  (ClaudeProtocol.scala). The domain maps it to `Opaque` and writes it back verbatim.
- D5 normalisation (`ClaudeHistoryNormalizer.normalise`/`normaliseText`) drops blank text blocks and empty messages
  on both request paths.
- The guard spec sends `future_block_kind` back with its nested fields intact, and asserts that no empty text block
  is sent and no `""` Text is in the history.

**AC4: sampling and refusal.**
- `wireTemperature` omits 1.0, and the protocol writes `temperature` only when it is `Some`. The spec asserts the key
  is absent, there is no `top_p`, and 0.5 is still sent.
- A refusal is `NoAnswer(Some("refusal"), category)` on `sendWithTools` and `send`. It maps to 502 with the shared
  message on the assistant route, authoring and refinement, and to `Api(0, ...)` in AI steps.
- A blank stream fails without a repair call.
- `max_tokens`/`pause_turn` with no visible text becomes NoAnswer. Prefill: every request ends with a user turn
  (spec 5.5).

**AC5: deploy pin.** `CLAUDE_MODEL=claude-haiku-5-5` is in cd-backend.yml `--update-env-vars` and in
deploy-backend.sh `--set-env-vars`. Neither file has a remaining haiku-4-5 value. The CLAUDE.md row is updated.

**AC6: live check.** I made no API calls. I grepped `.concertino-backend.log` myself:
- All 7 cited request-ids log `status=200`.
- There are 0 `Invalid signature` matches and 0 `status=4xx/5xx` lines.
- Telemetry shows `"modelId":"claude-haiku-5-5"` 3 times (A2 turn 1, A2 turn 2, B).
- AC6 is met as written: the 2-message conversation and the web-search conversation both succeeded.

**Gates re-run by me:**
- `SBT_OPTS=-J-Xmx3g nice -n 19 sbt "testOnly com.helio.infrastructure.ai.* com.helio.services.assistant.* com.helio.api.routes.assistant.* ...RefinementServiceSpec ...DashboardAuthoringServiceSpec"`
  reported:
  - `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`
  - `Suites: completed 23`
  - `Tests: succeeded 286, failed 0`
  - `All tests passed.`
- `npm --prefix frontend test -- --testPathPatterns=ActiveConversationPanel`: 22 passed.
- For the full-suite numbers I rely on evaluation-2's pasted summary: sbt testFull 9569/0, and jest 765 suites /
  9407 tests.

**UI (step 4).** The only UI change is `isVisibleTextBlock`. A blank or whitespace text block now returns `null`
instead of a `MessageTurn`, and the same predicate gates the hop-budget fallback.
- The change adds no CSS, no tokens, no markup and no new components.
- Its only visual effect is that an empty bubble is no longer drawn. The jest test asserts this by counting
  `.message-turn` elements (2, not 4).
- I did not start servers or take screenshots. Reproducing it would need a hand-seeded legacy transcript in the
  shared dev DB (residue) to observe the absence of an element, and the DOM assertion already proves that. Light/dark
  parity is unaffected because no styling changed.
- The `lastBlockKey` decoration can only attach to a blank last block in a legacy transcript, and `lastTurnOutcome`
  is only set for a fresh turn, which the backend now never persists with blank text. So no live decoration is lost.

**Design judgment on the backend shape.**
- The strip rule compares serialized `tools` per hop. `system` is constant within a loop now that HEL-1718 is on
  main.
- The persisted-history drop happens in the service layer, and the repository cases exist only to keep the match
  exhaustive.
- The error-mapping sites are exhaustive: every `ClaudeError` match in main code has a `NoAnswer` case, found by grep.
- Sound.

### Verdict: CONFIRM

### Non-blocking notes
- The live check cannot show that Haiku 5.5 actually emitted thinking blocks on these prompts, because persisted
  transcripts drop them. The signature round-trip is proven by the recorded-fixture specs only. The PR body should
  say so verbatim, as evaluation-2 recommends, together with (iv), the HEL-1638 repair NOT EXERCISED.
- A proposal followed by an empty `end_turn` now persists an assistant turn with `content: []`. It renders nothing
  and D5 drops it on the wire. It still counts in the panel's "N messages" meta line. This is cosmetic, so consider
  dropping empty turns in a follow-up only if it bothers anyone.
- Carried over and still open: the duplicate Scaladoc at the top of `ClaudeHistoryNormalizer.scala` (the
  file-level doc sits above `PreparedHop`, not the object), and the design.md D6 note on `ClaudeAiStepClient`'s
  blank `end_turn` -> `Right("")`.
- `evaluation-2.md` is untracked in the worktree. The orchestrator should commit or persist it before squashing.
- Behavior change for the PR body: a turn that ends in a blank `end_turn` without a proposal is now a 502 ("Claude
  returned no answer"), never a persisted empty answer.
