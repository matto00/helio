# Files Modified — HEL-957

- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala` — added three
  guard tests that observe the executed node SET (`stepRowCounts.keySet` for the line-507
  `previewAtNode`/`previewStep` site; a spy `PipelineExecutionBackend`'s captured `steps` argument
  for the line-662 `evaluateNodeRowsForBackfill` site), on fixtures where the target's dependency
  closure is a proper subset of the pipeline's full node set. Added a companion
  `PipelineRunServiceSpec.SpyExecutionBackend` object/class (test-only) that wraps a real
  `InProcessExecutionBackend` and records the `steps` vector handed to `execute`. Test-only; no
  production source or migration changed (see `mutation-evidence.md` for the apply/run/revert
  cycle proving all axes red for the right reason).

  Cycle 2 (evaluation-1.md CR1/CR2): lengthened the line-507 linear-trunk fixture from a two-node
  closure (`[stepA, target]`) to a three-node closure (`stepA -> stepB -> target`), which makes
  M2 (wrong node) and M3-replacement (`.dropRight(1)`) produce genuinely different observed key
  sets (`{stepA}` vs `{stepA, stepB}`) instead of the two-node fixture's observationally-identical
  `{stepA}` for both. Dropped the tautological `tail.enabled shouldBe true` /
  `siblingOnOtherRoot.enabled shouldBe true` assertions (non-blocking suggestions) and their
  now-redundant "keep the compiler from flagging it unused" comment.

See `mutation-evidence.md` in this change directory for the full mutation-testing evidence
(re-run fresh against the cycle-2 fixture for M1/M2/M3), and `tasks.md` (all items checked, 2.1
corrected to name the actual file the guard lives in) for the task-by-task record.
