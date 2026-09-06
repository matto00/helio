## 1. Fixture

- [x] 1.1 In `PipelineRunServiceSpec`, add a `previewOutputs` closure-guard describe block, reusing the file's existing EmbeddedPostgres harness. No new migration, no new spec file.
- [x] 1.2 Build a three-node trunk `stepA -> stepB -> target` (design.md D2), plus at least one **enabled** node outside `target`'s closure (AC3).
- [x] 1.3 Add a second branch with a DIFFERENT closure and a step-bound Output on it, so the all-Outputs re-pairing axis (M3) has something to get wrong (D4).
- [x] 1.4 Seed the Outputs the guards preview: one bound to `target`, one bound to the second branch's node.

## 2. Non-degeneracy demonstration (AC3, D3)

- [x] 2.1 Add the positive control: an assertion showing the off-closure node's id DOES appear in a `stepRowCounts` key set when it is genuinely inside the previewed closure. Demonstrated, not asserted.
- [x] 2.2 If the positive control cannot produce that id, STOP — the fixture is degenerate (the `if (next.enabled)` trap at `InProcessPipelineEngine.scala` ~:449). Fix the fixture before any guard is counted.

## 3. Guards (AC1, D1, D5)

- [x] 3.1 Single-Output arm guard: `previewOutputs(pid, Some(outputId), user)` — assert `envelope.outputs` has one entry and its `preview.stepRowCounts.keySet` is exactly the enabled members of `target`'s closure.
- [x] 3.2 All-Outputs arm guard: `previewOutputs(pid, None, user)` — assert EACH `envelope.outputs` entry's `preview.stepRowCounts.keySet` matches its OWN Output's closure, so a re-pairing defect is observable.
- [x] 3.3 Assert on key sets only; do not assert on the target's own rows (invariant under widening by construction, AC1).

## 4. Mutation evidence (AC2, AC4, AC5)

- [x] 4.1 Run M1 (single-Output arm, drop `stepId`) against real source. Capture verbatim failure output.
- [x] 4.2 Run M2 (all-Outputs arm, drop per-node target in the traverse). Capture verbatim output.
- [x] 4.3 Run M3 (all-Outputs arm, re-pair via `distinctNodeKeys.head`). Capture verbatim output.
- [x] 4.4 Confirm every mutation is inside `previewOutputs`' body (lines ~329-374). **A mutation at `:507` does not count** (AC2) — if any axis can only be shown at `:507`, it is not evidence for this ticket.
- [x] 4.5 Apply the corrected distinctness criterion (design.md D2a): the discriminator is the PAIR `(which guard reds, observed key set)`, not the key set alone. M1 and M2 both observe `{}` structurally — do NOT try to separate them by lengthening the fixture; `{}` follows from `targetStepId = None` routing to the empty-slice source-level arm on any fixture.
- [x] 4.5a Capture the cross-arm GREEN control per mutation, as required evidence: under M1 the all-Outputs guard must be GREEN; under M2 the single-Output guard must be GREEN. Paste the actual pass/fail lines, not a summary.
- [x] 4.5b If BOTH guards red under either M1 or M2, that is an axis COLLAPSE. Report it as one axis. Do not reword the claim to preserve a count (this is HEL-957's cycle-1 failure).
- [x] 4.6 Record any wrong-reason red (engine `UnprocessableEntity`, `NoSuchElementException` from the `.take(1)` variant, etc.) and **discard** it — do not bank it as evidence (AC4).
- [x] 4.7 Revert every mutation. Confirm the suite is GREEN on unmutated source.

## 5. Write-up

- [x] 5.1 Write `mutation-evidence.md` to HEL-957's standard: per axis, the exact diff applied, the command run, the verbatim failure, and the observed-vs-expected key sets. Include a distinctness table whose rows are the PAIR `(guard that reds, observed key set)` plus the cross-arm green control — not the key set alone (D2a).
- [x] 5.2 Record discarded wrong-reason mutations in their own section, with why they were discarded.
- [x] 5.3 State design.md's assumptions (owner away) in the PR description too, framed as assumptions — not as a ruling.

## 6. Gates

- [x] 6.1 `cd backend && sbt "testOnly com.helio.services.pipelines.PipelineRunServiceSpec"` green.
- [x] 6.2 Scala code-quality/pre-commit gates pass. Do NOT run Playwright or e2e specs (HEL-972 holds them).
- [x] 6.3 Commit with `HEL-994 ` prefix.
