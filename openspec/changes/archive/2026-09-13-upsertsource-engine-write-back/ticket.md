# HEL-1100: Engine implementation: append or replace into a dataset

## Description

Implement the step in the in-process engine, writing through the dataset row API rather than reaching into storage directly.

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627). Parent epic HEL-1098. This ticket registers `upsertsource` in `PipelineStep.Registry`/`PipelineStepKind.All`, flipping `PipelineCreateTransactionalSpec`'s pinned rejection for `upsertsource` only (HEL-1099 design-gate note); blocked by HEL-1101 (merged, PR #658).

## Acceptance Criteria

- `append` preserves existing rows.
- `replace` swaps atomically: a concurrent reader never observes an empty or half-written dataset mid-swap (proven by a real concurrent-read test).
- A failed write fails the run rather than partially committing (proven by fault injection: zero rows committed).
- Upstream rows are validated with `DatasetRowValidator` against the target's declared schema; a mismatch fails the run with a surfaced error, never silent coercion.
- Writes land under the pipeline owner's tenant, never bypass forced RLS on `dataset_rows`, never cross-tenant; exercised under a non-superuser role.
- An API-level test proves HEL-1101's cycle guard rejects a direct and a transitive cycle on every create/update/import/duplicate/proposal-apply path it covers, with `upsertsource` registered.
- Full op-wiring: registry, analyze/infer parity, every allowlist; `convertformat`/`analyzewithai`/`generatetext` stay rejected.
- The pipeline editor does not crash (or silently mis-render) on a persisted `upsertsource` step; the real step card is HEL-1102.
