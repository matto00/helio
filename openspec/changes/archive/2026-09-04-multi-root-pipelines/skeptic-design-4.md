## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

**Round-3 CR disposition, checked in the BINDING artifacts.**

| R3 CR | Landed? | Evidence |
|---|---|---|
| 1 `node_snapshots.root_id` bare TEXT, not FK; asymmetry stated; R7 phase 2 deletes explicitly | **Yes (design + tasks); partial in spec/tasks for the R7 half** | `tasks.md` 2.5a ("**FK asymmetry is deliberate**… bare `TEXT NULL` on `node_snapshots`… Do not 'tidy up'"); `design.md:273-295` table + rationale; V98 step 4a (`design.md:443-445`). R7 delete clause exists at `design.md:164` only — see CR2. |
| 2 delete unrebindable orphans before the CHECK, logged counts | **Yes** | `tasks.md` 2.5a-i (orphan `node_snapshots`, `binary_refs` `pipeline_id IS NULL`, `hel913_migration_counts` style, "measure against the real dump — do not assume zero"), 2.5a-ii (CHECK after), 3.5a (seed both populations, assert V98 completes); V98 step 4a matches. |
| 3 guard covers raw-SQL AND Slick forms, names its gate, proven by a violating line | **Yes** | `tasks.md` 5.8b (a) raw SQL (b) `.nodeStepId.isEmpty` / `.isDefined` / `=== Option.empty`, hung off `check-repo-integrity.mjs` or `check:scala-quality`; 5.8b-i introduces a violating line of EACH form. |
| 4 `tasks.md` 2.3 "four" vs five | **Yes** | 2.3 now reads "Bracket **five** tables" and lists five. |
| 5 both Output schemas named in §8 | **Yes** | 8.3a `schemas/outputs/create-output-request.schema.json`, 8.3b `schemas/outputs/output.schema.json`, each its own checkbox. |

**Ground truth I read myself.** `V94__outputs_model.sql:255-300` — confirms verbatim the FK/`TRUNCATE … RESTART
IDENTITY CASCADE` finding CR1 rests on, and confirms `idx_node_snapshots_root_unique` is
`UNIQUE (pipeline_id, row_index) WHERE node_step_id IS NULL`, so 2.5b/4b are correct and necessary.
`grep -rl node_step_id backend/src/main/resources/db/migration` returns V94 only — no fourth NULL-means-root table.
`grep -rn source_data_source_id` — `V22:4`, `V41:64` (historical migrations, replayed before V98, unaffected),
`PipelineRepository.scala:462`, `WorkspaceTeardownRepository.scala:110,120` — all covered by tasks 4.3/4.5.

**Migration ordering re-audited.** 2.3 brackets `node_snapshots` and `binary_refs`, so 2.5a-i's orphan DELETEs run
inside `NO FORCE` (otherwise RLS would silently filter them and the CHECK would still abort). Order
backfill → orphan-delete → CHECK → per-root unique index → step-2.6 NULL/NULL guard → `DROP COLUMN` → restore FORCE
is sound; the CHECK and the DO $$ guard remain two independent stops. The `binary_refs` `pipeline_id IS NULL` rows
are unreachable by `BinaryRefRepository` (all reads key on pipeline), so deleting them is safe.

**Index/constraint re-sweep.** No additional unique constraint keyed on the NULL-means-root encoding beyond
`idx_node_snapshots_root_unique`. Leftover snapshot rows from a removed root cannot collide under the new
`UNIQUE (pipeline_id, root_id, row_index)` (distinct `root_id`), so CR2 below is a leak, not a collision.

**HEL-914 contract sufficiency: CONFIRMED.** `specs/pipeline-multi-root/spec.md` fixes root identity (opaque id,
position never an address), ordering (three enumerated deterministic tiebreaks, a fourth reader is a contract change),
root lifecycle, root ACL, the root-bound Output/snapshot encoding, `rootClientId` create-time resolution, and the wire
rule (root id + explicit discriminator, never a null node id). HEL-914 can plan against this without re-deriving.

### Verdict: REFUTE

Two new defects, neither found by rounds 1–3, both of which ship real breakage rather than reading awkwardly.

### Change Requests

1. **The MCP write surface that attaches at the root has no root to name after this change, and no task covers it.**
   R12/5.8b sweep "by encoding, not by name" — but only across Scala. The identical NULL/absent-means-root encoding
   lives in `helio-mcp/**`, which `tasks.md` §9 does not enumerate. Read directly:
   - `helio-mcp/src/tools/write.ts:330` — `add_step` takes `parentStepId: z.string().min(1).optional()`; absent means
     "extends the trunk from the root" (`pipelines.ts:66-67`). Task 7.3b makes the backend require **exactly one of**
     `parentStepId`/`rootId`, so `add_step` with `parentStepId` absent becomes an unconditional named error and MCP
     loses the ability to add a root-level step at all.
   - `helio-mcp/src/tools/outputs.ts:60,70` + `outputsHandlers.ts:35-47` — `add_output`'s `nodeStepId` is optional,
     "absent means the pipeline's raw source". After 2.5a-ii's `CHECK ((node_step_id IS NULL) <> (root_id IS NULL))`
     that write is NULL/NULL and is rejected by the database. `design.md` R12 already says exactly this about
     `CreateOutputRequest` ("every such create fails") — 5.8a fixes the Scala/schema half, nothing fixes the caller.
   - `helio-mcp/src/tools/pipelinesHandlers.ts:189-201` — `apply_pipeline_shape` passes `parentStepId = input.stepId`
     (undefined when applying at the start of a pipeline) into `addPipelineStep`, then `nodeStepId: parentStepId` into
     `createOutput`. Both hit the two failures above.
   - `helio-mcp/src/tools/assertSchemas.ts:109,123` (`parentStepId?`), `helioApi.ts:828` and `:833-836` (contract
     comments asserting absent-means-source), `context.ts:146-147,200`
     (`nodeStepId: string | null` / `o.nodeStepId ?? null` — a wire summary that encodes root as `null`, which R15 and
     the spec delta's "A null node id SHALL NOT be used to mean 'the root'" ban), and the tests pinning it
     (`context.test.ts:199-207` asserts `nodeStepId: null` for a source-attached Output).

   Required: extend §9 with explicit tasks for the MCP root-attachment surface — `add_step` and `add_output` (and
   `apply_pipeline_shape`) gain a `rootId`, exactly-one-of validation mirroring 7.3b/backend, never a silent default
   to `roots[0]` (HEL-620 class); `context.ts`'s Output summary carries a root id with a discriminator instead of
   `nodeStepId: null`; `helioApi.ts:828/833` comments corrected; the pinning tests updated. Extend 5.8b's mechanical
   guard, or add a sibling TS guard, to the `helio-mcp/**` encoding (`nodeStepId` optional-means-root,
   `parentStepId` optional-means-root) — otherwise the guard is green while the defect it names is present in
   TypeScript, the same evidence-shaped non-evidence round-3 CR3 rejected for Slick.

2. **R7's explicit `node_snapshots` delete on root removal exists only in `design.md` prose — not in the spec delta,
   not in `tasks.md`.** Round-3 CR1's second half required it precisely because `node_snapshots.root_id` is now a
   bare column with no cascade. `design.md:164` says "and any Outputs/`node_snapshots` bound to the root itself
   (R12)", but `specs/pipeline-multi-root/spec.md`'s "Removing a root removes its lanes and their Outputs" requirement
   stops at "steps' Outputs and the Outputs' panel placements" (no snapshot/root-bound clause, no scenario), and
   `tasks.md` 7.5 says only "phase 2: report placements, delete, compact positions". The executor works from
   `tasks.md` and the spec. As specified, every root removal permanently leaks the removed root's root-bound
   `node_snapshots` rows — re-creating, on the live product, exactly the orphan population 2.5a-i had to write a
   migration step to clean up. Required: add the explicit root-bound `node_snapshots` deletion to `tasks.md` 7.5 and
   to the spec-delta requirement (plus a scenario: "removing a root deletes its root-bound snapshot rows"), and state
   why it is explicit there and cascade-driven for `outputs`/`binary_refs` (the CR1 asymmetry), so it is not deleted
   as redundant.

### Non-blocking notes

- `design.md`'s V98 **step 5** (`:454-456`) describes the DO $$ guard as covering only "any pipeline has no root, or
  any `parent_step_id IS NULL` step has no `root_id`" — it omits the three-table NULL/NULL condition that
  `tasks.md` 2.6 (correctly, per round-2 CR6) requires. Both artifacts are binding; align step 5 with 2.6 so a reader
  of `design.md` alone does not write the weaker guard.
- R-clause ordering (R10, R12–R15, then R11) is still out of order — cosmetic, flagged since round 2.
- The `panels.output_id ON DELETE CASCADE` hazard note asked for in round 3 landed (`design.md:169-172`).
