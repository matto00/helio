# HEL-1187: Split OutputService.scala and NodeSnapshotRepository.scala along single-concern seams

## Description

`origin_kind: followup` / `origin_ticket: HEL-1027`

HEL-1027 (server-side sort, filter and counts for Output rows) grew two backend files past CONTRIBUTING.md's
250-line soft file-size budget, flagged as a non-blocking `check:scala-quality` warning:

- `backend/src/main/scala/com/helio/services/pipelines/OutputService.scala` — 419 lines then (503 at 24f6de4cf)
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/NodeSnapshotRepository.scala` — 306 lines
  then (458 at 24f6de4cf)

Both are soft-budget-only overages, not a defect — `OutputRowsQuery.scala` was already factored out of
`OutputService.scala` during HEL-1027, but both files still sit above the guideline. HEL-915 (parameterized Outputs)
is expected to extend `OutputService` further — splitting now is cheaper than after.

## Scope

A structural, behavior-preserving refactor only — split each file along its existing single-concern seams (the same
discipline `OutputRowsQuery.scala`'s extraction followed). No behavior change, no new capability.

## Acceptance criteria

- `OutputService.scala` and `NodeSnapshotRepository.scala` are each back under (or meaningfully closer to) the 250-line
  soft budget, split along genuine single-concern boundaries — not an arbitrary mechanical split.
- Zero behavior change: existing tests continue to pass unmodified in their assertions (only import/location changes
  as needed).
- Tests must still actually bite after the split — demonstrate with a mutation test (a small deliberate defect
  post-split that the existing suite catches), not just "tests still pass."
- `check:scala-quality` no longer flags either file (or flags a smaller overage, if a clean single-concern split can't
  fully close the gap).

## Driver constraints (this run)

- Public API of `OutputService` (class + companion) and `NodeSnapshotRepository` (class + companion) stays
  source-compatible (constructors incl. defaults, method signatures, package): open PR #847 (HEL-1371, head ca3f5619)
  calls `NodeSnapshotRepository.listRows/overwriteRows/overwriteRowsWith` and must compile after either merges first.
  A seam needing an API change is an escalation, not a decision.
- Structural refactor discipline: behaviour-preserving only; any non-trivial defect found becomes a follow-up.
- Proof: full backend suite green with zero test edits; byte-move evidence; `javap -public` diff empty; no inline FQNs
  (`check:scala-quality`, plus eyeballing `s"${...}"`); `check:node-root-encoding` still passes with unchanged coverage.
