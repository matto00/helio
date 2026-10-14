# HEL-1467: After HEL-1412: more false completeness/exhaustiveness comments (PipelineStepSpec "sealed", PipelineStepConfigCodec upsertsource + "compile error", steps README count, PipelineShape, SecondSourceGuardSpec); drift coverage misses oneOf/const

## Description

Origin: HEL-1412 (matto00/helio#910, 11924a56), lane-reported. Fix each to the HEL-1156 standard (no completeness
claim, name the known layers, give a re-derive command), with a verification command per factual sentence:

1. `PipelineStepSpec`: a comment says "sealed-trait dispatch is exhaustive", but the trait isn't sealed.
2. `PipelineStepConfigCodec.scala` ~L75–82 says `upsertsource` isn't in the Registry (it is now); ~L45–49 says a
   missing arm "is a compile error" (false: the match is on `Any`).
3. `domain/steps/README.md` says "23 step kinds"; 27 are registered. Better to give a count command than a number.
4. `PipelineShape.scala:39` makes a "single source of truth" claim for shapes.
5. `PipelineStepSecondSourceGuardSpec.scala:17` makes the same claim.
6. Non-blocking: the new `panelKindEnumCoverage` check sees only `enum` arrays (not `oneOf`/`const`), and its keys use
   OS path separators (Windows mismatch).

A Haiku executor is suitable for 1–5 with a pinned plan.

## Acceptance Criteria

- AC1: Items 1–5 each corrected to the HEL-1156 standard: no completeness/"single source of truth"/"compile error"
  claim that the code does not back; the known layers named; a re-derive command given; every factual sentence in
  the rewritten comments has a verification command (recorded in the change's evidence).
- AC2: Each item 1–5 re-derived against the current tree (after HEL-1535 #989); any already fixed is dropped with
  evidence. (Premise validation 2026-10-13: none already fixed.)
- AC3: The panel-kind coverage check also detects panel kinds carried as per-branch `const` values under
  `oneOf`/`anyOf`/`allOf`, and every such group found in `schemas/` today is parity-checked or exempted with a reason.
- AC4: Coverage keys are separator-independent (a Windows-style `panels\x.json` key matches `panels/x.json`).
- AC5 (driver): the drift-coverage gap gets a test that fails first (red evidence recorded) and a guard a mutation
  makes fail (mutation evidence recorded).

## Out of scope

- HEL-1474 (EmbeddedPostgres start-guard) — another lane.
- Rendered Concertino files (gitignored; never edited or added).
