## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `6d74aeaf4d06a32ed39e563a887d15b816b16d9b` against live base `13180246ad2ab41bfed697e422ff419321d9df78`.

### Phase 1: Spec Review — FAIL

The production code matches the restated scope and design D1-D5:
- `DraftRestore` created-Outputs refusal names readable panels via the extracted
  `PatchSetUndoBoundPanels.describeBlocking`. Alert rules are named only through `findVisibleAlertRuleIds`, the rest are
  counted, and no ids appear.
- The removed-Outputs refusal is count-only.
- The `cascadeGate` Restore branch is count-only.
- The combined message has one prefix and one suffix.
- `PatchSetUndoService` is untouched. `blocker`'s text is unchanged (HEL-1720 specs green).
- No client change. C16 is honored (no HEL-1697/HEL-1793 files).
- Red commit `2c30e2577` (spec only; 5 red, 1 labelled guard) precedes implementation commit `94fdbb543`. The only change
  the implementation commit makes to the spec is the `DraftRestore` constructor argument (DraftUndoPanelNamingSpec.scala:136),
  which is required for compilation.

Issues:
1. **D6 divergence: test fixtures bypass services the design required wherever they can be reached.** D6 asks for a real
   `AlertRuleService.create` for case (e), and allows a labelled direct insert for (f) only "if (f) proves unreachable
   through services". It allows a direct grant-row delete for P3 only "if revocation through a service proves impossible
   in the harness". Neither condition holds:
   - `AlertRuleService.create` is reachable. Construct it with `new AlertRuleService(new AlertRuleRepository(appCtx), appOutRepo)`.
     It needs only `condition = {"comparator": ">", "threshold": 1}`. The spec instead inserts rows with
     `condition '{}'` (DraftUndoPanelNamingSpec.scala:206-211), which the service would reject. The justification comment
     at :299 ("would need a fully-formed metric/condition") does not hold up.
   - For case (f), the service call is the only thing that proves the scenario is real. `create` requires
     `outputRepo.findByIdOwned(O, A)`, so it shows that A really owns an Output that editor B's save created. The comment
     at :315 asserts that equivalence without testing it.
   - `PermissionService.revoke(dashboardId, granteeId, user)` exists (`services/auth/PermissionService.scala:53`). Its
     two constructor arguments (`permRepo`, `checker`) are already built in this spec's `beforeAll` (:90, :100). The
     comment at :267-268 ("the harness has no sharing service") is false.
2. Task 3.3 is marked `[x]` with "then sbt testFull shards", but the executor's scratch `green-2.log` covers 123 suites
   (one shard), not the full suite. My own full run (below) is green, so no change is needed for this. Note it so the
   checkbox matches what was actually run.

### Phase 2: Code Review — FAIL

Gates, run fresh by me in `WORKTREE_PATH` (backend-only diff; `nice -n 19`, `SBT_OPTS=-J-Xmx3g`, `ANTHROPIC_API_KEY`
empty, embedded Postgres):
- Targeted run: `testOnly DraftUndoPanelNamingSpec DraftSaveUndoSpec DraftSaveRootsUndoSpec *PatchSetUndo* *DraftSave*`.
  27 suites, 375 tests, 0 failed. The hel1468 guard reported failed=0 aborted=0 unreadable=0.
  Log: `/home/matt/Development/helio/.concertino/scratch/HEL-1792/eval-targeted.log`.
- Full `sbt testFull` in 8 shards (`HELIO_TEST_SHARD_COUNT=8`, index 0-7): 754 suites, 0 failed, 0 aborted in every
  shard, each guard summary failed=0. There were 5 cancels, all opt-in `HELIO_MEASURE` measurements (RunPathHeapSpec,
  DatasetWriteSubmitLatencySpec, OutputFilteredMetricMeasurementSpec). Logs: `.../scratch/HEL-1792/eval-shard{0..7}of8.log`.
  Shards were needed: one shard took 94-315 s, so the full suite in one call would risk the tool timeout.
- `npm run check:scala-quality`: clean. It reports only pre-existing soft warnings.
- The red-run and mutation logs in the executor's scratch match `red-run.md`:
  - M1 (id list) turns cases a and c red.
  - M3 (name every rule) turns case f red.
  - M4 (internal reads) turns case a red.
  - M2 (pre-check dropped): every created-Output case becomes `PatchSetStale`, whose message has the pipeline id but no
    panel id. The design predicted exactly this.

Issues:
1. **Inline FQN (CONTRIBUTING.md "Imports & Qualifiers", [mechanical])**: DraftUndoPanelNamingSpec.scala:231
   `LoggerFactory.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME)`. The checker missed it, but the rule applies.
2. **Dead code**: DraftUndoPanelNamingSpec.scala:101 (`fs`), :92 (`stepRepo`) and :107
   (`require(fs != null && stepRepo != null)`) exist only to silence unused warnings. The comment at :106 refers to
   `dsService / pipelineService below` that `beforeAll` never builds.
3. Production code: no defects found. DRY is good (one naming helper, `blocker` delegates to it). There is no type
   escape hatch. Logs are covered by the spec's root `ListAppender` assertion (D5).

### Phase 3: UI Review — N/A

No `frontend/**`, `schemas/**` or `openspec/specs/**` change. The `ApiRoutes.scala` change only adds a constructor
argument (`dashboardRepo` to `DraftRestore`): no route, contract or status change. The 409 text the draft-undo toast
shows does change, but the ticket says no client change is needed (the toast shows the server message verbatim). The
skeptic may want to look at the rendered toast copy.

### Overall: FAIL

### Change Requests
1. DraftUndoPanelNamingSpec.scala, cases (e) and (f) (:296-326): create the alert rules with a real `AlertRuleService`
   as the Output owner A instead of `insertRule`:
   - Construct it in `beforeAll` with `new AlertRuleService(new AlertRuleRepository(appCtx), appOutRepo)`.
   - Use `CreateAlertRuleRequest(name, metric = "m", condition = {"comparator":">","threshold":1}, severity = "warning", targetOutputId = O)`.
   - Assert the call returns `Right` (in (f) this proves A owns the Output that B's save created).
   - Remove the comments at :299 and :315.
   - Keep `insertRule` only where no service path exists. Case (b) and case (c) seed a rule on the pre-existing
     `tableOutputId`; there, too, the service is reachable for its owner. Either switch them or say in a comment why
     a raw row is used.
   - Re-run mutation M3 against the service-created rule and record that case (f) still goes red.
2. DraftUndoPanelNamingSpec.scala:267-272: revoke A's grant on E with
   `new PermissionService(permRepo, checker).revoke(e.id.value, owner.id, otherUser)` and assert `Right(())`. Delete
   the raw `DELETE FROM resource_permissions` and the false "harness has no sharing service" comment.
3. DraftUndoPanelNamingSpec.scala:231: import `org.slf4j.{Logger => Slf4jLogger}` at the top (as DraftPreviewCapsSpec
   does) and use `Slf4jLogger.ROOT_LOGGER_NAME`.
4. DraftUndoPanelNamingSpec.scala:92, :101, :106-107: remove the unused `stepRepo` and `fs`, the `require`, and the stale
   comment. CR2 reuses `permRepo`/`checker`, which are kept.
5. Re-run DraftUndoPanelNamingSpec and DraftSaveUndoSpec after the changes, and put the real scope of the gate runs in
   tasks.md 3.3.

### Non-blocking Suggestions
- DraftRestore.scala, combined message: the `". "` joiner gives "...cannot recreate them. this save created..."
  (lowercase after a period). Consider capitalising the second clause or joining with "; ".
- When every created-Output panel is unreadable, the panel clause reads "1 panel(s) (and 1 panel(s) on dashboards you
  cannot see)". The leading "and" comes from `describeBlocking`'s HEL-1720 wording. This is acceptable, but a lead-in
  that drops "and" when nothing was named would read better.
- DraftUndoPanelNamingSpec.scala is 402 lines, past the ~400 propose-a-split threshold. Removing the dead code may bring
  it under. The ACL registry is also built twice (:94-99 and :120-127); reusing one builder would shorten it further.
- The executor's mutation logs are only in scratch. `red-run.md` says "evidence copy persisted", but
  `.concertino/runs/HEL-1792/evidence/` holds no red or mutation logs. Persist them with `persist-evidence.sh`.
