# HEL-1590: domain/steps/README.md file list names 23 *Step files; 27 exist (AnalyzeWithAi, ConvertFormat, GenerateText, UpsertSource missing)

## Description

Found by HEL-1467's final-gate skeptic (round 3). The finding is non-blocking and out of HEL-1467's scope.

`backend/src/main/scala/com/helio/domain/steps/README.md` lines 3-9 say "one file per step type" and list 23 `*Step`
files. The directory now has 27. `AnalyzeWithAiStep`, `ConvertFormatStep`, `GenerateTextStep` and `UpsertSourceStep`
are missing from the list.

Fix to the HEL-1156 standard: no completeness claim. Either replace the list with a re-derive command (for example
`ls backend/src/main/scala/com/helio/domain/steps/*Step.scala`), or keep it and add that command. Use the same pattern
HEL-1467 applied to the step-kind count in the same file.

origin_kind: followup
origin_ticket: HEL-1467

## Acceptance Criteria (from the driver brief)

- The README's file list is re-derived from the tree with a recorded command, and that command is in the README
  (the HEL-1451 pattern in `services/pipelines/README.md`).
- The README makes no unverifiable completeness claim.
- Every other sentence in the README stays truthful; no claim HEL-1467 removed is reintroduced
  (archive: `openspec/changes/archive/2026-10-13-completeness-comments-drift-coverage/`).
- Docs only: no behaviour change.
