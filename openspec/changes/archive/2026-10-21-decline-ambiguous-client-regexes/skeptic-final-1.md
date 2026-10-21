## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `e872cf975c2cacad65bfd736404f275167a664af`. Base resolved live with `resolve-review-base.sh` (main/origin): `4f729eed7dd52150f056b6f5a20eac856cb794a7`. The diff is one commit, 22 files. No UI component changed: the change is evaluator logic, two new evaluator modules, tests, a corpus fixture and openspec artifacts.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/client-regex-backtracking-guard/HEL-1683`.

**The implementation matches D2 exactly.** I read `javaRegex.ts`, `javaRegexCost.ts` and `javaRegexSets.ts` in full.
- `?`/`*`/`+`/`{n,m}` are mapped to `{min,max}`. A lazy quantifier keeps its greedy bounds.
- A *choice* is `max > min`. *Wide* means unbounded or `max-min+1 > 16`.
- Rule W declines two or more wides if the pattern has any alternation. Otherwise every wide except the last must be fenced.
- A fence is the next flattened item, which must be an atom with `min >= 1` and a disjoint set. Single-alternative groups are inlined by `flatten`. A branch end counts as unfenced.
- Path count P is the product over a sequence and the sum over alternatives. Each unfenced narrow choice contributes its multiplicity.
- Weight L: an atom weighs `max`, a wide atom weighs 1, `$` weighs 2 and `^` weighs 0.
- Rule N: when P > 1, `P x max(1, L) <= 64`. For an unfenced wide, `P x max(1, tail) <= 4`, where the tail includes everything after the enclosing groups (`collectWides` passes `after`).
- Sets come from the same constants the translator emits: SPACE includes 0x0B, and DOT excludes `\n \r U+0085 U+2028 U+2029`. Negated classes are complemented.
- Every failure path, including any unexpected throw, falls into the existing `catch` and becomes `{ok:false}`. So the check can only over-decline.
- The only client consumer is `steps/stringOps.ts` `extractRegex`. Client `assert` is identity and runs no regex, so nothing else needs the guard.

**AC1 is red-first and not vacuous. I reproduced it at the engine level without editing code.** I used scratch copies of base and head `javaRegex.ts` under `node --experimental-strip-types`, with 5 cells of `"a"x28+"!"`:
- **Base:** accepts `^(.*.*.*.*.*.*.*.*x)` at **580.5 ms**. It also accepts `^(a*a*a*a*a*a*a*a*a*a*)$` at **15528.7 ms**.
- **Head:** declines both. It still accepts `(\d+)` (0.0 ms).

I also checked this in Chromium on the live dev server (MCP browser, page context):
- A `longtask` PerformanceObserver recorded **552 ms** for the base translation of the probe over the same 5 cells. So the observer works and the base engine produces the long task.
- The Vite-served head module returned `compileJavaRegex(probe).ok === false` and `compileJavaRegex("(\\d+)").ok === true`.

Together with the executor's recorded red e2e (825 ms, failing as an assertion with the duration in the message), this shows the e2e probe fails on the base tree.

**AC1 green, run twice by me.** Servers came up via `start-servers.sh` and `assert-phase.sh servers` printed `PASS servers`. I ran under the e2e flock with `--workers=1 --trace retain-on-failure` and got **1 passed (12.9 s)** and **1 passed (11.8 s)**:
- Control longest task 0.0 ms, with no draft-preview request.
- Probe longest task 0.0 ms. The probe made a `POST /api/pipelines/<id>/draft-preview` request and the page showed "Preview is live" with 5 rows.
- Overrun longest task 0.0 ms, and the server's "exceeded the 2 s regex time budget for this step" error was shown.

The green result does not come from nothing being evaluated: the probe assertions require the draft-preview request and the server result. Servers were stopped with `stop-servers.sh` (`STOPPED ports=7115,10022`).

**Adversarial soundness search: no accepted pattern is super-linear.** I generated about 18,000 random patterns from the allowlist grammar (3 seeds; atoms `a b . \w \d \s \W [a-c] [^x]`, quantifiers including lazy, `{0,15}`, `{1,20}` and `{3,}`, nested alternation groups, anchors). The head accepted about 6,000 of them.
- I timed each on adversarial inputs (runs of `a`, spaces, digits, `ab`, mixed, with a non-matching end) at 100 and 200 characters.
- The worst accepted pattern was 12.6x the cost of `a*b` at 200 characters.
- Growth from 100 to 200 characters was at most about 5.8x, which is within the disclosed per-start-O(n) / overall-quadratic residual.
- None hung or ran super-polynomially. All runs were under `timeout 60 nice -n 19`.

**Parity corpus.** `git diff base...HEAD -- shared-test-fixtures/` has **0 removed lines**: it only appends 7 `regex declines:` vectors to `stringops.json`. The Scala expectations come from the Scala engine:
- `PipelineStepParitySpec` fills an expectation only when it is missing and otherwise asserts it (source lines 18, 90, 102).
- I ran it under the sbt lock. The full spec gave 709 succeeded / 0 failed. Filtered with `-z declines` it gave 43 succeeded, and all 7 new vectors are listed by name.
- Frontend `pipelineStepParity.test.ts` asserts `clientDeclines` vectors through `clientEvaluable`. Run together with `javaRegex.test.ts`: 729 passed.
- I hand-checked two expectations: `\d?\d?(\d+)$` on "12" gives "2", and `(a*)a{20}b` on 25 `a` plus `b` gives "aaaaa". Both are correct Java semantics.

**Normal regexes are unchanged.** `HELIO_JEST_MAX_WORKERS=2 npx jest src/features/pipelines`: 164 suites / 2876 tests passed. `npm run typecheck` is clean. eslint `--max-warnings 0` on the changed TS files gives exit 0. `prettier --check` is clean on the changed files.

**The mutation records exercise the guards they name.** I applied five mutations independently to scratch copies (never to the worktree) and checked them against the boundary cases from `javaRegex.test.ts`. Each turned exactly its named boundary red:

| Mutation | Boundary case that turned red |
| --- | --- |
| `WIDE_EXTENTS` 16 -> 17 | `a{0,16}a{2}` |
| `MAX_TAIL_COST` 4 -> 5 | `a*a{5}` |
| `DOLLAR_WEIGHT` 2 -> 1 | `a*$$$` |
| `hasAlternation(...) \|\|` -> `false \|\|` | `(a+x\|b)c+` |
| `MAX_COST` 64 -> 65 | `b{9}a{0,4}` |

The unmutated head passed all of them. This matches `evidence/mutations.md`.

**Evidence and mtime discipline.** No claim here relies on mtime or directory ordering. Every result above is a fresh command output I read myself.

### Verdict: CONFIRM

### Non-blocking notes
- The e2e control's "client evaluated" signal rests on the "Draft · unsaved changes" marker plus the absence of a draft-preview request. Its `5 rows` assertion does not tell before from after, because the seeded `(a+)` run already shows 5 rows. The test is not vacuous: the red run (825 ms on base) and the probe's draft-preview and server-result assertions carry that load. Asserting a control output cell value (the `out` column empty for `(\d+)`) would make the control prove this by itself.
- The disclosed residuals are accepted as designed and should be in the PR body:
  - A single wide quantifier is O(n^2) over start positions on long cells.
  - Accepted patterns can cost a constant up to about 21x of `a*b`.
  - Conservative over-declines such as `(\d+)\s*items` go to the server: same results, only higher latency.
- `evaluation-1.md` is untracked in the worktree. The orchestrator should commit it with the delivery artifacts.
