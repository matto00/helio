## Standing Constraints

- [C1] Position-update route tests use at least two sibling steps and an in-range target index, so preview (copies position verbatim) and apply (clamps/renumbers) agree for reasons unrelated to this ticket.
- [C2] The registry guard reports every missing kind in a single failing run (collect failures per kind, do not stop at the first MatchError), and catches MatchError per kind so the failure names the kind.
- [C3] Add the new guard spec to the registry-driven test list in the PipelineStepKind.All scaladoc.

## 1. Red-first reproduction (before any production edit)

- [x] 1.1 Re-verify the missing-kind set: diff `PipelineStep.Registry.keySet` against the arms in `withPosition` and `withDecodedConfig`; record the list (expected exactly convertformat, analyzewithai, generatetext).
- [x] 1.2 Write the route-level spec (design D4) for each missing kind: position-only and config update previews, plus apply-path confirmation. Run it on unfixed code; record the observed red status per case in `red-evidence.md` in the change dir.
- [x] 1.3 Write the Registry-driven structural guard spec (design D3). Run on unfixed code; record that it fails naming each missing kind.

## 2. Fix

- [x] 2.1 Add `ConvertFormatStep`, `AnalyzeWithAiStep`, `GenerateTextStep` arms to `withPosition` and `withDecodedConfig` in `backend/src/main/scala/com/helio/services/patchsets/PatchSetPreviewProjectionSteps.scala`; correct the scaladoc counts (D5).
- [x] 2.2 Re-run both specs green.

## 3. Guard proof

- [x] 3.1 Mutation: remove one arm, confirm the guard spec fails naming that kind, restore; record the transcript.

## 4. Gates

- [x] 4.1 Run the patch-set test packages (`services.patchsets`, `api.routes.patchsets`, `domain.model`) and the two new specs in the foreground (resource caps per CLAUDE.md); code-quality checks pass. The full `sbt testFull` suite is left to CI (`ci-complete`); no foreground full-suite green was observed.
