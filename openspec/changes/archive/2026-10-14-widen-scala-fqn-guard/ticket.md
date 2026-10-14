# HEL-1446: After HEL-1385: inline scala.* FQNs moved into engine files (check:scala-quality doesn't scan scala.*); stale PipelineAnalyzeService.* doc refs; cosmetic nits

## Description

Origin: HEL-1385 (matto00/helio#891), lane-reported. Follow-up.

1. Four inline FQNs (`scala.util.Try`, `scala.collection.mutable`): one in `MultiInputSchemaInference.scala` (~L86), three in `PipelineAnalyzeService.scala` (~L203/217/253). Replace them with imports. `check:scala-quality`'s FQN guard doesn't cover `scala.*` prefixes: widen it (overlaps HEL-1386, the guard blind inside s"${}"), with a red selftest.
2. Stale doc refs to moved members, e.g. `PipelineStep.scala:223` naming `PipelineAnalyzeService.validateStepConfig`, and ~12 `PipelineAnalyzeService.inferX` mentions elsewhere. Point them at the new objects (StepConfigValidation, StepSchemaInference, …); finish with a zero-hit grep.
3. Cosmetic: a 127-char line at `PipelineAnalyzeService.scala:25`, three stray blank lines at :10-12, and a ragged line in the rewrapped `PipelineAnalyzeProtocol` comment.

## Acceptance criteria

- AC1: `check:scala-quality`'s inline-FQN guard covers the whole `scala.` namespace (at minimum `scala.util.`, `scala.collection.`, `scala.io.`), with selftest red cases that FAIL against the pre-change guard (red-first proof recorded) and pass after.
- AC2: `npm run check:scala-quality` exits 0 on the branch: every existing inline `scala.*` use in `backend/src/main/scala` and `backend/src/test/scala` that the widened guard flags is fixed with an import, or exempted with a stated reason. The guard is never weakened to pass.
- AC3: No behaviour change: the backend compiles and the full backend test suite passes.
- AC4: Doc/comment refs to `PipelineAnalyzeService` members that moved (validateStepConfig, inferCompute, inferAggregate, inferGroupBy, inferJoin, inferLookup, inferConvertFormat, inferAnalyzeWithAi, inferSplitText, inferExtractHeadings, inferChunkByTokenCount, …) are re-pointed at their current owning object across backend sources, `backend/**/README.md`, `docs/`, and `openspec/specs/` (the latter via this change's spec deltas). A grep for those stale `PipelineAnalyzeService.<moved member>` refs returns zero hits (after archive for openspec/specs). Refs to members that still exist on `PipelineAnalyzeService` (e.g. the `inferOutputSchema` forwarder) stay.
- AC5: Cosmetic: `PipelineAnalyzeService.scala`'s over-long `stepConfigProblem` line is wrapped; its stray blank lines after the imports are removed; the ragged/over-long scaladoc lines in `PipelineAnalyzeProtocol.scala` are rewrapped.
- AC6: HEL-1386 (`${}` blindness) stays its own ticket; the PR body states whether the change touches its case.

## Driver notes

Overnight, non-UI, no behaviour change. Re-derive every site against the current tree (line numbers drifted — see premise-validation evidence).
