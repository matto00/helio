## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 54dc271fccd5e95a4cc7d7f5af72fcdc58eab0c6 (diff base 6ac99447d, resolved live via resolve-review-base.sh).
The diff is backend-only plus openspec artifacts. There is no frontend, schema or route diff, so Phase 3 is N/A.
All evaluator evidence is under `.concertino/runs/HEL-1441/evidence/eval1-*.txt` in the main checkout's run dir.

### Phase 1: Spec Review — PASS
- AC1: `PatchSetUndoService.restoreBoundOutputs` now writes `LegacyOutputFormat.normaliseRestored` (V117 then V118). The new
  end-to-end test seeds object-format Outputs via `insertInternal`, asserts that they are stored as objects, runs a REAL
  `pipelineStep` delete apply and then an undo, and reads STORED configs (C1 honoured). I re-ran it red-first myself:
  with both call sites reverted to base, the new undo test and the RestorePriorStored update test FAILED
  (`{"format":{"decimals":2,"prefix":"$"}} was not equal to {"format":"currency"}`). See `eval1-red-unfixed-callsites.txt`.
- AC2: `OutputService.update` applies the composition only under `RestorePriorStored`, on the merged config. The
  ValidateWrite control is a succeeding config patch, as the design requires. My mutation (normalise under every
  policy) turned the control red (`eval1-mut-validatewrite-control.txt`). I re-grepped for other captured-config write
  sites: there are only the two (`PatchSetApplyRollback.scala:186` reaches the second one). This matches files-modified.md.
- AC3: `LegacyOutputFormatParitySpec` extracts section 3 verbatim from the classpath V118. It asserts the marker occurs
  once and exactly one `DO $$` in the block, and checks the `jsonb_typeof(config -> 'format') = 'object'` guard. The
  block ends at the first `\n$$;`, which I checked against V118 lines 76-194. The TEMP audit table carries V118's CHECK
  constraints, and the spec asserts `pg_temp` resolution.
  - Corpus: it contains the VT (`\u000b$`), FF (`$\u000c`) and EM SPACE (` $`) prefix rows, and NBSP as a
    keep-case. Decimals x prefix is fully enumerated for metric and collection.
  - It has explicit non-string live-unit rows (`5`, `true`, `{}`), plus 2400 seeded samples.
  - Non-vacuity: every unit_action, approximation code and new_format is asserted.
  - My mutation (`btrim` -> `String.trim`) turned it red on exactly the VT/FF rows (`eval1-mut-run1-trim-shadow-item3.txt`).
- AC4: V117 `ValuePool`/`LiveStates` gained the cross-enum values and the non-string live values. Every
  Statement/ResultSet now goes through `Using.resource`. My mutation (a non-null live key shadows only if it is a
  `JsString`) SURVIVED on the base (unhardened) spec (`eval1-mut-run2-shadow-on-unhardened-v117spec.txt`) and went RED on
  the hardened spec (`eval1-mut-run1-...`, mismatches `metricLabel ... Some(7)/true/{}/[]`).
- AC5: the collection `collectionOptions.layout` and chart `chartAnnotation` rows are present in the end-to-end test.
- AC6 / item 3: I independently removed `OutputConfigValidation.validate` from
  `PipelineCreatePreflight.validateOutputConfig`. `OutputConfigKeyValidationSpec` "400 an unknown key and persist no
  pipeline" (plus the proposal validationError test) went RED and got `Right(PipelineSummaryResponse...)`. The
  conclusion is confirmed: single-call create already applies HEL-1313 key validation, and no product change is needed.
- C2: no migration and no stored-data change. C3: see Phase 2. All tasks are checked and match the implementation.
  There is no scope creep.
- workflow-state CONSTRAINTS C1-C3: all honoured.

### Phase 2: Code Review — PASS
- Gates (my own fresh runs, `nice -n 19`, `-J-Xmx3g`):
  - `sbt testFull` passed: 517 suites, 6869 succeeded, 0 failed, 4 canceled; `[hel1468-guard] ScalaTest summary: failed=0 aborted=0`. See `eval1-testFull.txt`.
  - Targeted touched specs passed: 26 tests, guard line present. See `eval1-head-green.txt`.
  - `npm run check:scala-quality` is clean: no inline FQNs, and only pre-existing soft warnings.
- Mirror correctness: I read `LegacyOutputFormat` line by line against V118 lines 100-191.
  - decimals: valid only for a non-negative whole number; an invalid value is treated as absent, so currency is still possible.
  - The btrim set is exactly space, tab, CR and LF.
  - Precedence is integer, then currency, then number. The prefix is consumed only for currency.
  - `unit` is written for metric only, only when there is text and the live unit is absent or JSON null.
  - Scope is metric/collection with an object `format`.
  - This all matches V118, and the parity spec independently confirms it.
- New embedded-PG spec uses `VerifiedEmbeddedPostgres.start(EmbeddedPostgres.builder())`. There are no inline FQNs.
- Every embedded-PG run I cited shows `[hel1468-guard]`.
- Worktree left clean (`git status --porcelain` empty at 54dc271fc). No sbt process left running.

### Phase 3: UI Review — N/A
No UI-trigger files changed.

### Overall: PASS

### Non-blocking Suggestions
- `LegacyOutputFormatParitySpec.scala`: `cfg(kind, fmt, live)` never uses its `kind` parameter. Drop it.
- `LegacyOutputFormatParitySpec.scala`, pg_temp resolution loop: add `ns should have size 1` before `ns.head`, as the
  V117 spec does. This would turn a missing relation into a clear assertion rather than a `head` exception.
