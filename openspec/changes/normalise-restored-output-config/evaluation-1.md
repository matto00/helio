## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: d76cf1158b737d71e01fd04fb9f937647189dc3c. Live-resolved base: 586da928abb6b7000d5e17799d3b5fb9b181ebce
(`resolve-review-base.sh`, exit 0).

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (undo restore writes what V117 would produce): `PatchSetUndoService.restoreBoundOutputs` now calls
  `LegacyOutputConfigKeys.normalise(kind, journaledConfig)` before `insertInternal` (PatchSetUndoService.scala:303).
  The ticket's literally-named `RestorePriorStored` path is also closed: `OutputService.update` normalises the MERGED
  config only under that policy (OutputService.scala:198-203). ValidateWrite is unchanged.
- AC2 (same mapping as V117, drift pinned): `LegacyOutputConfigKeysParitySpec` extracts section 3's DO block verbatim
  from the classpath migration (it asserts the marker occurs exactly once and the block holds exactly one `DO $$`),
  runs it over temp `outputs`/audit tables on one connection (it asserts via `pg_class`/`pg_namespace` that both
  resolve to `pg_temp`), and compares parsed JSON per row for about 2,900 rows. It also has non-vacuity guards: more
  than 1,500 rows changed, more than 50 unchanged, all six audit action classes present, and the Scala side changed
  exactly the same number of rows. I checked the Scala mirror against the DO block by hand. It matches on key order,
  judging each key on its original value, the shadow check against the evolving result (a JSON-null live key counts
  as absent), the three kind exemptions, string-only values for the three string keys, and nested
  `layout`/`sort` enum validity, where a missing or null nested key means drop.
- AC3: no journal rewrite and no migration. The diff touches no `db/migration` file.
- AC4 red-first: `exec-red.txt` shows both project-path lines naming this worktree. It fails at the first assertion
  with `{"keep":1,"metricLabel":"Revenue","metricUnit":"USD"} was not equal to {"keep":1,"label":"Revenue","unit":"USD"}`.
  That is the real defect, not a setup or compile failure.
- C1 (binding constraint) is honored. `PatchSetUndoDeadOutputKeysSpec` seeds 4 Outputs with dead keys through
  `insertInternal`, asserts the precondition, applies a real `pipelineStep` delete via `applySuccessfully` (so
  production code writes the journal), undoes it, and reads the configs back from `outputRepo.findConfigById`, not
  from the response.
- D1 enumeration checked independently. Grepping `insertInternal`/`RestorePriorStored`/`updateOwned`/`boundOutputs`/
  `outputService.` under `services/` finds exactly two captured-config Output write sites
  (PatchSetUndoService.scala:301 and PatchSetApplyRollback.scala:183). Both are routed through the normaliser.
- Spec delta: ADDED requirement on `patch-set-undo`, which exists in `openspec/specs/`. Its scenarios match the tests.
- **The HEL-1313 test edit is legitimate, and no spec delta MODIFY is needed.** The test is
  PatchSetApplyServiceSpec.scala:1163-1186. The binding requirement, `output-routes-api` "Output config writes reject
  unknown keys per kind", only exempts restores ("Restoring an Output's journaled prior config ... SHALL NOT be subject
  to this requirement"). It does not require a verbatim restore. The only rollback scenario,
  "Rollback restores a value the new rules reject", asserts that the scatter `chartType` plus `aggregation` come back.
  The edited assertion still checks this, since the expected value is `stored` minus `metricLabel` only. No canonical
  scenario asserts that a dead key survives a rollback. The "Stored legacy key does not block an update" scenarios are
  ValidateWrite-path and unchanged, and their tests are still green in the full run. Dropping a kind-inapplicable
  `metricLabel` on a chart is exactly what V117 does (`kind-inapplicable`). This edit is the direct, intended
  consequence of design D1(b) and the ticket's option (a), not a fixture masking a defect.
  The fixture state (a chart storing `metricLabel` after V117) is not reachable in production after this fix.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates (my own fresh runs, in WORKTREE_PATH; the change is backend-only and touches no `frontend/**`):
- `sbt testFull`, worktree-pinned per MISTAKES.md (`nice -n 19 sbt -batch -Dsbt.server.autostart=false testFull` run
  from the worktree's `backend/`). Both project-path lines name
  `/home/matt/Development/helio/.claude/worktrees/bug/undo-normalise-dead-output-keys/HEL-1409/backend`. Result:
  **6435 succeeded, 0 failed, 4 canceled, 462 suites, 0 aborted, exit 0.** The 4 canceled are the opt-in
  `HELIO_MEASURE=1` report-only perf probes plus one opt-in latency probe. They are pre-existing and unrelated. The new
  and edited tests ran and passed in the full suite: the parity spec, the unit spec, all 3
  `PatchSetUndoDeadOutputKeysSpec` cases, and the edited HEL-1313 rollback test. This closes the gap the executor left
  by not re-running the full suite after editing the HEL-1313 test.
- `npm run check:scala-quality` is clean (soft warnings only, none new over budget in the changed files).
  `check:openspec`, `check:spec-structure`, `check:test-temp-dir-hygiene` and `format:check` are all clean.

Parity mutation (`exec-parity-mutant.txt` / `exec-parity-green.txt`, both worktree-pinned): the mutant output shows
Scala carrying `"sort":"up"` where SQL drops it. So the mutation widened `nestedValid`'s timeline enum, which is the
value-validity guard, and the spec went red with row-level diffs (it hit both single-key and multi-key corpus rows).
The green re-run passes. The mutation exercises the guard it claims to.

Canonical code quality: there are no inline FQNs (imports are top-of-file) and no `any`-style escape hatches.
`LegacyOutputConfigKeys` is 82 lines, pure, with no dead code and no TODO/FIXME. The mapping is stated once in Scala,
with a header pointing at V117 and at the parity spec. The fixture change (exposing `accessChecker` as a protected
var) is minimal and needed to build an `OutputService` in the new spec.

### Phase 3: UI Review — N/A
No trigger paths changed: no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` (the only spec
file is the change-dir delta). There is no API shape change. The only effect a user could see is that a restored
label, unit, annotation, layout or sort renders again, which is a data-correctness outcome the backend tests cover.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `LegacyOutputConfigKeysParitySpec.scala:104-105,117,130`: the `Statement`/`ResultSet`s created inline are never
  closed. The connection is closed in `finally`, so there is no leak beyond the test. Wrapping them in `try/finally`,
  as `exec` already does, would be tidier.
- `PatchSetUndoDeadOutputKeysSpec`: the end-to-end undo test covers the metric rename, shadowing, the table
  drop/keep, and the timeline nested rename. A collection `layout` and a chart `annotation` row would round out the
  e2e set, though the unit and parity specs already cover both.
