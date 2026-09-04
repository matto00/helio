## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

**Round-2 CR disposition — checked in the BINDING artifacts, not in `design.md` prose.**

| R2 CR | Landed in a binding artifact? | Evidence |
|---|---|---|
| 1 `binary_refs` → encoding sweep, five-table bracket, root-scoped `overwriteForNode` | **Yes** | `design.md` R12 table names all three tables; V98 step 2 says five and enumerates them; `tasks.md` 2.5a (all THREE encoding tables), 5.8a (`BinaryRefRepository:42-52,63-86` take a `NodeKey`), 2.7. |
| 2 `idx_node_snapshots_root_unique` collision + cross-root wipe | **Yes** | V98 step 4b; `tasks.md` 2.5b (recreate `UNIQUE (pipeline_id, root_id, row_index) WHERE node_step_id IS NULL`), 5.8a, 5.8c (three tests incl. "two roots each hold row_index 0"). Matches `V94:294-296` and `NodeSnapshotRepository.scala:41-43`, both re-read. |
| 3 R12 code surface enumerated | **Yes** | R12 "The enumerated surface" lists ~15 sites; `tasks.md` 5.8a/5.8b/5.8c carry them. Partial gap — see CR3 and CR5. |
| 4 unqualified SHALL in the spec delta | **Yes** | `specs/pipeline-multi-root/spec.md` now reads "No **semantic** behaviour SHALL branch…" and names exactly three deterministic tiebreaks, plus "a fourth reader of position SHALL be treated as a contract change". The binding artifact, not just prose. |
| 5 V98 step 7 "both tables" | **Partly** | V98 step 7 now enumerates all five; `tasks.md` 2.7 says "all five". **But `tasks.md` 2.3 still says "Bracket **four** tables" while listing five — CR4.** |
| 6 step-5 guard did not cover the rebind | **Yes** | `tasks.md` 2.6 asserts zero rows with both `node_step_id` and `root_id` NULL in all three tables and states why the 2.5a CHECK is not a substitute; 3.5 seeds EACH failure condition. |
| 7 `root_id` FK/delete behaviour | **Stated, and wrong for one table** | R12: `root_id TEXT NULL REFERENCES pipeline_roots(id) ON DELETE CASCADE` on all three; V98 4a and `tasks.md` 2.5a match. See **CR1** — the `node_snapshots` answer contradicts `V94:261-280`. |

**Ground truth I read myself (not from either report):** `V94__outputs_model.sql:200-232` (outputs DDL — only plain
indexes, no unique constraint, so no new collision), `:257-296` (node_snapshots FK-free rationale + the partial-unique
pair), `:344` (`panels.output_id … ON DELETE CASCADE`), `:391-394`, `:397-440` (binary_refs re-key prep),
`:774-797` (the binary_refs backfill and its `WHERE pl.output_data_type_id = br.data_type_id` join),
`:871-877`, `:1275-1335` (`DROP COLUMN data_type_id` — which also drops V46's
`UNIQUE (data_type_id, row_index, field_name)`, so `binary_refs` has **no** uniqueness left to collide),
`V46__binary_refs.sql` in full, `NodeSnapshotRepository.scala:38-110`, `OutputRepository.scala:63-70`,
`BinaryRefRepository.scala`, plus `grep -rn "RESTART IDENTITY" backend/src` (12 specs, incl.
`BetaAccessRoutesSpec:112`, `ApiRoutesSpec:104`, `AuditMutationInstrumentationSpec:135` truncating `users … CASCADE`).

**Collision re-audit of the new two-column encoding (asked for explicitly).** `outputs`: `idx_outputs_pipeline_id`,
`idx_outputs_node_step_id`, `idx_outputs_owner_id` — all non-unique; no collision. `binary_refs`: its only UNIQUE was
V46's on `data_type_id`, dropped with the column at `V94:1297`; no collision. `node_snapshots`: the one real collision
is `idx_node_snapshots_root_unique`, and 4b/2.5b fix it. **No further index/constraint collision found.** No fourth
NULL-means-root *table* exists: `grep -rn node_step_id` across all migrations returns exactly `outputs`,
`node_snapshots`, `binary_refs`.

### Verdict: REFUTE

Every round-2 CR landed in a binding artifact, and CR4's spec-delta fix in particular is real this time. The
encoding sweep is now genuine. But R12's own answer to round-2 CR7 — "`root_id` is a FK on all three" — walks
straight into the landmine `V94:261-280` documents as empirically verified, and the migration as specified will
**abort on production data** for two of the three tables. Both are new, both are reproduced from the SQL and the
repository code, neither round found them.

### Change Requests

1. **`node_snapshots.root_id` as a FK contradicts the verified reason that table has no FKs, and will break existing
   specs.** `V94:261-280` states, as an empirical finding of that cycle, that `node_snapshots` is deliberately
   FK-free because it has a `BIGSERIAL` identity column and `TRUNCATE … RESTART IDENTITY CASCADE` "transitively
   cascades through any FK-reachable table and then requires *ownership* of that table's identity sequence to
   restart it — a privilege `helio_privileged`'s GRANT-based setup (UPDATE only, not ownership) does not satisfy,
   and cannot satisfy via GRANT alone"; it names `outputs` as unaffected *because it has no identity column*.
   R12 and V98 step 4a add `root_id TEXT NULL REFERENCES pipeline_roots(id) ON DELETE CASCADE` to **all three**
   tables, which makes `node_snapshots` FK-reachable from `pipeline_roots → pipelines → users`. Twelve specs run
   `TRUNCATE … RESTART IDENTITY CASCADE`, including three that truncate `users`
   (`BetaAccessRoutesSpec:112`, `ApiRoutesSpec:104`, `AuditMutationInstrumentationSpec:135`) — exactly the case
   V94 names. Round-2 CR7 warned "do not assume the answer is uniform across the two tables"; the design answered
   uniformly and cited only `V94:279` (the "no FK" line) without engaging with `:261-280` (the reason). Required:
   `node_snapshots.root_id` is a **bare TEXT column, not a FK** (referential integrity stays the application's job,
   exactly as `pipeline_id` already is there), and R7 phase 2 must then delete its root-bound snapshot rows
   explicitly rather than relying on a cascade that will not exist. State the asymmetry and its reason in R12 and
   in the V98 header, or the next reader re-adds the FK. `outputs` and `binary_refs` keep the FK.

2. **V98 step 4a's CHECK will abort the migration on real production rows that cannot be rebound.** The rebind is
   specified as "backfill `root_id` for every row whose `node_step_id IS NULL`" followed by
   `CHECK ((node_step_id IS NULL) <> (root_id IS NULL))`. Two populations cannot be rebound and are not
   hypothetical:
   - **`node_snapshots` orphans.** The table has no FK to `pipelines` and **nothing deletes its rows on pipeline
     deletion** — `grep -rn "node_snapshots" --include=*.scala` finds exactly two DELETE sites, both inside
     `NodeSnapshotRepository.overwriteRows:41,43`, both scoped to one live pipeline. So every deleted pipeline that
     ever held a root-bound (zero-step, `node_step_id IS NULL`) snapshot leaves rows whose `pipeline_id` matches no
     `pipelines` row and therefore no `pipeline_roots` row. `root_id` stays NULL, the CHECK fails, the migration
     aborts.
   - **`binary_refs` never-rekeyed rows.** `V94:793-797` backfills `pipeline_id`/`node_step_id` only
     `FROM pipelines pl … WHERE pl.output_data_type_id = br.data_type_id`; V94's own section 10 records that 77
     `data_types` rows have no owning pipeline. Any `binary_refs` row keyed on one of those kept
     `pipeline_id IS NULL AND node_step_id IS NULL` and was never deleted. Those rows have no pipeline, hence no
     root. Same abort.

   This is loud rather than silent, which is better than the R12 class of bug — but it is a production deploy
   failure, and the obvious executor "fix" under pressure (relax or drop the CHECK) reopens the exact hole R12
   exists to close. Required: V98 must state and execute a **defined disposition** for unrebindable rows before
   adding the CHECK — delete them as orphans (with a `hel913_migration_counts`-style logged count, matching V94
   section 10's precedent) or exclude them by predicate — and `tasks.md` §3 must add a proof obligation that seeds
   both populations (an orphan `node_snapshots` row with a `pipeline_id` matching no pipeline; a `binary_refs` row
   with `pipeline_id IS NULL`) and asserts V98 completes. The count of each population in the real dump must be
   measured and recorded, not assumed zero — "the real dump has none" is the assumption `tasks.md` 3.6 already had
   to make explicit for the source-id case.

3. **The 5.8b mechanical guard, as specified, cannot see the `outputs` sites — the ones round-2 CR3 raised.**
   Task 5.8b is "fail the build on a surviving standalone `node_step_id IS NULL` predicate against these three
   tables". That text describes a grep for raw SQL. It works for `NodeSnapshotRepository` and `BinaryRefRepository`,
   which are `sqlu"…"`/`sql"…"` interpolations (`NodeSnapshotRepository.scala:41-43`, `:70-73`, `:104-106` — read
   directly). It does **not** work for `outputs`, which is Slick-lifted:
   `OutputRepository.listByNodeInternal:66` is `table.filter(r => r.pipelineId === pipelineId.value && r.nodeStepId.isEmpty)`
   — no `node_step_id`, no `IS NULL`, nothing for the grep to match. A guard that is green while the defect it
   names is present is evidence-shaped non-evidence. Required: 5.8b must cover **both** encodings — the raw-SQL
   `node_step_id IS NULL` form and the Slick lifted forms (`.nodeStepId.isEmpty`, `.nodeStepId.isDefined`,
   `=== Option.empty`) — must name the gate it hangs off (`check:scala-quality` / a `scripts/` repo-integrity check,
   the way this repo's other mechanical guards are wired), and must be proven by a task that **introduces** a
   violating line of each form and observes the guard fail (a guard never seen firing is the same non-evidence
   `tasks.md` 3.5 already demands proof against for the DO $$ block).

4. **`tasks.md` 2.3 still says "four" while enumerating five — the round-2 CR5 defect, relocated.** 2.3 reads
   "Bracket **four** tables with `NO FORCE` / restore `FORCE`:" and then lists `pipelines`, `pipeline_steps`,
   `outputs`, `node_snapshots`, `binary_refs` — five. 2.2 and 2.7 both correctly say five, and V98 steps 2/7 say
   five. A stale count next to a correct list is exactly what "both tables" was, and `tasks.md` is the artifact the
   executor works from. Fix the count.

5. **The two Output schemas are not named in the contracts section.** `tasks.md` §8 is titled "these three move in
   ONE commit or `check:schemas` fails" and names three files, none of them an Output schema; 5.8a defers to
   "Output-related `schemas/`" without naming any. `grep -rln nodeStepId schemas/` returns exactly
   `schemas/outputs/create-output-request.schema.json` and `schemas/outputs/output.schema.json` — both must gain the
   root binding once `CreateOutputRequest` does (R12 states that without it "every such create fails" the new
   CHECK), and `check:schemas` parity against `AssistantProposalToolSchemas.scala` is strict here
   (`KNOWN_PRE_EXISTING_DRIFT` empty). Name both files in §8 with their own checkboxes; an unnamed schema is the
   one this change ships broken.

### Non-blocking notes

- **HEL-914 sufficiency (round-2's open note) is now met**, including the Output-binding surface: the spec
  requirement "An Output or snapshot bound to the root binds to a root id, never to NULL" plus R15's wire rule
  (root serializes as its root id with an explicit discriminator) plus 5.8a's `CreateOutputRequest`/`OutputProtocol`
  coverage give HEL-914 a wire shape for "an Output bound to root R" without re-deriving it. CR5 is about the
  schema files, not the contract.
- **V98 step order after 4a/4b is sound.** 4a's CHECK lands before the step-5 guard and before the step-6 drop, so
  a failed rebind stops the migration in two independent places (constraint validation is not RLS-filtered, so the
  CHECK fires even when the bracket is wrong; 2.6's guard covers the case where it does not). 4b before 5 is
  correct — the index must be per-root before any second root can exist.
- **`panels.output_id` is `ON DELETE CASCADE` (`V94:344`)**, so a DB-level `pipeline_roots` delete would cascade
  root → outputs → panels, deleting placements without R7's placement report. R7's service path reports first, so
  this is only a hazard if anything ever deletes a root outside the service. Worth one sentence in R7.
- **R-clause ordering** (R10, R12–R15, then R11) is still out of order, as round 2 noted. Cosmetic.
