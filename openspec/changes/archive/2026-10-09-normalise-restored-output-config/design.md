## Context

See proposal.md - Why, and ticket.md "Premise validation". Ground truth on origin/main (586da928):

- `PatchSetUndoService.restoreBoundOutputs` (pipelineStep delete undo) calls `outputRepo.insertInternal(config =
  outputResponse.config.asJsObject, ...)` with the JOURNALED config, deliberately unvalidated (HEL-1313 comment). The
  journal (`PatchSetApplyResolvers.buildPipelineStepDeletePriorState`) stores each bound Output's raw stored config.
  A journal written before V117 therefore restores dead keys. This is the real gap.
- `PatchSetUndoService` has no `output` `update` restore (`PatchSetUndoConflictCheck` → 409 "no undo path").
- `OutputConfigWritePolicy.RestorePriorStored` is used only by `PatchSetApplyRollback`'s `OutputUpdate` case; its
  `priorConfig` is read live by `PatchSetApplyResolvers.resolveOutputUpdate` in the same request. Post-V117 it cannot
  hold dead keys unless storage does; normalising there is defence in depth and closes the ticket's named path.
- `OutputService.update` merges (`existing ++ patch`) and writes the merged config.
- V117's executable mapping is section 3's DO block in
  `backend/src/main/resources/db/migration/V117__migrate_v94_dead_output_config_keys.sql`; the header table documents it.

## Goals / Non-Goals

**Goals:** every Output-config restore write equals V117(captured config); one mapping, drift-pinned by a test.

**Non-Goals:** V118 `format` objects (follow-up); audit rows for restore-time normalisation; rewriting journals; any
change to `ValidateWrite` behaviour or HEL-1313 tolerance; any migration.

## Decisions

**D1 Fix sites.** Normalise at (a) `restoreBoundOutputs`, on the journaled config, before `insertInternal` (kind =
the journaled kind already resolved there); (b) `OutputService.update` only when `policy == RestorePriorStored`, on the
MERGED config before `updateOwned` (V117 operates on the stored whole config, so its shadow rule — a non-null live key
wins — must see the merged result, not the patch alone). The executor MUST enumerate every other call site that writes
a previously captured Output config (grep `insertInternal`, `RestorePriorStored`, `updateOwned`, `boundOutputs` under
`services/patchsets`) and either route it through the normaliser or record in files-modified.md why it cannot carry a
captured config. Alternative rejected: normalising inside `OutputConfigValidation.validateConfig` — that function only
validates, never transforms, and runs for `ValidateWrite` too.

**D2 One pure normaliser.** New object in `com.helio.services.pipelines` (next to `OutputConfigValidation`), e.g.
`LegacyOutputConfigKeys.normalise(kind: OutputKind, config: JsObject): JsObject`. It mirrors the DO block step for
step: the same 14 keys in the same order, judged against the ORIGINAL config's values, the shadow check against the
evolving result, the same kind-applicability (`format` kept on metric/collection, `columnOrder` on table,
`chartOptions` on chart), the same value-validity (string for label/unit/annotation; `"grid"|"list"` /
`"asc"|"desc"` nested under `layout`/`sort`; JSON null and a missing nested key count as null-value → drop). Keys not
in the 14 are untouched. It returns the config unchanged (same value) when nothing applies. No audit output is needed,
but an internal action classification may be kept for the tests. The mapping lives ONLY here on the Scala side; the
header comment points at V117 and at the parity spec.

**D3 Parity pinned against V117's own SQL (driver requirement: Flyway SQL cannot be imported).** A spec on embedded
Postgres (`io.zonky` `EmbeddedPostgres`, as `V117DeadOutputConfigKeysMigrationSpec` already uses) reads the V117 file
from the classpath, extracts the section-3 DO block VERBATIM (assert exactly one match between the
`-- ── 3. The repair` marker and the next `$$;`), creates session TEMP tables `outputs(id text, kind text, config
jsonb)` and `hel1387_dropped_output_config_keys` (same columns as V117; temp tables shadow same-named relations
because `pg_temp` is searched first), inserts a corpus, runs the DO block, and asserts for every row that the SQL result
equals `normalise(kind, config)` (compare parsed JSON, not text). Create, insert, run and read back on ONE JDBC connection (temp tables are
session-scoped), and assert via `pg_class`/`pg_namespace` that the `outputs` relation resolved is the temp one. Corpus: every kind (6) x every one of the 14 keys x
value shapes {valid, JSON null, wrong JSON type, invalid enum, nested key missing} x live key {absent, JSON null,
non-null}, plus multi-key configs and configs with only live keys. Non-vacuity: assert the DO block changed at least
the expected number of rows (computed independently) and that the corpus contains every action class. Mutation proof
(recorded in the evaluation evidence): perturb one Scala rule (e.g. accept `"up"` for timeline sort) → this spec red.
Running against the real DO block, not the header table, means a header/DO-block disagreement cannot hide drift.

**D4 Red first.** A `PatchSetUndoService` spec (reuse the existing undo spec harness) — most realistic form, per the design-gate
skeptic: insert an Output row carrying dead keys directly (as pre-V117 storage), apply a REAL pipelineStep-delete patch
set (so the journal is written by production code), then undo — journals a `pipelineStep` delete
whose `boundOutputs[].output.config` is a pre-V117 metric config (`metricLabel`) and a pre-V117 table config
(`tableDensity`, `columnWidths`), undoes it, and asserts the recreated Outputs' STORED configs (read from the repo,
not the response) are the V117 results. Run it on the unfixed code first and keep the failing transcript as evidence.
A `RestorePriorStored` `OutputService.update` unit/integration test covers D1(b) the same way.

## Risks / Trade-offs

- [Scala mapping subtly differs from SQL, e.g. JSON number vs string comparisons] → D3 runs the real SQL.
- [Temp-table shadowing silently hits the real `outputs` table] → spec runs on its own embedded DB with no V117 schema
  applied, so a real `outputs` table does not exist there; assert the temp tables exist before running.
- [Normalising under RestorePriorStored changes rollback of a deliberately-stored legacy key] → post-V117 no stored
  legacy keys remain (V117's guard raises otherwise), and HEL-1313 rejects writing new ones, so nothing legitimate is lost.

## Planner Notes

- Self-approved: option (a) per the queue; site correction (D1) from premise validation, within the ticket's scope.
- No migration; latest is V120.
