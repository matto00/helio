## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: d76cf1158b737d71e01fd04fb9f937647189dc3c. The diff base was resolved live with
`resolve-review-base.sh`, which returned 586da928abb6b7000d5e17799d3b5fb9b181ebce (exit 0).

### What I verified (with evidence)

**Scope of the diff** (`git diff 586da928...HEAD --stat`): three backend main files (new
`LegacyOutputConfigKeys.scala`, `PatchSetUndoService.scala` +8/-2, `OutputService.scala` +7/-1), four test files, and
the change artifacts. There are no frontend changes and no migration, so UI step 4 does not apply and no servers were
started.

**AC1: restore writes V117(config), never dead keys.**
- Undo site: `PatchSetUndoService.restoreBoundOutputs` now passes
  `LegacyOutputConfigKeys.normalise(kind, outputResponse.config.asJsObject)` to `insertInternal`. The kind is the same
  journaled kind used for the insert, and the journal value itself is not modified.
- Rollback site: `OutputService.update` normalises the MERGED config only when
  `policy == RestorePriorStored`. ValidateWrite is unchanged.
- `PatchSetUndoDeadOutputKeysSpec` covers four cases: rename (metricLabel/metricUnit), shadow (label kept,
  metricLabel dropped), drop with exemption (tableDensity/columnWidths dropped, columnOrder kept on table), and
  nested rename (timelineOptions.sort). It reads STORED configs via `findConfigById`. This satisfies C1: a real
  pipelineStep-delete apply journals dead-key Outputs that were seeded through `insertInternal`.

**AC2: same mapping as V117, drift-pinned.** I compared `LegacyOutputConfigKeys.normalise` line by line with V117
section 3's DO block:
- Key order is identical.
- `CONTINUE WHEN NOT jsonb_exists(r.config,k)` maps to `!config.fields.contains(key)`, checked against the original.
- The format/columnOrder/chartOptions `CONTINUE WHEN` kinds match `KeptOnKinds`.
- Wrong kind, JSON null, wrong type, invalid enum, and a missing or null nested key all drop in both.
- The shadow check reads the evolving `cfg` in both (`live_val IS NOT NULL AND typeof <> 'null'` maps to
  `cfg.fields.get(live).exists(_ != JsNull)`).
- A rename removes the dead key and then adds the live key.

The adversarial edges are inert by construction. Each dead key's value is read from the original. No live target is
a dead key, and no two dead keys share a live target. So "order", "original vs evolving" and "shadow on original vs
evolving" cannot produce different results here, and no corpus could separate them. Every rule that can drift is
single-key, and the parity corpus's `single` set is a full product over 6 kinds × 14 keys × 19 value shapes × live
states {absent, null, non-null}. Non-object configs: V117 skips them, and the Scala side takes `JsObject` (the
`asJsObject` call at the undo site predates this change).

The parity spec does the following:
- Extracts the DO block verbatim from the classpath migration and asserts the marker is unique.
- Runs on one connection against TEMP tables and asserts via `pg_class` that they resolve to `pg_temp`.
- Asserts zero row mismatches.
- Adds non-vacuity checks: more than 1500 rows changed, all 6 audit action classes present, and Scala changed
  exactly the rows SQL changed.

The recorded mutant transcript (`exec-parity-mutant.txt`) shows row-level SQL/Scala diffs (`"sort":"up"` carried by
Scala, dropped by SQL), and the green re-run passes. Both transcripts name this worktree's project path.

**AC3: journals not rewritten; no migration.** No migration files are in the diff. The undo site wraps only the
argument to `insertInternal`.

**AC4: red-first.** `exec-red.txt` names this worktree's project path. The test fails at
`PatchSetUndoDeadOutputKeysSpec.scala:48` with `{"keep":1,"metricLabel":"Revenue","metricUnit":"USD"} was not equal
to {"keep":1,"label":"Revenue","unit":"USD"}`, which is exactly the gap.

**The HEL-1313 test edit in PatchSetApplyServiceSpec (~line 1163) is legitimate.** I read the binding spec,
`openspec/specs/output-routes-api/spec.md` lines ~442-476. It exempts restoring journaled prior config from the
known-key VALIDATION ("SHALL NOT be subject to this requirement"). It does not require a dead key to survive a
restore. The "stored legacy key does not block an update" scenarios cover the ValidateWrite update path, which is
unchanged here and still exercised by `OutputConfigKeyValidationSpec`, which passed. The edited test still proves
what HEL-1313 D9 cares about: the restore is not refused (`rolledBack`), and the scatter+aggregation config is
restored. Only the kind-inapplicable `metricLabel` on a chart is dropped, which is what V117 would do.

**Other restore sites.** I grepped `services/` for `outputRepo.`, `outputService.`, `insertInternal` and
`RestorePriorStored`. The only writes of captured Output config are the two sites that were fixed.
- `PatchSetApplyRollback.compensatePipelineStepDelete` recreates only the step through `addStep` and writes no
  Output config.
- OutputDelete and PipelineDelete rollback are `unrecoverable`.
- Output update undo is refused as "no undo path" (`PatchSetUndoConflictCheck:63`).
- `PatchSetApplyForward` is a ValidateWrite forward edit.

The enumeration in `files-modified.md` matches what I found.

**Gates, re-run by me** (worktree-pinned:
`nice -n 19 sbt -batch -Dsbt.server.autostart=false "testOnly ..."` from the worktree's own `backend/`; the
project-path line names the HEL-1409 worktree):
- Run 1: LegacyOutputConfigKeysSpec, LegacyOutputConfigKeysParitySpec, PatchSetUndoDeadOutputKeysSpec and
  PatchSetApplyServiceSpec. Result: 4 suites, 60 tests, 0 failed.
- Run 2: `PatchSetUndo*`, `PatchSetApply*` and `OutputConfig*`. Result: 10 suites, 108 tests, 0 failed.

### Verdict: CONFIRM

### Non-blocking notes
- The parity corpus has two small gaps.
  - The value pool has no cross-enum nested values (`{"layout":"asc"}`, `{"sort":"grid"}`), so a Scala mutation that
    let one key accept the other key's enum would go unnoticed.
  - The non-null live state is only a JSON string, so a mutation "shadow only when the live value is a string" would
    also go unnoticed.
  
  Adding `o("layout"->"asc")`, `o("sort"->"list")` and a non-string non-null live value (for example `JsNumber(0)`)
  would close both.
- The spec delta sits under `patch-set-undo` but its requirement also covers mid-apply rollback, which is
  `patch-set-apply`'s territory. This is acceptable, but a reader of `patch-set-apply/spec.md` will not see it.
- In `restoreBoundOutputs`, an unknown journaled kind falls back to `Table` (this predates the change). The
  normaliser then applies table rules, which match the kind that gets written, so the two stay consistent.
