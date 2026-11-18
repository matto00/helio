# Red evidence (HEL-1761)

Raw logs: `.concertino/scratch/HEL-1761/` (red1.log, red2.log, mut-*.log, mutations.txt).
Command for every run: `cd backend && nice -n 19 sbt -J-Xmx3g "testOnly <suites>"` (sbt 2's `testFull` takes no suite filter; `testOnly` is wrapped by the same hel1468 summary guard).

## Red against unchanged behaviour (tests + compile scaffolding only: `AskError.Truncated`, route mapping, constant moved to the companion)

- Thinking-only max_tokens hop (service): `Left(Failed(BadGateway("Claude returned no answer (stop_reason: max_tokens)."))) was not equal to Left(Truncated)`
- Partial text max_tokens hop (service): `Right(AskQuestionResponse("There is nothing to report.", ...)) was not equal to Left(Truncated)`
- Corrective hop max_tokens (service): `Left(Failed(BadGateway(...max_tokens))) was not equal to Left(Truncated)`
- Cap: `1024 was not equal to 4096`
- Routes thinking-only: `502 Bad Gateway was not equal to 422 Unprocessable Content`
- Routes partial text: `200 OK was not equal to 422 Unprocessable Content`
- Routes reasons: `true was not equal to false` (a reason held a digit)
- Pin tests: green before and after (branch already correct); red by mutation only.

## Mutations (each reverted; all turn the named test red)

| Guard | Mutation | Red tests |
|---|---|---|
| truncation, thinking-only | match `Some("max_tokensX")` | service thinking-only, service corrective, routes thinking-only |
| truncation, partial text | `hit = false` | service partial-text, service corrective, routes partial-text |
| digit-free reasons | return raw reasons | routes value-free reasons |
| cap (below) | 1024 | cap test |
| cap (above, invisible under the harness clamp) | 8192 | cap test (asserts the constant) |
| pin: own root id | ignore `rootId` | "use the Output's own root id" |
| pin: fallback | fallback `"none"` | "fall back to the pipeline id" |

Final green: ask specs + routes spec + all `com.helio.infrastructure.ai.*` + AssistantServiceSpec: 196 tests, 0 failed.

## Cycle 2 (evaluation-1 change request 1)

`AskReasonsSpec` feeds real `InsightValidator.validate` output (ungrounded texts) to `AskReasons.publicOf` and asserts the exact phrases, dedupe, the budget phrase, the generic fallback and digit-freeness.

Mutation M-B (collapse every reason to `Unchecked`), log `.concertino/scratch/HEL-1761/mut-mB.log`: 3 of 4 AskReasonsSpec tests FAILED (exact phrases, dedupe, budget/fallback); reverted.

Also moved the max_tokens WARN out of the pattern guard into `truncatedPartial()` (no behaviour change).

Final green: ask + routes + ai + AssistantServiceSpec: 200 tests, 0 failed (hel1468 summary failed=0 aborted=0).
