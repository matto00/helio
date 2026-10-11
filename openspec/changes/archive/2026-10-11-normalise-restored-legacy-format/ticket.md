# HEL-1441: After HEL-1409: undoing a step delete can restore pre-V118 object-valued metric/collection format; harden the V117 parity spec; check single-call create skips HEL-1313 key validation

## Description

Origin: HEL-1409 (matto00/helio#885, 7b938178), lane-reported. Priority Low; labels Follow-up, Bug.

1. **V118 restore gap.** V118 (HEL-1410) maps legacy object-valued `format` on metric/collection Outputs to string formats. `PatchSetUndoService.restoreBoundOutputs` (undo of a pipelineStep delete), journaled before V118, would write the object format back. Apply the same pattern as HEL-1409: normalise via a Scala copy of V118's mapping, pinned by a parity spec that runs V118's actual SQL on temp tables. Red-first via a real step-delete apply then undo.
2. **V117 parity spec hardening:** add cross-enum nested values (e.g. `{"layout":"asc"}`) and non-string, non-null live values so those mutations go red; close leaked JDBC statements/result sets. Optionally add collection `layout` and chart `annotation` rows to the end-to-end undo test.
3. **Verify:** does `PipelineService`'s single-call create (`POST /api/pipelines` with outputs) apply HEL-1313's Output config key validation, or only check `fieldMapping`? If it skips it, that's a write path accepting unknown keys. Red test, then fix.

## Acceptance Criteria

- AC1: Undoing a `pipelineStep` delete whose journal holds a bound metric/collection Output with an object-valued `format` recreates that Output with exactly the config V117-then-V118 would have produced (string `format`; metric `unit` written only where absent/JSON null). Proven red-first by a real step-delete apply then undo over Outputs stored with an object `format`, reading STORED configs.
- AC2: The same V118 normalisation applies on the other captured-config restore path HEL-1409 covered (`OutputService.update` under `RestorePriorStored`, on the merged config), and nowhere under `ValidateWrite`.
- AC3: A parity spec runs V118's section-3 DO block verbatim (from the classpath migration) on session TEMP tables and asserts the Scala mapping equals it on every row of a corpus that covers every mapping branch and approximation class; a recorded mutation of the Scala mapping turns it red.
- AC4: The V117 parity spec's corpus includes cross-enum nested values (`{"layout":"asc"|"desc"}`, `{"sort":"grid"|"list"}`) and non-string non-null live values; recorded mutations (enum merge; "only a string live key shadows") turn it red; every JDBC Statement/ResultSet it opens is closed.
- AC5 (optional, in scope): the end-to-end undo test includes a collection `layout` (via `collectionOptions`) and a chart `annotation` (via `chartAnnotation`) row.
- AC6: Item 3 is verified against main with evidence. Premise validation found it already satisfied (`PipelineCreatePreflight.checkOutput` -> `OutputConfigValidation.validate`, pinned by `OutputConfigKeyValidationSpec`); the evidence is a recorded mutation (remove the key validation from `validateOutputConfig`) that turns the existing single-call create test red, then restored. No product code change for item 3.
- No migration; no stored-data change; journals are not rewritten.
