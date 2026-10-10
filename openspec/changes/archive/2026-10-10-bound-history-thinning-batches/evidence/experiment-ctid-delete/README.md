Experiment, NOT shipped: the thin victims deleted by `ctid = ANY(ARRAY(SELECT ctid ...))` (Tid Scan) instead of
`id IN (subquery)`. S4 (deep backlog), R=25000, prod-io-base committed drain, one batch per pass: 469 s (this) vs
588 s (id IN) for the same 300 batches and the same 5,392,209 deletes. A ~20% gain, not the 3-5x gap to the old
single statement (110 s), so it does not pay for relying on ctid; reverted. The cost is first-touch page work
(about one full-page WAL image per deleted row, because an Output's rows are scattered one per heap page), see
measurements.md. Files: drain-old/new logs of that run.
