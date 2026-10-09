## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 586da928abb6b7000d5e17799d3b5fb9b181ebce (= origin/main; change dir untracked). Spawn-cwd guard: READY.

### What I verified (with evidence)

1. **Premise correction is right.** `PatchSetUndoService.restoreOne` (PatchSetUndoService.scala ~L109-127) has no
   `("output", _)` arm; it falls into `no undo path`. The only journal-to-storage Output-config write is
   `restorePipelineStepDelete` -> `restoreBoundOutputs` (L286-312), which calls `outputRepo.insertInternal(config =
   outputResponse.config.asJsObject, ...)` raw, with the HEL-1313 "deliberately NOT validated" comment. The journal is
   built from stored configs (`PatchSetApplyResolvers` L685-695, `configs.getOrElse(o.id.value, ...)`).
   `RestorePriorStored` for Outputs is used in exactly one place, `PatchSetApplyRollback` L183 (`OutputUpdate`),
   whose `priorConfig` is resolved in the same request. Other rollback arms do not restore Output configs:
   `compensatePipelineStepDelete` recreates only the step, and `OutputDelete` is `unrecoverable`. I grepped
   `RestorePriorStored|insertInternal|boundOutputs` under `services/`. The two sites in D1 are the only places where a
   captured Output config gets written back, and task 1.5 still requires the executor to re-enumerate them.
2. **The merged-config normalisation (D1b) matches V117.** `OutputService.update` builds `mergedConfig = existing ++
   patch` and `OutputRepository.updateOwned` (L253-256) **replaces** the `config` column with it. There is no SQL
   jsonb merge, so a dropped key really disappears. V117 judges the shadow rule against the whole stored config
   (`live_val := cfg -> live` on the evolving `cfg`), so normalising the merged result is the correct analogue.
   Normalising only the patch would miss a live key that already exists in storage.
3. **D2 matches the V117 DO block.** I checked it against section 3 of
   `V117__migrate_v94_dead_output_config_keys.sql`:
   - The same 14 keys are processed in the same order.
   - Values are read from the original `r.config`, and the shadow check runs against the evolving `cfg`.
   - `format` is kept on metric/collection, `columnOrder` on table and `chartOptions` on chart.
   - String-only checks apply to label/unit/annotation.
   - The nested `layout`/`sort` enum checks are present.
   - A missing nested key or JSON null drops the key.
   There are 6 `OutputKind`s (model.scala L870-875), which matches the corpus axis.
4. **The D3 parity approach is sound and non-vacuous.**
   - The existing `V117DeadOutputConfigKeysMigrationSpec` starts a fresh `EmbeddedPostgres` for each test. A parity
     spec that applies no Flyway chain therefore has no real `outputs` table to shadow by mistake.
   - Even if a real table existed, PL/pgSQL resolves unqualified relations through `search_path` at run time, and
     `pg_temp` is searched first for relations.
   - Extracting the DO block verbatim and asserting exactly one match closes the "header table vs DO block" drift.
     The first `$$;` after the section-3 marker is the DO block's terminator.
   - Comparing every corpus row means an identity normaliser would fail. The planned mutation ("up" accepted for
     timeline sort) is covered by the corpus's "invalid enum" shape.
5. **Scope.** V118 belongs to HEL-1410 (its header names HEL-1410 and scopes it to object-valued `format` on
   metric/collection). This ticket and its ACs cite V117 only, so excluding V118 is correct. No AC requires audit
   rows: the ACs require V117's config result, and the journal keeps the original values. "No migration" and "journals
   not rewritten" are both honoured.
6. **AC coverage.**
   - AC1 is covered by D1 plus tasks 1.3/1.4 and the spec scenarios.
   - AC2 is covered by D3 and task 2.3.
   - AC3 is covered by the non-goals.
   - AC4 is covered by D4 and task 1.1, which keeps the red transcript.
   I found no placeholders, no TBDs and no contradictions between the proposal, design and tasks.

### Verdict: CONFIRM

### Non-blocking notes
- Spec wording: the requirement says the write equals "what V117 would have produced from the captured config". For
  the mid-apply rollback path it is actually V117(merged existing ++ captured), per D1b. Consider rewording so the
  spec matches D1b (for example "from the config being written").
- D3 implementation detail: temp tables are scoped to the session. CREATE, INSERT, the DO block and the readback must
  all run on one JDBC connection. Also `assert` that `pg_temp.outputs` is the relation that gets resolved (for example
  `SELECT 'outputs'::regclass::text`, or check `relpersistence = 't'`), as the risks section already plans.
- D3: compare the configs parsed as JSON, as planned. jsonb keeps numeric text (`1.0`), and spray's `BigDecimal`
  equality tolerates that. Do not compare raw strings.
- D4: how the pre-V117 config gets into the journal is left open. The most realistic repro is to seed an Output row
  raw via `insertInternal` with dead keys, then apply a real `pipelineStep` delete patch set so the resolver journals
  it, then undo. A hand-written journal row is weaker evidence.
- Adjacent, not in scope: `PipelineService` single-call create (L645-660) inserts Output configs and validates only
  `fieldMapping`, not HEL-1313's key check. That is a write-path question, not a restore path, so it does not belong
  here. Worth a follow-up check if HEL-1313 claims it rejects dead keys on every write path.
