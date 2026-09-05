## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold read of ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-sort-op/spec.md, plus the
cited source: `SortStep.scala:60-88`, `PipelineRowJson.toDouble:69-78`, `SortStepSpec.scala`,
`InProcessPipelineEngineSpec.scala:1442`.

### What I verified (with evidence)

**Ground truth of the cited code.** `sed -n '55,95p' SortStep.scala` shows the per-pair
`(xn, yn) match` fallback exactly as the ticket quotes, with the null branch at the two `case (None, _) /
case (_, None)` lines above it — line references in design.md/tasks.md are accurate.
`toDouble` (`PipelineRowJson.scala:69-78`) uses `s.toDoubleOption` for `String`, so `"NaN"` →
`Some(NaN)` and `"Infinity"` → `Some(Infinity)`; the design's NaN risk and task 1.1's
"only finite" classifier are grounded, not speculative. `SortStepSpec.scala` has exactly the two
HEL-893 guards (both all-numeric-looking-string columns, confirming D6's claim that they cannot
discriminate). `InProcessPipelineEngineSpec.scala:1442` is the multi-column guard tasks.md 2.8 cites.

**Round-2 CR #1 — tasks.md 2.5 descending fixture.** Now reads input `9, null, "n/a", 10` → expected
`"n/a", 10, 9, null`. Traced against D1/D3 and the spec's "Partly-numeric column reverses tiers when
descending" scenario: desc reverses tier order (tier 2 leads), reverses within tier 1 (10 before 9),
nulls stay last. Expected output is correct, and it is a genuine permutation of the input (input has
null second, output has it last; 9 leads the input, 10 leads the non-coercible-adjacent block), so it
cannot pass by luck of insertion order. **Fixed.**

**Round-2 CR #2 — tasks.md 2.11 Mutation C prediction.** Now predicts 2.3 (transitivity) fails, states
2.4 is expected to STILL PASS with the reason, and forbids editing 2.4 to force a failure while noting
2.4 remains a real discriminator via Mutations A/B. I independently confirmed 2.3 must fail under the
pre-fix comparator using values 2.1's set is required to contain: `"NaN"` coerces to `Some(NaN)`, and
NaN compares `false` in both directions against every number, so `NaN ≡ 9` and `NaN ≡ 10` while
`9 < 10` — transitivity of equivalence is violated, and 2.3 explicitly asserts it. The prediction does
not depend on picking a lucky lexicographic-vs-numeric triple. **Fixed, and the prediction is robust.**

**Mutation A (2.9, `all-or-nothing`) — traced myself.** Fixture 2.4, asc over `{10, 9, "n/a"}`: the
pre-scan finds `"n/a"` non-coercible, so all pairs compare by `toString`: `"10" < "9" < "n/a"` → output
`10, 9, "n/a"` ≠ expected `9, 10, "n/a"`. **2.4 fails — correct.** Fixture 2.5, desc, null branch
untouched: non-nulls compare lexicographically reversed → `"n/a", "9", "10"` → output
`"n/a", 9, 10, null` ≠ expected `"n/a", 10, 9, null`. **2.5 fails — correct.** Both predictions hold.

**Mutation B (2.10, `numeric-tier-last`) — traced myself.** 2.4 asc with tier 2 leading:
`"n/a", 9, 10` ≠ expected. **Fails — correct.** 2.5 desc: reversing D3-style gives tier 1 desc first,
then tier 2 → `10, 9, "n/a", null` ≠ expected `"n/a", 10, 9, null`. **Fails — correct.** Both
predictions hold. (Note the mutation is a real comparator swap, unlike A, consistent with D6's
call-site carve-out applying to A only.)

**Other design-soundness checks.** No placeholders/TBDs. proposal ↔ design ↔ tasks ↔ spec agree on the
three tiers, on desc reversing tier order, and on nulls-last. AC coverage: AC1→2.1-2.3, AC2→1.4/1.5,
AC3→2.8, AC4→2.8 (engine multi-column guard), AC5→2.1-2.6 + 2.9-2.12, AC6→1.6 + proposal non-goals. No
migration is planned anywhere. The trichotomy trap is correctly disclaimed in D1, the spec text, and
task 2.2. D4a's "up to equivalence" qualification is consistently reflected in task 2.6 and the spec's
input-order scenario — an unqualified version of that guard would have been a false assertion.

### Verdict: CONFIRM

### Non-blocking notes

1. tasks.md 2.11's rationale for 2.4 surviving Mutation C ("TimSort's binary-insertion path") is an
   empirical observation about a specific 3-element sort, not a contract. It does not need to be
   correct for the plan to be sound — the load-bearing instruction ("do not edit 2.4 to force a
   failure") stands either way — but the executor should record what it actually observes rather than
   restating the prediction if the two diverge.
2. 2.11 makes no prediction for fixture 2.5 under Mutation C. Not a gap in the discrimination rule
   (2.5 fails under A and B, satisfying 2.12), just an unstated cell in the matrix.
3. Task 2.7 (NaN/Infinity tier-2 fixture) sits outside 2.12's 2.3-2.6 discrimination scope, yet it
   would in fact discriminate against the pre-fix comparator. Widening 2.12 to include it would be a
   free strengthening; leaving it is not a defect.
