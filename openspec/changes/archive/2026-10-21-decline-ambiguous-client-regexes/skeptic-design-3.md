## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD 4f729eed7dd52150f056b6f5a20eac856cb794a7. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/client-regex-backtracking-guard/HEL-1683`.
- **Artifacts read cold:** ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-client-evaluator/spec.md,
  skeptic-design-1.md, skeptic-design-2.md, and the live `frontend/src/features/pipelines/evaluator/javaRegex.ts`.
  The translator emits `$` as `DOLLAR = (?=(?:\r\n|[\n\r\u0085  ])?$)(?!(?<=\r)\n$)` (line 15), which
  is two lookarounds and one lookbehind, not a single character step.
- **Owner ruling:** the main checkout's `.concertino/runs/HEL-1683/events.jsonl` has `escalation.answered`
  `proceed-with-restated-scope`, `answer_source":"human"`, id `HEL-1683-1792567280436-a23bee`. D1 matches it.
- **Method:** I implemented D2 Rule W and Rule N exactly as written (P, L, wide/narrow, fence, tail) in
  `scratchpad/sk3/rules.mjs`. I timed `exec` with the real `javaRegex.ts` translator (copied, run under
  `node --experimental-strip-types`, Node v22.23.2, `nice -n 19`, `timeout 60`) using `scratchpad/sk3/time*.mts`.
  The figures are ms per 1,000 rows of 200-character cells, after 20 warm-up execs. Every figure cited below was
  run twice and reproduced within about 5%.

#### Prior change requests: addressed or only re-worded?

- **R1 CR1 (lower narrow cap with a wide quantifier):** addressed. The cap is 4 with a wide quantifier, and
  `a*a?a?a?a?a?a?b` is declined (N1:448 in my implementation).
- **R1 CR2 (finite red probe):** addressed. The probe uses exactly 5 rows, and D5a now quotes the round-2 figure
  (574/284 ms). My implementation declines `^(.*.*.*.*.*.*.*.*x)` (W:unfenced).
- **R1 CR3 / R2 note (deviation rationale):** addressed. Both D2 "Rejected" and Planner Notes cite
  `pipelineStepParity.test.ts`.
- **R1 CR4 (residual with numbers):** addressed in the proposal Non-goals and the design Risks.
- **R2 CR1 (tail length):** addressed in substance, not just reworded. L now weighs an exact `{n}` as n, and
  Rule N multiplies by L(tail). My implementation declines `a*a{20}b` (N1:21), `.*.{60}z` (N1:61) and
  `a?a?a?a?a?a?a{50}b` (N0:3648). These three are in the spec scenarios and in task 1.2, and D4 and task 3.1 have
  `{n}`-tail and `.`-run boundary tests. Task 3.2 now has six vectors, matching D5(c). This round's CR1 shows the
  same class of gap in a different term: the model gives a zero-cost item real cost.

#### Corpus check: no current client-evaluated pattern is declined (confirmed)

Under the rules as written, every client-evaluated `stringops.json` pattern is accepted. That includes
`(\d+)`, `([a-z]+)-([a-z]+)`, `a(b)|c(d)` (4), `<(.+?)>` (1), `x(a{2,3})` (8), `a(\s+)b` (1), `(abc)$`,
`(cat|dog)s?` (16, the maximum without a wide quantifier), `(\d+\.\d+)` (fenced), `(a{0,2147483647})`, `(é+)`,
`a()b`, `abc` and `""`. The existing `javaRegex.test.ts` accepted list, `clientEvaluable.test.ts` `(\d+)` and the
UI placeholder `^([^@]+)@` are also accepted. Every spec "declined" scenario pattern is declined. The design's
corpus claims (max 1 with a wide quantifier, 16 without) are accurate.

#### Attack on Rule N + Rule W: yes, accepted patterns exceed the designed bound

Baseline: `a*b` takes 20.4-23.8 ms, so the designed bound of about 4x is about 84 ms.

| pattern (accepted, rule cost) | cell | run 1 | run 2 | vs `a*b` |
| --- | --- | --- | --- | --- |
| `\d?\d?(\d+)$` (4) | `"1"x199+"x"` | 184.5 | 186.8 | ~9x |
| `[0-9]?[0-9]?(\d+)$` (4) | same | 184.0 | 183.8 | ~9x |
| `(\d?\d?\d*)$` (4) | same | 199.7 | 201.7 | ~9x |
| `.?.?.*$x` (4) | `"a"x200` | 190 | 188.3 | ~9x |
| `.*` + `$`x50 + `x` (1) | `"a"x200` | 102.2 | 103.7 | ~5x at cost 1 |
| `.*` + `$`x500 + `x` (1) | `"a"x200` | 2,310 (100-row run, scaled) | n/a | ~110x |
| `\d?\d?.{60}(\d+)$` (4) | `"1"x199+"x"` | 165.2 | 174.8 | ~8x |
| `.?.?.{100}.*z` (4) | `"a"x200` | 131.6 | 132.2 | ~6x |
| `(.*$x\|.{190}b\|.{190}c)` (3) | `"a"x200` | 116.9 | 116.9 | ~5.5x |
| control: `\d?(\d+)$` (2) | `"1"x199+"x"` | 84.7 | 84.6 | ~4x |
| control: `(\d+)$` (1) | same | 45.7 | 43.8 | ~2x |

The table shows two gaps in D2's "why this is linear per start" argument.

1. **`$` weighs 0 but is the most expensive item in the tail.** Rule N gives anchors weight 0 and floors the tail
   at `max(1, L(tail))`. Each retry of the last wide quantifier re-evaluates the DOLLAR lookaround construct,
   which measures at about 2x the cost of `a*b`'s `b` per retry (`(\d+)$` is 44 ms, `a*b` is 21 ms). So
   `\d?\d?(\d+)$`, a plausible "trailing number" pattern at P=4, runs at about 185 ms, more than twice the
   designed bound. A chain of `$` costs O(k) per start position and Rule N does not price it, so the cost is
   unbounded in pattern length: 500 `$` at cost 1 takes 2.3 s.
2. **Prefix weight is unpriced with a wide quantifier.** With a wide quantifier, only L(tail) is counted. Each
   of the P prefix paths still re-matches any exact `{n}` before the wide quantifier, and each alternation
   branch without a wide quantifier is unweighted (`.?.?.{100}.*z` 132 ms, `(.*$x|.{190}b|.{190}c)` 117 ms).
   Each of these is modest, about 1.5x the bound, but they stack with gap 1 (`\d?\d?.{60}(\d+)$` 170 ms).

Rule W held up again. I found no fence bypass: alternation with two wide quantifiers is declined, fences need
`min >= 1` and a disjoint set, and fenced chains such as `\w*!\w*!\w*!.*z` measure 20.8 ms. Empty groups `()`
and `^` chains also weigh 0, but V8 makes them nearly free (`a*`+`()`x100+`b` 23.4 ms, `a*`+`^`x100+`b` 23.4 ms),
so they are not a finding.

#### Internal contradiction: the spec's SHALL versus the conservative rule

The spec says "A pattern whose structure is linear per start position ... SHALL remain client-evaluated". The
design Risks say "the cost falls only on genuinely ambiguous shapes". Rule N as written declines ordinary,
linear, fenced patterns, because it multiplies the tail even when the last wide quantifier is fenced and so has
only one viable extent:

- `(\d+) items` (N1:6)
- `(\w+)@example\.com` (N1:12)
- `id=(\d+)&name` (N1:5)
- the IPv4 shape `(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})` (N0:1215: P=81, L=15)
- `(\w+)\s*$` (W:unfenced)

Results stay correct, because the server is the oracle, so this is not a parity break. But the spec's SHALL and
the Risks sentence are false for this rule as designed. An evaluator holding the implementation to the spec
would have to fail it, or ignore the spec.

### Verdict: REFUTE

### Change Requests

1. **Price `$` in Rule N's cost model (design D2/D4, spec, tasks 1.2/2.2/3.1).** Give each `$` (the translator's
   `DOLLAR` construct) a weight of at least 2 in L, and count it in L(tail). This applies whether or not it ends
   the pattern; alternatively, decline a pattern with more than one `$`. Size the weight by measurement against
   the stated budget (about 84 ms per 1,000 rows of 200-char cells):
   - With weight 2: `\d?\d?(\d+)$` becomes 4x2=8 and is declined, while `\d?(\d+)$` (85 ms) and `(\d+)$` (44 ms)
     and the corpus `(abc)$`/`(a\r)$` (no wide quantifier: 3+2, 2+2 times P 1) stay accepted.
   - Re-check the corpus after the change.

   Add `\d?\d?(\d+)$`, `.?.?.*$x` and a `$`-chain (for example `.*` plus 50 `$` plus `x`) to the spec's declined
   scenarios and the task 1.2 Jest cases. Add a boundary test with a recorded mutation of the `$` weight in task
   3.1. Correct D2's linearity argument, which currently assumes every tail item is a single character step.
2. **Count prefix weight when a wide quantifier is present, or bound it explicitly (design D2).** Either:
   - (a) use `P x max(1, L(pattern))` with a separate cap. This prices exact repeats before the wide quantifier
     and in branches without a wide quantifier. Size the cap so the corpus (`<(.+?)>` = 3, `a(\s+)b` = 3,
     `^([^@]+)@`) stays accepted; or
   - (b) state the residual in Risks with the measured figures (`.?.?.{100}.*z` 132 ms,
     `(.*$x|.{190}b|.{190}c)` 117 ms) and narrow AC1's claim accordingly.

   (a) is preferred, because (b) leaves the spec's 100 ms scenario false for patterns the rule accepts.
3. **Make the spec agree with the rule's conservatism (spec Requirement text; design Risks).** Replace "A pattern
   whose structure is linear per start position ... SHALL remain client-evaluated" with what the rule actually
   guarantees: every pattern the corpus evaluates client-side today stays client-evaluated, and a linear pattern
   may be declined (server-evaluated, identical results). Correct the Risks claim "the cost falls only on
   genuinely ambiguous shapes" and name examples (`(\d+) items`, the IPv4 shape). Optional, and better: when the
   last wide quantifier is fenced (its next item is a disjoint atom with `min >= 1`), it has one viable extent,
   so its tail is not multiplied by extents. Price it under the no-wide `<= 64` cap instead, which keeps
   `(\d+) items` and `(\w+)@example\.com` client-side. Back either choice with one measurement.

### Non-blocking notes

- The D5a probe (`^(.*.*.*.*.*.*.*.*x)`, 5 rows) is still declined by Rule W, so the red/green design is
  unaffected by these change requests.
- Whatever rule is chosen, the evaluator should re-run a timing sweep like `scratchpad/sk3/time*.mts` against the
  implemented `compileJavaRegex`. My rule implementation is a faithful reading of D2, but it is not the
  executor's code.

Evidence (scratch probes; the figures above were pasted from two runs each):
`/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/sk3/rules.mjs`,
`corpus.mjs`, `time.mts` through `time5.mts`.
