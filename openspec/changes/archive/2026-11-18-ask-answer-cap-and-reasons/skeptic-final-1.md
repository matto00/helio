## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: f3a35089a041081a34efaffc111004d134739d2b. Base resolved live by `resolve-review-base.sh` (main/origin): c03fc0a4a. The diff covers 22 files. The backend changes are the ask service, routes and protocol, `FinalResponse.stopReason`, `AskReasons`, the tests, the harness and CLAUDE.md. There are no frontend files. Logs are in `.concertino/scratch/HEL-1761/skeptic-*.log`.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY branch=bug/ask-answer-token-cap/HEL-1761`.
- **Gates, run fresh:** `nice -n 19 sbt -J-Xmx3g "testOnly AskDataServiceSpec AskRoutesSpec AskCitationLedgerSpec AskReasonsSpec com.helio.infrastructure.ai.* AssistantServiceSpec"` gave hel1468 `failed=0 aborted=0 unreadable=0`, 18 suites, 200 succeeded, 0 failed. All four ask spec files and every ai spec are in the log (skeptic-green.log).
- **Red-first record:** red1.log and red2.log really contain the claimed failures. These are `502 Bad Gateway was not equal to 422` (AskRoutesSpec:161), `200 OK was not equal to 422` (:170), `true was not equal to false` for a digit in a reason (:184), `Left(Failed(BadGateway(... max_tokens))) was not equal to Left(Truncated)` (AskDataServiceSpec:279/291), the `Right(...)` partial answer (:285) and `1024 was not equal to 4096` (:297). Summaries: `failed=9` and `failed=4`.
- **My own mutations (reverted with `git checkout`; the tree is clean except the untracked evaluation-2.md):**
  - Run 1 applied four mutations at once, each hitting a different test (skeptic-mut.log, `failed=6`):
    - (a) I deleted the `NoAnswer(Some("max_tokens"))` case in `failure()`. The service thinking-only test failed (:279), the corrective test failed (:291) and the route returned `502 Bad Gateway was not equal to 422` (:161).
    - (b) I changed the AskReasons prefix `"numeral "` to `"numerals "`. Two AskReasonsSpec tests failed with "could not be checked" where "a number is not backed" was expected.
    - (c) I changed the AskPinBuilder fallback to `"fallback-mut"`. The fallback pin test failed (:323), and the distinct-root test stayed green, so the two paths are told apart.
  - Run 2: (d) I deleted only the corrective-hop `final2` max_tokens guard. The corrective test failed with `Right(AskQuestionResponse("There is nothing to report." ...)) was not equal to Left(Truncated)` (:293), `failed=1` (skeptic-mut2.log). I ran this on its own because in run 1 the earlier assertion in the same test hid it.
- **AC1:** The thinking-only `max_tokens` hop leaves `ClaudeClient` as `Failed(NoAnswer(Some("max_tokens")))` (ClaudeClient.scala:138-139). `AskDataService.failure` maps it to `Truncated`, and `AskRoutes` returns `422 ASK_ANSWER_TRUNCATED`. It was red as a 502 and is green now.
- **AC2:** `ClaudeClient` now carries `stopReason` on `FinalResponse` (:142). AskDataService:61 and :71 check for `max_tokens` before validation, on the first hop and on the corrective hop. A test shows that cut-off text which would otherwise pass validation still returns `Truncated`. The route test asserts that the cut-off marker never reaches the wire.
- **No `max_tokens` path returns a truncated answer or a 502:** I traced every place `max_tokens` can surface.
  - A thinking-only hop maps to `Truncated` on both calls (`failure()` is shared).
  - A partial-text hop maps to `Truncated` on both calls.
  - A hop that carries a `tool_use` keeps looping. It never becomes the answer; it reaches either a later final hop or `HopBudgetExhausted`, which becomes a 422. This is an explicitly scoped choice (D3, skeptic design-1).
  - `pause_turn` and `refusal` still give 502, but they are not `max_tokens` and are out of scope.
- **AC3:** `AskDataService.MaxAnswerTokens = 4096` is sent on every hop; the test asserts both the constant and the wire value. The rationale is in design D1: the docs say thinking counts toward the cap, the docs' own example is 4096, and 4096 equals the `CLAUDE_MAX_TOKENS` default clamp. The measurement position is in D4. I made no live call.
- **AC4:** The `422 ASK_UNGROUNDED` body is a fixed `message` plus `AskReasons.publicOf(reasons)`. The public phrases are fixed, contain no digits, and are guarded by `filterNot(_.isDigit)`. Both `Ungrounded` producers (the budget reason and validator reasons from either hop) go through `publicOf` in the route, which is the only place it is serialised. The `ASK_ANSWER_TRUNCATED` message has no digit either. The route test asserts that no reason holds a digit and that the body excludes `99` and `2026-11-30`; it was red first.
- **AskReasons prefixes against the real InsightValidator strings** (InsightValidator.scala:19, 23, 25, 27, 68, 73):
  - `the text is empty`, `citation marker [..]`, `date '..'` and `numeral '..'` all match their prefixes.
  - `the text has N characters` and `the text has N sentences` are told apart by `contains`.
  - AskReasonsSpec drives these from real `validate` output, not hand-written strings. My mutation (b) shows the coverage bites.
- **AC5:** `"fall back to the pipeline id as root id ... no step and no root id"` uses `NodeRef(pid, None, None)` and round-trips through the real `OutputService.create`. A separate test uses `Some("distinct-root")`, so it can be told apart from the real `node.rootId` path. My mutation (c) turned only the fallback test red.
- **D4 measurement position:** D4 says "Not measured", gives the reasons (no traffic, no approved live calls, a fake cannot measure a distribution), and names the WARN line as the future instrument. I checked the "no frontend caller" claim: grep of `frontend/src` finds no client of the ask routes. The statement is honest. No PR exists yet (`gh pr list --head` returns `[]`), so the PR body itself cannot be checked at this gate (see the notes).
- **Contracts:** `schemas/ask/` has only the request and 200 response schemas, and neither 422 code was ever schema'd. CLAUDE.md and the spec delta are both updated, so no contract delta is missing.

### Verdict: CONFIRM

### Non-blocking notes
- The PR body is not written yet. Delivery must carry D4's "not measured: no ask traffic, no live calls approved; the WARN line counts it once L5/L7 add traffic" statement into it, as D4 promises.
- A `max_tokens` stop on a hop that carries a `tool_use` still runs the possibly cut-off tool input through the scope-checked executor (D3, by design). If the WARN data later shows this happening, it is worth a follow-up.
- The evaluator's notes still stand: the budget-reason string is duplicated (`AskReasons.BudgetReached` would fix it), and AskDataServiceSpec is about 388 lines.
- `evaluation-2.md` is untracked in the worktree. The orchestrator should commit it with the delivery artifacts.
