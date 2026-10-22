## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 4f729eed7dd52150f056b6f5a20eac856cb794a7 (planning artifacts are untracked in the change dir).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/client-regex-backtracking-guard/HEL-1683`.
- **Artifacts read cold:** ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-client-evaluator/spec.md,
  workflow-state.md (C1), skeptic-design-1.md, and the current `frontend/src/features/pipelines/evaluator/javaRegex.ts`.
  `last !== "atom"` at line 173 means groups are never quantified, so D2's "alternation tree of sequences of
  quantified atoms" shape holds.

#### Round-1 change requests — addressed or not

1. **CR1 (lower narrow cap when a wide is present): addressed in substance.** D2 Rule N now has two caps: 64 with
   no wide quantifier, 4 with one. D4 adds the 4/5 boundary test, the spec adds the scenario "Bounded choices
   multiplying an unbounded quantifier are declined" (`a*a?a?a?a?a?a?b`, `a?a?a?a?a?a?a*b`), task 1.2 adds the
   Jest cases and task 3.1 adds the boundary test plus mutation. `a*a?…b` has 64 paths with one wide quantifier,
   so the new cap declines it. This round's new CR1 shows that the path count is still the wrong measure.
2. **CR2 (finite, specific red): addressed.** The probe is now `^(.*.*.*.*.*.*.*.*x)` over 3-5 rows, and the
   allowlist accepts it today: `.` is an atom, `*` follows an atom, `^` is an anchor and the group is
   unquantified. I measured it in V8 with the translator's exact DOT class
   (`scratchpad/sk2/q.mjs`): **5 rows take 574 ms and 284 ms** (cold, then warm). That is finite and well above
   100 ms, so the red can be an assertion failure that reports the duration (C1). Task 1.3 now measures the
   server overrun before asserting it, with an explicit drop-out clause. The control edit asserts client rows.
   One error remains: the design says "roughly 1-2 s", but the measured figure is 0.3-0.6 s (see notes).
3. **CR3 (deviation rationale): addressed in D2 "Rejected"**, which now cites `pipelineStepParity.test.ts`.
   Planner Notes still says "to satisfy the AC's 'normal regexes behave identically'" (see notes).
4. **CR4 (residual disclosed with numbers): addressed.** The proposal Non-goals and the design Risks both give the
   `a*b` figures and limit AC1's claim to the backtracking-prone class.

#### New attack: can an allowlist-accepted, D2-passing pattern still block the main thread? YES

D2's cost argument is "the single unfenced wide quantifier retries at most n extents, each re-running only a tail
with <= 4 narrow paths". Rule N gives multiplicity 1 to "anything else", and an exact `{n}` "is not a choice". The
rule therefore treats a tail of `X{k}` as free, but each retry re-matches up to k characters. The real per-start
cost is extents x paths x tail length, so per cell it is roughly O(n^2 * k), and k can approach the cell length.
V8 optimises literal tails, which stay fast. A tail written as a counted repeat is not optimised.

Measured with node v22.23.2 (`scratchpad/sk2/p.mjs`). Each figure is the time to `exec` 1,000 cells of `"a"x(n-1)+"!"`.
I ran it twice and the second run reproduced the first within about 10%:

| pattern | why D2 accepts it | n=100 | n=200 |
| --- | --- | --- | --- |
| `a*b` (disclosed residual baseline) | 1 wide, paths 1 | 4.9 ms | 22-23 ms |
| `a*a{20}b` | 1 wide (Rule W n/a), paths 1 <= 4 | 144-147 ms | 714-733 ms |
| `a*a{50}b` | same | 145 ms | 1,277 ms |
| `.*.{60}z` | same | 390 ms | 1,993 ms |
| `\w*\w{40}!x` | same | 197 ms | 1,242 ms |
| `a?a?a?a?a?a?a{50}b` | **no wide**, paths 64 <= 64 | 422 ms | 1,300 ms |
| `a{0,15}a{0,3}a{150}b` | no wide, paths 16x4 = 64 | 0 ms* | 812 ms |
| `a*aaaa…(50 literal a)b` | same as `a*a{50}b`, but literal | 3.8 ms | 21 ms |

\* V8's minimum-length precheck skips cells shorter than the tail.

These are 30-90x the disclosed `a*b` residual, on ordinary 100-200-char cells, and well over the spec's 100 ms
"Main thread stays responsive" scenario. `.*.{60}z` ("at least 60 characters, then z") is a plausible thing for a
user to type, not a contrived pattern. The narrow-only case also breaks the Rule N 64 cap with no wide quantifier
present. So D2's linearity proof ("same order as a single `a*b`") is false as written, because it treats tail
length as O(1).

Corpus check for sizing a fix: the only accepted patterns with a counted repeat are `x(a{2,3})` (min 2) and the
wide `(a{0,2147483647})` (min 0, paths 1). Every other accepted pattern uses `*`, `+`, `?` or unquantified atoms.

### Verdict: REFUTE

### Change Requests

1. **Account for counted-repeat tail length in the cost rule (design D2/D4, spec, tasks 1.2/2.2/3.1).** Rule N
   must not treat an exact or high-minimum `{n}`/`{n,m}` as cost 1 when the pattern contains any choice point.
   For example, `a*a{20}b` takes 0.73 s, `.*.{60}z` 2.0 s and `a?a?a?a?a?a?a{50}b` 1.3 s per 1,000 rows of
   200-char cells, and every one passes D2 as written. Pick a rule and size it by measurement against a stated
   budget (for example <= 100 ms per 1,000 rows of 200-char cells). Two options:
   - (a) Once any choice point exists, decline any quantifier whose `min` exceeds a small constant. The corpus
     needs `min <= 2`, so a cap of 4 is safe.
   - (b) Generalise the measure to paths x sum of item maximum lengths, with its own cap.
   Then correct D2's "why this is linear per start" argument to include the tail-length term. Add `a*a{20}b`,
   `.*.{60}z` and `a?a?a?a?a?a?a{50}b` (or the revised rule's boundary equivalents) to the spec's declined
   scenarios and to the task 1.2 Jest cases. Add a boundary test with a recorded mutation for the new constant in
   task 3.1, and update D4's constants list.

### Non-blocking notes

- D5a says the 3-5-row probe gives "roughly 1-2 s" on the unmodified tree. I measured 284-574 ms for 5 rows in
  Node, so 3 rows could come in around 170 ms, which leaves little margin over 100 ms on a fast run. Pin 5 rows,
  or lengthen the cell by 1-2 characters (the cost grows steeply with length), and correct the stated figure.
- Planner Notes still justify the deviation with "to satisfy the AC's 'normal regexes behave identically'". Align
  it with the corrected D2 rationale (the corpus at `pipelineStepParity.test.ts` asserts client evaluability).
- D5(c) lists five new decline vectors, including "a wide-plus-narrow pattern", but task 3.2 lists only four.
  Add the fifth to the task, or to whichever list the new CR1 vector joins.
- The D5a overrun edit can be dropped if task 1.3 finds no overrun. In that case the spec scenario "Server overrun
  surfaces as the server's step error" is covered only by HEL-1676's existing tests. Say so in the PR body if it happens.
- Rule W itself held up again. Fenced chains such as `a*b+c` are accepted only when each fence has `min >= 1` and
  a disjoint set, and a wide quantifier used as the fence must itself be fenced or be the last wide quantifier.
  I found no break other than the tail-length gap above.

Evidence: `/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/sk2/p.mjs`,
`q.mjs` (scratch probes; the figures above are pasted from two runs).
