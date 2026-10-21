## Context

See proposal.md (Why). `javaRegex.ts` (HEL-1581) tokenizes a Java pattern under an allowlist and translates it to a
`u`-mode `RegExp`; any decline makes `stringOpsHandler.declines` return `unsafeRegex`, so `evaluateStep` reports
`needsServer` and `draftStepView.ts` (`mapServerResolved`) renders the server draft-preview result for that step,
including a server `error` line verbatim. The server time-boxes the same pattern at 2 s per step (HEL-1676,
`RegexTimeBox.scala`: "... exceeded the 2 s regex time budget for this step"). So declining is already the
parity-preserving route to the server; this change only widens what is declined.

The allowlist already guarantees: no quantified group, no back-references, no lookaround, no possessive quantifiers,
no inline flags. Groups are therefore never repeated, so a pattern is an alternation tree of sequences of atoms
(each with one optional quantifier), anchors, and unquantified groups. Backtracking blow-up in that shape comes only
from several choice points that can trade the same input characters: wide quantifiers in sequence (polynomial,
degree = their count, measured 10-29 s on 29 chars) or many narrow choices (`a?` x25, `(a|a)` x30: exponential).

## Goals / Non-Goals

**Goals:** a static, conservative structural check in `compileJavaRegex` that declines every pattern whose per-start
backtracking is super-linear, while every pattern the parity corpus evaluates client-side today stays accepted.

**Non-Goals:** run-time time budgets in the browser, Web Workers, input-length caps, the quadratic cost of scanning
start positions for a single wide quantifier on very long cells (follow-up candidate), any server change.

## Decisions

**D1. Decline at the allowlist (owner ruling), not a Worker.** Escalation `HEL-1683-1792567280436-a23bee` answered
`proceed-with-restated-scope`. A Worker would make draft evaluation asynchronous and collide with parked HEL-1632
(`usePipelineDraftFrames.ts`); declining reuses the existing `unsafeRegex` → server path with zero UI change.

**D2. The structural rule.** While translating, build a small structure (alternatives → sequences → items) and
compute, after translation succeeds:
- An item quantifier `{min,max}` (`?`=`{0,1}`, `*`=`{0,∞}`, `+`=`{1,∞}`) is a *choice* when `max > min`. It is
  *wide* when unbounded or `max - min + 1 > 16`; otherwise *narrow* with multiplicity `max - min + 1`.
- **Rule W (wide).** If the pattern has two or more wide quantifiers: decline if it contains any `|`; otherwise,
  in the flattened sequence (unquantified groups are transparent, anchors are items), every wide quantifier except
  the last one must be *fenced*: the immediately following item is a character atom with `min >= 1` whose character
  set is disjoint from the wide atom's character set. Otherwise decline.
- **Fenced items.** Any quantified atom (wide or narrow) whose immediately following item is a character atom with
  `min >= 1` and a disjoint character set is *fenced*: it has exactly one viable extent per entry, so it contributes
  multiplicity 1 to P. Rule W thus allows at most one unfenced wide quantifier, and it is the last wide one.
- **Rule N (cost).** Define for any sub-pattern its *path count* P (product over a sequence, sum over an
  alternation's branches, multiplicity per unfenced narrow choice, 1 for anything else) and its *weight* L (sum
  over a sequence, max over an alternation's branches; a character atom weighs its quantifier's `max` (an exact
  `{n}` weighs n, a wide item 1); `$` weighs 2, because the translator emits it as two lookaheads, one holding a
  lookbehind (`DOLLAR`, `javaRegex.ts:15`), measured at about twice a character step; `^` and empty groups weigh
  0, which V8 makes nearly free (skeptic round 3: ~23 ms for long chains)). Then:
  - when `P(pattern) > 1`: `P(pattern) x max(1, L(pattern)) <= 64` (a pattern with no choice point cannot
    backtrack, so e.g. `sha256:([0-9a-f]{64})` stays client-side; skeptic round 4 note 2);
  - additionally, when an unfenced wide quantifier U exists: `P(pattern) x max(1, L(tail)) <= 4`, where *tail* is
    everything after U in its branch plus everything after its enclosing groups.
  Otherwise decline. Measured motivation (V8, 1,000 rows of 200-char cells; `a*b` = 21 ms): round 1
  `a*a?a?a?a?a?a?b` 2.6 s (P); round 2 `a*a{20}b` 0.72 s, `.*.{60}z` 2.0 s, `a?a?a?a?a?a?a{50}b` 1.3 s (tail and
  whole-pattern weight); round 3 `\d?\d?(\d+)$` 185 ms, `.*` + 500 `$` + `x` 2.3 s (`$` weight),
  `.?.?.{100}.*z` 132 ms and `(.*$x|.{190}b|.{190}c)` 117 ms (weight before U and in other branches, now bounded by
  the whole-pattern cap). Corpus maxima: P x L = 16 (`(cat|dog)s?`), P x L(tail) = 1 (`<(.+?)>`, `a(\s+)b`).
- An item at the end of an alternation branch has no following item and counts as unfenced (conservative).
- Classification details: a lazy quantifier (`*?`, `+?`, `??`, `{n,m}?`) is classified exactly like its greedy
  form; an unquantified atom is `{1,1}` (a valid fence); an exact `{n}` is not a choice.
- **What the rule guarantees (and does not).** Per start position: fenced items are deterministic (their
  backtracking fails at the fence in O(1) per step); without an unfenced wide quantifier the work is at most
  `P x L <= 64` steps plus the deterministic runs; with one, U retries at most n extents and each retry re-runs a
  tail of at most `P x L(tail) <= 4` step-equivalents. So per-cell cost is at most quadratic in cell length (`exec`
  scans every start) with a bounded constant — never polynomial of higher degree or exponential. It is not a
  100 ms guarantee for every accepted pattern at every cell length: the single-wide residual is disclosed in Risks,
  and accepted patterns can cost a constant multiple of `a*b`, because the deterministic O(n) runs of fenced items
  repeat once per path: skeptic round 4 measured up to about 21x (`(a|a|...21 branches)\w*!`, 439 ms per 1,000
  rows of 200-char cells; `a?a?a?\w*!` 165 ms, about 8x). That ceiling is accepted and disclosed in the PR body.
- Rejected: "more than one unbounded quantifier" verbatim (the escalation's shorthand). It would decline the corpus
  vectors `([a-z]+)-([a-z]+)` and `(\d+\.\d+)`, and `pipelineStepParity.test.ts` asserts every vector without
  `clientDeclines` is client-evaluable, so that rule could only pass by editing existing corpus expectations (a
  fixture change made to fit the code). It would also still accept `a?` x25 and `(a|a)` x30, which are exponential. The fence exception and Rule N are what make the
  owner's intent (decline what is not provably bounded) hold; this is recorded in the PR body.

**D3. Character sets for the fence test.** Represent each atom's set as sorted code-point ranges over
`0..0x10FFFF`: literal / escaped meta (one point), `\d` `\D` `\w` `\W` `\s` `\S` (`u`-mode ASCII definitions the
translator already uses: `SPACE_CLASS_BODY`), `.` (everything except `\n \r \u0085 \u2028 \u2029`), `\t \n \r \f`,
bracket classes (union of members/ranges, complemented when negated). Disjointness is a range-intersection test.
Unknown/unrepresentable → treat as "not disjoint" (conservative: decline, never accept). The sets are computed
from the same constants the translator emits (`SPACE_CLASS_BODY` includes `\x0B`), including `\s` `\W` `\D` inside
a bracket class.

**D4. Thresholds are constants, not configuration.** Wide = range > 16; cost cap 64 without a wide quantifier,
4 with one (Rule N). Every corpus
client-evaluated pattern has at most one unfenced wide quantifier and Rule N costs of 1 (with a wide) / 16 (without). Pinned by boundary tests (16/17 range, cost 64/65 without a wide, cost 4/5 with one, an exact `{n}` tail and
a `.`-atom run tail) that each fail under a mutation of
the constant.

**D5. Proof.** (a) Red-first e2e long-task probe `e2e/hel1683-regex-main-thread.spec.ts`. A `PerformanceObserver`
(`longtask`) is installed before each edit; the pattern is entered in one `fill`, not typed.
- Control edit: `(\d+)` over the same rows. Assert the step renders client-computed rows (proves the client
  evaluator ran in the window) and record its longest task. If the control exceeds 100 ms in the dev build, stop and
  escalate rather than relax the threshold.
- Probe edit: `^(.*.*.*.*.*.*.*.*x)` (354 ms per 29-char cell in V8) over exactly 5 rows of
  `"a"x28 + "!"` (skeptic round 2 measured 574 ms cold / 284 ms warm in V8 with the translator's `.` class), so
  the unmodified tree produces a finite long task well above 100 ms. Assert longest task <= 100 ms.
  Red on the unmodified tree must be that assertion failing with the measured duration in its message, not a
  timeout. Green also asserts the step then shows the server result for that step.
- Overrun edit (green only, after the probe passes): a pattern and input measured (task 1.3) to exceed HEL-1676's
  2 s budget in the Scala engine. Assert the step shows the server time-budget step error. If no client-declined
  pattern can be shown to exceed the budget at the draft caps, record that and drop only this edit.
(b) Jest boundary tests in `javaRegex.test.ts`, each paired with a recorded mutation. (c) Parity corpus: new
`regex declines:` vectors in `stringops.json` for stacked `*`, stacked `?`, stacked alternation, an unfenced pair,
a wide-plus-narrow pattern and a wide-plus-counted-tail pattern, with short inputs whose Scala expectations come from the Scala engine
(`PipelineStepParitySpec`); no existing vector's expectation changes.

## Risks / Trade-offs

- [The rule is conservative, so some patterns that are in practice cheap are server-evaluated] → Results are
  identical (the server is the oracle); only latency differs. Known examples: an unfenced wide quantifier with a
  longer tail or a nullable separator between two wide quantifiers, e.g. `(\d+)\s*items` and `(\w+)\s*$` (`\s*` is
  not a fence, so the first wide quantifier is unfenced under Rule W); `a*` followed by a literal that starts with `a` (`a*abcdef`; `a*bcdef` stays client-side because `b` fences `a*`). Fenced
  shapes stay client-side: `(\d+) items`, `(\w+)@example\.com`, `id=(\d+)&name`, and the IPv4 shape
  `(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})` (P = 3 from the last, unfenced `\d{1,3}`, L = 15, P x L = 45).
- [It can only over-decline, never accept a pattern it cannot classify] → D3's unknown set is "not disjoint".
- [Long-task probe flakiness in a dev build] → control measurement (D5) and escalation instead of silent relaxing.
- [Residual: a single wide quantifier is still O(n^2) per cell over all start positions] → Not closed by this change.
  Measured in V8 per 1,000-row sample (skeptic design round 1): `a*b` 0.5 ms at 29 chars, 5.6 ms at 100, 20.7 ms at
  200, 131 ms at 500, so AC1's 100 ms is exceeded by an ordinary single-quantifier pattern on 500-char cells. AC1 is
  claimed only for the backtracking-prone class; the long-cell case is a follow-up candidate in the hand-back.

## Migration Plan

Frontend-only; ships with the next release. Rollback = revert the commit (allowlist returns to HEL-1581 behaviour).

## Planner Notes

- Self-approved: D2's fence exception and Rule N refine the owner's restated scope so no existing corpus vector
  (asserted client-evaluable by `pipelineStepParity.test.ts`) changes, and so exponential/weighted shapes the
  shorthand missed are declined; flagged to the driver and in the PR body.
- Self-approved: thresholds 16 / 64 / 4 (D4), from skeptic design rounds 1-2.
- Driver rules carried into every brief: worker caps (<= 2, `nice -n 19`, `HELIO_JEST_MAX_WORKERS=2`), e2e and
  `sbt testFull` under the driver's flock locks, load gate, never read/cat/grep/print any `.env` file (CON-261).
