## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed HEAD 4f729eed7dd52150f056b6f5a20eac856cb794a7. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/client-regex-backtracking-guard/HEL-1683`.
- **Artifacts read cold:** ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-client-evaluator/spec.md,
  skeptic-design-1..3.md, the live `frontend/src/features/pipelines/evaluator/javaRegex.ts` (scratch copy is
  byte-identical, `diff` clean) and `steps/stringOps.ts:62-79` (`extractRegex` is the only `compileJavaRegex`
  consumer; it calls `regex.exec` once per cell, no `g`/`i`/`m`/`s` flags, so `^` is start-only and the
  fence test needs no case folding). The allowlist admits no `\b`, lookaround, quantified group or anchor, so
  `^` and `$` are the only zero-width items; `$` is the `DOLLAR` construct (line 15).
- **Owner ruling:** main checkout `.concertino/runs/HEL-1683/events.jsonl` line 3: `escalation.answered`,
  `answer":"proceed-with-restated-scope"`, `answer_source":"human"`, id `HEL-1683-1792567280436-a23bee`. D1 matches.
- **Method:** I rewrote the round-3 rule probe for the current D2 (`scratchpad/sk4/rules.mjs`). The changes are:
  - fenced items of any width have multiplicity 1;
  - `$` weighs 2 and `^` weighs 0;
  - the whole-pattern cap `P x max(1,L) <= 64` always applies;
  - the tail cap `P x max(1,L(tail)) <= 4` applies only when the last wide quantifier is unfenced.

  I timed `exec` with the real translator under `node --experimental-strip-types`, `nice -n 19`, `timeout`.
  Each figure is ms per 1,000 rows after warm-up, and every figure cited was run twice and reproduced within 2%.

#### Prior change requests: addressed in substance or only re-worded?

- **R3 CR1 (`$` weight):** addressed. `$` weighs 2 in D2, the spec has a `$` scenario, and tasks 1.2 and 3.1
  have a `$` boundary test. My probe declines `\d?\d?(\d+)$` (N1:8), `[0-9]?[0-9]?(\d+)$` (8),
  `(\d?\d?\d*)$` (8), `.?.?.*$x` (12) and `.*`+50`$`+`x` (N0:102). `\d?(\d+)$` stays accepted at 84.7 / 85.5 ms,
  against `a*b` at 20.6 / 23.5 ms, which matches the round-3 control.
- **R3 CR2 (prefix weight):** addressed with option (a). The whole-pattern cap now declines `.?.?.{100}.*z`
  (N0:416), `(.*$x|.{190}b|.{190}c)` (N0:573) and `\d?\d?.{60}(\d+)$` (N0:260). Every row of the round-3 table
  is now declined.
- **R3 CR3 (spec vs. conservatism):** addressed.
  - The spec now promises only that corpus patterns stay client-side, plus a quadratic per-cell bound.
  - Risks names server-evaluated examples.
  - The optional fenced refinement was adopted. `(\d+) items` (7), `(\w+)@example\.com` (13), `id=(\d+)&name`
    (9) and IPv4 (P=3, L=15, cost 45) are all accepted, as Risks claims. `(\d+)\s*items` and `(\w+)\s*$` are
    declined (W:unfenced), as Risks claims.
- **R1/R2 CRs:** still hold. The D5a probe `^(.*.*.*.*.*.*.*.*x)` is declined (W:unfenced), so the red/green
  design is intact. `a*a{20}b` (N1:21), `.*.{60}z` (N1:61) and `a?a?a?a?a?a?a{50}b` (N0:3648) are declined.

#### Corpus over-decline: none

Every client-evaluated `stringops.json` pattern is accepted under the current rules (25 vectors, plus the
`javaRegex.test.ts` accepted list and `^([^@]+)@`):
- highest whole-pattern cost: `(cat|dog)s?` at 16;
- highest tail cost with an unfenced wide quantifier: 1 (for example `<(.+?)>` and `(\d+)`).

Every declined scenario in the spec is declined. Every "stays client-side" scenario is accepted.

#### The stated guarantee: quadratic with a bounded constant holds; nothing super-quadratic found

- **Growth:** I doubled the cell length (200, 400, 800) for accepted adversarial patterns. Every one grew about
  4x per doubling, which is quadratic, the same as `a*b` (19.6 / 85.9 / 361 ms):

  | pattern | 200 | 400 | 800 |
  | --- | --- | --- | --- |
  | `(a\|a\|…21 branches)\w*!` (cost 63) | 438 | 1711 | 6763 |
  | `a?a?a?\w*!` (40) | 162 | 630 | 2465 |
  | `(a\|a\|a\|a).*z` (12, tail 4) | 95 | 370 | 1453 |
  | `\d?(\d+)$` (tail 4) | — | 337 | 1327 |

- **Why it is quadratic:** the structure explains it. Groups are never repeated, so U, if it exists, is the only
  quantifier with more than one viable extent. Everything after U is narrow or exact, and `$` is O(1). Every
  wide quantifier before U fails at its fence in O(1) per shorter extent. Per start position the cost is
  therefore O(P x n), with P <= 64.
- **Rule W:** I found no bypass. `|` with two wide quantifiers is declined, and fences need `min >= 1` and a
  disjoint set. A long fenced chain `\w*!` x19 + `.*z` measures 21.4 ms, the same as `a*b`.
- **Prefix literal:** a 60-character literal in front of `.*` costs 0.1 ms.

### Verdict: CONFIRM

The design is sound enough to implement:
- every earlier change request is fixed in substance;
- the corpus is intact;
- the restated guarantee holds under adversarial probing;
- the remaining defects below are narrative inaccuracies or disclosed-class conservatism, not rule defects. Fix
  them in the artifacts or the PR body during execution.

### Non-blocking notes

1. **D2's guarantee paragraph understates the constant.** "Without an unfenced wide quantifier the work is at
   most `P x L <= 64` steps plus the deterministic runs" is wrong. A fenced wide run (O(n) to scan and back off)
   is re-entered once per prefix path, so the work is P x (run). Measured:
   - `(a|a|…21)\w*!`: cost 63, 438.7 / 440.1 ms, about 21x `a*b`;
   - `a?a?a?\w*!`: cost 40, 166.8 / 162.7 ms, about 8x.

   This is still quadratic with a bounded constant (P <= 21 once a fenced wide plus its fence weigh 2), so it
   does not contradict the stated bound. But "a small constant multiple of `a*b`" should be read as up to about
   20x, and Risks should disclose that, with these figures. Overlapping alternation branches are rare in real
   patterns.
2. **The whole-pattern cap also declines choice-free patterns.** These have no backtracking at all, so this is
   an undisclosed over-decline:
   - `sha256:([0-9a-f]{64})` is N0:71 at 0.4 ms per 1,000 rows;
   - `(\d{65})` and any literal longer than 64 characters are also declined.

   Proposal "What Changes" lists only three decline classes and omits this one. Options:
   - **(a)** apply the `<= 64` cap only when P > 1. With P = 1 and no unfenced wide, cost per start is at most
     min(L, n), no worse than `a*b`. Every round-3 weight finding had P >= 3.
   - **(b)** disclose it in Risks, the proposal and the PR body.

   Whichever is chosen, keep the boundary tests consistent with it.
3. **The Risks example "`a*` followed by a long literal" is only partly true.** `a*bcdef` stays client-side,
   because `a*` is fenced by `b` (cost 6). It is declined only when the literal overlaps the atom (`a*abcdef`,
   N1:6) or weighs more than 63. Qualify the example.
4. **D2 and D4 disagree on the corpus tail maximum.** D2 says "P x L(tail) = 2 (`(a\r)$`-style tails)", but
   `(a\r)$` has no wide quantifier, so it has no tail. The real corpus maximum is 1, which is what D4 says. Fix
   D2.
5. **The fence lookup is ambiguous at branch ends when `|` is present.** "Immediately following item" is
   undefined for an item at the end of an alternation branch, for example `a?` in `(x|a?)(b|a)`.
   - The conservative reading treats it as unfenced and only over-declines.
   - The liberal reading peeks into the next group's first branch and can misclassify `a?` as fenced. Because
     alternation is still priced by branch sum, this only shifts constants, never the growth class.

   State the conservative reading in D2 so the implementation and the boundary tests agree.

Evidence: `/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/sk4/`
(`rules.mjs`, `corpus.mjs`, `t1.mts`, `t2.mts`, `t3.mts`). The figures above are pasted from those runs.
