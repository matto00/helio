## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `1b091affdf7ebf6a1de3d848a4fb2192408126ea`. The review base was resolved live with
`resolve-review-base.sh`: `55b53be4a305ec0fbd3fd44c1f137e97ad24a5c1`, which equals `origin/main` after a fresh fetch and
equals `git merge-base HEAD origin/main`. `origin/main` is an ancestor of HEAD. This is a cold re-evaluation: the cycle-1
evaluator died in a power loss. Every claim below comes from my own runs; I did not rely on the executor's reports.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1: the split is in place. `PatchSetApplyResolvers.scala` (233 lines) keeps `resolveAll`, `resolveEdit` (dispatch) and the
  four dashboard resolvers. It also holds a second top-level object, `PatchSetResolverSupport`, with five shared helpers.
  There are five new `private[patchsets]` objects: Panel (131 lines), DataSource (77), Pipeline (142), PipelineStep (264) and
  Output (85). The layout matches design.md D1/D2.
- AC2: I re-ran the move checker against BASE 55b53be4a, and it passes. I also regenerated both the six files and `spec.json`
  from BASE with `gen.py` in my scratchpad. The output is byte-identical to the committed source files and to the committed
  `spec.json`. I listed every scaffold line in the spec by hand. Each one is a package line, an import, a one-line object doc,
  an object header or closing brace, or a named member import. There are no wildcard member imports. The 19 visibility
  substitutions are exactly the declarations D2 names (5 Support helpers and 14 dispatched resolvers). I ran three red runs
  of my own on scratch copies, each different from the executor's:
  (r1) put the pre-HEL-1480 text back on line :178 in the moved block. The forward check fails at
  `PatchSetPipelineStepResolvers.scala:22`.
  (r2) added a stray `import scala.util.Try`. The reverse check fails.
  (r3) widened `rejectUnboundOrBadlyBoundForm`, which D2 does not allow. The check fails with a base-line-319 mismatch.
- AC3: the filtered `javap -public` diff is empty. I ran `javap.sh` myself on freshly compiled AFTER classes: the raw output
  is byte-identical to the committed `javap-after.raw`, and the filtered diff against `javap-base.filtered` is empty. The BASE
  scratch worktree had been removed, so I could not recompile BASE. Instead I checked BASE at the source level: every member
  of the BASE object except `resolveAll` is `private def`, and private members get no forwarders. So the filtered BASE
  surface can only be `resolveAll`, `MODULE$` and the static initializer, which is what `javap-base.filtered` records.
  `PatchSetResolverSupport` and `PatchSetPanelResolvers` show no public static forwarders.
- AC4: I re-extracted per-suite counts with `suites.py` from `sbt-base3.log` and `sbt-after3.log`. The two are identical
  (485 suites) and match the committed `.tsv` files. Both logs report `Tests: succeeded 6666, failed 0, canceled 4`, both
  contain `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, and both exit with 0. The BASE log's project
  path is the scratch worktree at 55b53be4a. The AFTER log's path is this worktree. The AFTER run was at `fb5b09ef2`, and
  `fb5b09ef2..HEAD` touches only evidence files under `openspec/changes/`.
- AC5 (M1-M6) is recorded in `mutation-evidence.md`. I spot-checked it through the gate mutations below.
- AC6: I re-ran the guard probes myself, using variants different from the executor's, all in one run of
  `ExistenceNotLeakedRoutesSpec` and reverted afterwards:
  (G1') a `ServiceError.Forbidden()` producer in `PatchSetPipelineResolvers` makes the producer-count test fail, and the
  actual map contains `"PatchSetPipelineResolvers.scala" -> 1`.
  (G3') a non-`def` `c.accessChecker.requireAccess(` line in `PatchSetDataSourceResolvers` makes the helper-site test fail
  with `HashSet("PatchSetDataSourceResolvers.scala") was not empty`.
  (G4') a `case ("dataSource", "rename")` dispatch line makes the dispatch-coverage test fail with
  `HashSet("dataSource:rename") was not empty`.
  Result: 58 passed, 3 failed, and exactly these three tests failed.
- AC7: the D6c inline-FQN scan finds nothing. No defects were fixed in this change; follow-up candidates 1-9 are recorded
  in `move-evidence.md`.
- The tasks.md items are all ticked and match the evidence. The diff stays within ticket scope (6 Scala files and README
  under `services/patchsets`, plus the change dir).
- CONSTRAINTS C1-C5 are all honoured.
  - C1: `git diff origin/main HEAD -- backend/src/test` is empty, and so is the diff from the BASE merge-base. Per-suite
    counts are equal.
  - C2: I ran `grep-guards.sh` with `BASE=55b53be4a`. The kept file has 4 producer code lines and 2 `requireAccess(` code
    lines. Both the kept file and BASE have 18 dispatch lines. No new file has a producer or a helper call.
  - C3 and C4 are covered by the move checker, including comment lines.
  - C5 is covered by the javap check above.
- D7 merge resolution: `46c0ba9b4` resolved the conflict by dropping the moved block from the kept file
  (`git show --remerge-diff`). HEL-1480's line :178 ("the config branch of `PipelineStepWrites.updateStep` and
  `PipelineStepCreate.addStepReporting`") is at `PatchSetPipelineStepResolvers.scala:22-23` and has not been reverted. The
  old `PipelineService.scala:568-597` text appears nowhere in the package. The forward check against 55b53be4a confirms
  this byte for byte, and my red run r1 proves the check would catch a revert.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates I ran myself, all in WORKTREE_PATH:
- `npm run check:scala-quality`: exit 0. The result is "clean", with soft size warnings only.
  `PatchSetPipelineStepResolvers.scala` is over the soft budget, which design.md Risks accepts.
- `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.api.http.ExistenceNotLeakedRoutesSpec com.helio.services.patchsets.*"` on the
  clean tree: 207 succeeded, 0 failed, exit 0. There are no compiler warnings for the package, so no unused imports from the
  pruning.
- I did not run a full `testFull`. The orchestrator limited sbt to targeted runs, and the recorded per-suite logs were
  verified above.

Spot-checks of the foreign-id gate mutations, applied with my own edits (same intent as `gate-mutate.py`) in one run of
`ExistenceNotLeakedRoutesSpec`, then reverted:
- N2: `PatchSetPanelResolvers` `panelRepo.findById(panelId, Some(user))` changed to `findByIdInternal(panelId)` in 2 places.
  `apply: panel update` and `apply: panel delete` both fail.
- N3: in `PatchSetResolverSupport.requireVisibleStep`, the invisible-pipeline `NotFound` was changed to `Right(())`. Four
  rows fail: `apply: pipelineStep update`, `apply: pipelineStep delete`, `preview: pipelineStep update` and
  `preview: pipelineStep delete`.
- Result: 55 passed, 6 failed, and exactly these six named rows failed, as `mutation-evidence.md` claims.

After all the scratch runs, I restored the sources from backups. `git status --short` is empty, the move checker passes
again on the real files, and no sbt process or server is left running.

Code quality:
- No inline FQNs.
- Member imports are named, not wildcards, and none of them is receiver-qualified.
- Moved bodies are byte-identical, so there are no drive-by behaviour changes.
- The objects are stateless, with no wiring or initialisation order.
- No dead code was added.
- No `private` was widened beyond what design D2 declares.

Commit messages:
- `674fbf879`, `fb5b09ef2` and `1b091affd` carry only a `Co-Authored-By` trailer.
- The two merge commits have no body.
- `grep -iE 'claude\.ai|Claude-Session|session'` over `55b53be4a..HEAD` finds nothing.

### Phase 3: UI Review — N/A
No changed file matches `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `grep-guards.sh` does not fail when `BASE` is unset. `git show $BASE:<path>` turns into `git show :<path>`, the index
  version, which silently prints a plausible "BASE dispatch lines: 18". The committed evidence was generated with `BASE`
  set (its header says `BASE=55b53be4a`), so this does not affect the verdict. If the script is ever reused, add
  `: "${BASE:?}"` at the top.
- `suites.py` reports `canceled` 0 per suite, but the sbt summary shows `canceled 4`. Those 4 tests are still counted in the
  TOTAL column (6670 = 6666 + 4), so the BASE/AFTER comparison is still valid. The canceled-suffix match is cosmetic.
- The stale `PipelineService.*` citations inside moved comments, such as the `authorizeEditorOrOwnerOnPipeline` doc, are
  correctly left alone under C4. They are already recorded as follow-up candidate 8 and should get their own comment-sweep
  ticket.
