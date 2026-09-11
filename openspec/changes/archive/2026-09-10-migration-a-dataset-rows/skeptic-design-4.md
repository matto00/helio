## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

I read the current design.md, tasks.md, proposal.md and spec deltas in full, rather than relying on the orchestrator's summary.

**Round-3 CR1(a): fixed.** Decision 4 (design.md:199-209) now requires exact content-level equality: `jsonb_agg(dataset_rows.data ORDER BY seq)` vs `COALESCE(config->'rows','[]'::jsonb)`. It explicitly retires the row-count-only wording.
- This is consistent with Decision 2 step 2 (design.md:132-138) and task 1.5.
- A grep for `row.count` across all artifacts finds only "not merely a row count" disclaimers. The one other hit is the unrelated 500-row limit scenario.

**Round-3 CR1(b): fixed.** The Risks section (design.md:314-321) now describes the positional-array trade-off:
- `dataset_schema` order is load-bearing for `data`.
- Any future column drop, reorder or insert must rewrite affected rows atomically.
- The risk is flagged for HEL-1077/1078.

A grep for "an object" and "keyed" finds only negations ("not an object keyed by column name"). That includes the dataset-row-storage spec delta at line 14.

**Round-3 CR2: fixed.** tasks.md section 6 and design Decision 7a add the missing work. They cover:
- Classify every hit (task 6.1): I re-ran the grep and it still finds 55 hits across 33 files, matching the plan.
- Rewrite seeds to `'dataset'` and move the rows into `dataset_rows` and `dataset_schema` via one shared helper (task 6.2).
- Weakening assertions is forbidden, and the reason is stated: a zero-rows false green.
- Version-pinned specs (e.g. `V98PipelineRootsMigrationSpec`) stay unchanged (task 6.3), and the executor must identify them rather than bulk-replace.

**Round-3 non-blocking notes: all three addressed.**
- **Malformed `rows`/`columns`:** a JSON-null value aborts the migration. This is documented, and adding a lossy filter is forbidden (design.md:148-152).
- **`upsertInferredSchema`:** it is explicitly kept alongside the new `dataset_schema` upsert, not replaced by it (design.md:258-261).
- **`readDatasetRows`:** it reads schema and rows in a single statement (design.md:305-308).

**No regressions from this revision.** Decision 1 (RLS NO FORCE/FORCE bracket), Decision 5 (constraint drop before the UPDATE), Decision 6 (rowToDomain/domainToRow) and Decision 8 (NULL-owner row) are intact. The task ordering (1.2 to 1.10) matches Decision 2. The grep found no TODO or TBD anywhere.

No round-3 concern came back: every earlier fix took.

### Verdict: CONFIRM

The design and tasks are internally consistent, and nothing an executor would act on is ambiguous. The remaining items below are documentation hygiene and do not block execution.

### Non-blocking notes
- **proposal.md is stale on three points where design.md overrides it.** Correct it during execution, before archive. It is an archived and PR-facing artifact, and stale planning artifacts have drawn REFUTEs at the final gate before.
  - Line 15 says `kind`; design.md:3 corrects this to `source_type`.
  - Lines 17-18 say `dataset_schema` is "backfilled from each migrated source's existing inferred schema". Decision 3 and task 1.6 explicitly reject that in favour of the declared `config->'columns'`.
  - Line 15 lists the UPDATE before "drop/re-add" the constraint. Decision 5 requires the drop first.
- **Task 3.1 does not repeat the single-statement requirement** for `readDatasetRows` that design.md:305-308 sets. The executor should treat the design as binding. Better still, add "(single statement — join/subselect)" to task 3.1.
- **Decision 7a comes before Decision 7** in design.md. The order is cosmetic only.
