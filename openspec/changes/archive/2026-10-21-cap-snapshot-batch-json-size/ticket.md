# HEL-1679: Run snapshot writes: cap batches by accumulated JSON size, not row count (a 200-row long-text run peaks at 294 MB, over the 192 MB per-run share)

## Description

origin_kind: followup
origin_ticket: HEL-1660 (owner ruled proceed-to-delivery, 2026-10-19)

HEL-1660 bounds real runs: rows, live cells and text per node, frame release, and a post-walk price. It also batches
`NodeSnapshotRepository.overwriteRowsAction`'s JSON build in groups of 200 rows, a path backfill shares. Final round 3
found that batches are capped by row count, not by size. A node of 200 rows or fewer is still serialised in one batch:

- A 200 x 2 CSV of 35,000-character UTF-16 text (14 MB, inside the CSV limits) through 3 `concat` steps is accepted.
- It peaks at 294 MB (294.7 and 294.0 over two repeats) against the 192 MB per-run share (ruling 3). That is under the
  768 MB heap, so there is no OOM alone, but concurrent runs share the heap.
- The batched-write guard spec cannot detect a regression back to building all the JSON at once; only the opt-in heap
  spec would.

Evidence: `.concertino/runs/HEL-1660/evidence/openspec/changes/bound-run-path-memory/skeptic-final-3.md`.

Fix:

- Cap each batch by accumulated JSON size, with at least one row per batch.
- Add a deterministic CI guard that fails if `compactPrint` moves out of the per-batch step.
- Re-measure the 200-, ~20- and 1-row long-text shapes under `-Xmx768m`.

Note: each HEL-1660 final round found a new post-walk shape. The bound rests on measurements, not a proof. Consider
pricing the snapshot write by its JSON length against the run budget, so new shapes are refused instead of discovered.

## Acceptance Criteria

- AC1: Every listed shape (200-, ~20- and 1-row long-text, UTF-16) stays at or under 192 MB peak under a forked
  `-Xmx768m` JVM, measured with repeats.
- AC2: A red-first heap measurement (before the fix, on origin/main e88acadb9) is recorded.
- AC3: The CI guard is deterministic and mutation-checked (a mutation that builds the JSON text eagerly or ignores the
  size cap turns it red).
- AC4: Backfill is covered (it writes through the same method).

## Owner rulings carried from HEL-1660

- Ruling 3: a 25% per-run share, 192 MB of the 768 MB production heap.
- A run over a limit fails with a step error worded as a pipeline run limit; clean failures are accepted.

## Premise validation (orchestrator, 2026-10-21)

Verdict minor-staleness: HEL-1660's last commit already added the lazy-render guard by row count
(`NodeSnapshotBatchedWriteSpec`, counting seam `overwriteRowsActionRendering`). What remains is the size cap and a guard
on rendered SIZE ahead of the inserts. See `.concertino/runs/HEL-1679/evidence/premise-validation.md`.
