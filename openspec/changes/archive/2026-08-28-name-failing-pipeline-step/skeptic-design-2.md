## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Re-derived from the tree, not from the revision narrative.

**CR1 — line citations: FIXED and correct.** design.md Decision 3 now carries a table citing
`SparkJobSubmitterSpec` :360, :367. `sed -n '355,370p'` on that spec shows exactly
`runs.head.errorLog shouldBe Some("Pipeline execution failed")` at :360 and
`cached.get.error shouldBe Some("Pipeline execution failed")` at :367 — the two exact-match assertions.
The table's other rows (`PipelineRunRoutesSpec` :533/:634/:756 exact; `HookRoutesSpec` :324 and
`PipelineRunServiceSpec` :380 `should not include`) still match round 1's verified `grep -rn` enumeration.

**CR2 — Spark contradiction: RESOLVED by a real decision, and consistently propagated.** New Decision 3a
states the Spark path is out of scope, `SparkJobSubmitter` is not modified, and `SparkJobSubmitterSpec`
:360/:367 are not modified — with the useful inversion that touching them is a *defect signal*, not
expected churn. The three previously-conflicting sites now agree: Decision 3's table row says
"**Unchanged.**", task 2.4 says leave both untouched and confirm the diff touches neither, and task 5.6
restricts edits to `PipelineRunRoutesSpec` and repeats the do-not-touch. The technical justification also
checks out: `grep -rn sparkJobSubmitter` shows it is only constructed in `Main.scala:109` and passed to
`ApiRoutes.scala:84` — no `sparkJobSubmitter.` call site exists in `api/` or `services/`, so the Spark
submit path is not reachable from the run routes today. Deferring it costs no live surface.

**CR3 — Decision 5: REWRITTEN and now achievable.** It is stated as a general single-source-of-truth rule,
with the four already-compliant steps named as the pattern (`StringOpsStep.SupportedOperations` :94 —
verified, `s"...Supported: ${SupportedOperations.mkString(", ")}"` at :96-99) and the four non-compliant
ones called out with the required treatment. I re-read all four: `AggregateStep:95-99`, `GroupByStep:70-73`,
`UnionStep:77-80`, `JoinStep:74-77` each have supported values only as `case` arms plus a hardcoded
duplicate in the message string — exactly as the design now describes. Task 3.4 (visibility only) / 3.4a
(extract + rewrite **both** the match and the message) split matches, and 3.4a explicitly forbids the
third-copy shortcut. This closes the drift hole.

**Non-blocking notes from round 1 — both taken up.** New task 5.6a measures AC5 by running the full backend
suite and naming the suites, rather than assuming it. Decision 6 now has an explicit fourth out-of-scope
bullet for the silent-no-op kinds (`ComputeStep`, `SortStep`, `DedupeStep`, `CastStep`, `RenameStep`, "all
contain zero `throw` sites" — consistent with round 1's verified enumeration) explaining that nothing exists
to promote and that adding checks would be implementing HEL-860 here. Round 1's note 3 was already covered
by task 7.1.

**Whole-artifact re-check for anything round 1 did not reach.**
- Spec deltas (`pipeline-run-execution`, `pipeline-step-config-validation`) are internally consistent with
  the revised design: allowlist wording matches Decision 3, the derive-from-the-step's-own-set sentence
  matches the revised Decision 5, the out-of-scope sentence matches Decision 6, and the join-into-one-message
  sentence matches Decision 7's corollary and task 3.3.
- The scenarios are falsifiable and map to tasks 5.1–5.5; the `datebucket` negative scenario guards the
  out-of-scope boundary rather than restating it.
- Every AC still traces: AC1 → 1.1-1.3/2.1-2.3/5.1; AC2 → 3.1-3.5/5.3; AC3 → 5.3; AC4 → 1.3/5.2; AC5 →
  5.6a + 4.1/4.2; AC6 → 6.1. No task falls outside the ticket's scope bullets.
- No `TODO`/`TBD`/deferred-decision language remains in design.md or tasks.md.

### Verdict: CONFIRM

All three round-1 change requests landed as claimed and are correct against the tree; no round-1 item
survives, so no escalation. The design is specific enough to implement without further interpretation.

### Non-blocking notes

- The `pipeline-run-execution` delta's "When the failure originates inside a step, the error message SHALL
  additionally name the failing step's id..." is phrased absolutely, while Decision 3a exempts the Spark
  path. There is no live contradiction (the Spark submit path has no route call site), but if that path is
  ever wired up the requirement would be violated silently. Consider scoping the sentence to runs executed
  by the in-process engine.
- Task 5.1 asserts the run message contains the step id, `stringops`, and `extractRegex` (the *supported*
  name). Asserting the rejected value `regexExtract` is also present would pin the half of the message the
  reporter actually needed.
