# HEL-1376: Split model.scala (~1300 lines): move PanelAppearance/ChartAppearance merge + patch types into their own file

## Description

origin_kind: followup
origin_ticket: HEL-1304

`backend/.../model.scala` is ~1300 lines, well past CONTRIBUTING.md's ~400-line split threshold. HEL-1304 changed
`PanelAppearance.applyPatch` there (the merge now starts from a default without `chartType`, so an implicit "line" no
longer beats the Output's chartType). Extract the PanelAppearance/ChartAppearance types, their patch types and the merge
logic into their own file(s).

## Acceptance criteria

- Behaviour-preserving: `PanelAppearanceMergeSpec` and the full backend suite pass with only import changes.
- No JSON wire change (JsonProtocols formats keep resolving).
- No inline FQNs (CONTRIBUTING.md / check:scala-quality).

## Driver context (verified at Setup, see premise-validation evidence)

- model.scala is 1306 lines at origin/main b409172a; last touched by HEL-1304 (60fdb87d); nothing since moved the seam.
- Proof required: per-suite `sbt testFull` counts identical before/after; `PanelAppearanceMergeSpec` passes with
  import-only (expected: zero) changes; public-API diff (javap) of the moved types; byte-move check; JSON formats still
  resolve with identical serialized output (golden round-trip for representative appearances).
- Structural refactor: a bug found becomes a follow-up, not a fix. Keep the package.
