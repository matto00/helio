## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD a27a2d04dcfef52ccc84a9db4721b5a4b3c97e2f against live-resolved base 83e5655e4913d716e51e4f51919a567f058bac52 (origin/main).

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (red first on `helio_app_test`): commit 568275715 contains only the new spec, `red-run.txt` and planning artifacts. There is no main-source change in it (`git show --stat`). The red run shows 6/8 failing with `Right(...restored...)`, which is the undo-succeeds path. The `pipelineStep` case was refused only by the HEL-1795 later-Output blocker, and the rule clause was missing from its message. The red run records this honestly. Between the red commit and the fix, the 294 red-run lines of the spec are unchanged; the fix commit only appends tests (`git diff 568275715 a27a2d04d`). The spec asserts `rolbypassrls = false`.
- AC2 (409, nothing changes, HEL-1720 naming): the tests check for `Conflict`, that the rule, Output, pipeline, schedule and roots still exist, and that the message has no rule, output, pipeline or source id. An owned rule is named. A rule owned by another user is counted ("you do not own"). The editor's root is counted, and B's source name is absent.
- "Also check" schedules and extra roots: both are covered (pipeline arm only). Runs, history and insights stay out of scope, as the ticket says.
- Tasks 1.1-3.4 are all ticked and match the diff. The spec delta matches the behavior.
- CONSTRAINTS C1-C10 are honored. `PatchSetUndoService` has a one-line change (C10), the new checks extend `PatchSetUndoLaterChildren` and `PatchSetUndoBoundPanels` (no parallel mechanism), and DB runs used helio_hel1811.

### Phase 2: Code Review — PASS
Gates I re-ran myself (backend-only change, so the frontend gates do not apply; `nice -n 19`, `-J-Xmx3g`, `DATABASE_URL=helio_hel1811`):
- `check:scala-quality` clean (soft size warnings only). `check:openspec`, `check:spec-structure`, `format:check`, `check:no-credential-leak` and `check:repo-integrity` all exit 0.
- sbt shard 1, `PatchSetUndo*` (services + routes): 18 suites, 136 tests, 0 failed.
- sbt shard 2, `*PatchSetApply*`, `*DraftUndo*` (incl. `DraftUndoPanelNamingSpec`, which covers the shared alert-rule clause), DraftSave Undo/RootsUndo/Rls/Api, `OutputRepositoryRequiredSpec`, `PipelineRootWriteGrantsSpec`: 17 suites, 164 tests, 0 failed.
- sbt shard 3, `*AlertRule*`, PipelineSchedule service/repo, `*PipelineRoot*`, `*OutputRepository*`, `PipelineRepositorySpec`, `DraftSaveRootsUndoSpec`: 13 suites, 155 tests, 0 failed.
- I did not run the full `sbt testFull` in one call, because it does not fit the 600 s tool window (C5 prescribes shards). The shards cover every caller of the changed APIs: `deleteIfUnboundInternal` (PatchSetUndoService + PatchSetUndoLaneSpec), `JournaledCreatedChildren` and the DraftRestore clause. `testOnly` compiled the whole test tree.

Checks:
- DraftRestore output is byte-identical. `alertRuleClause` is the removed expression moved verbatim (same partition, same `ruleNames`, same "and" joining, same `.filter(_.nonEmpty)`), and the input is still sorted by id. `DraftUndoPanelNamingSpec`'s rule-naming tests pass unchanged.
- `PatchSetUndoService` change is minimal: only the `Left((panels, rules))` match arm at line 147. Phase 2 of the pipeline and step arms picks up the new kinds through the extended `Later.isEmpty`/`size` in the existing `ifStillUnbound`.
- `output` arm Phase 2: `deleteIfUnboundInternal` counts `alert_rules` inside the locked transaction. Its `Left` carries panels and rules separately, and `outputBoundDuringUndo` never reports rules under the panel phrase. The skeptic-design note is adopted.
- No ids in messages or new INFO+ logs. `addedDuringUndo` and `outputBoundDuringUndo` are counts only. Tests assert that ids are absent from both the 409 message and the ERROR log.
- Legacy journal compatibility: `rootIds: Option[...] = None` with `jsonFormat3`. A test proves an old-shape row decodes to `None`.
- Mutations: I inspected the scratch harness `mut.py`. Its six text substitutions are the six design-D6 mutations, each a real behavior removal, and each recorded red in `mutations-run.txt`. I did not re-execute them, because the read-only evaluator role forbids editing the worktree.
- REST, helio-mcp and toast wording all still hold. `PatchSetUndoRoutesSpec` adds a 409 test that names the rule and is not `PATCH_SET_STALE`. helio-mcp's `undo_patch_set` says "the whole undo is refused and nothing is touched", which is still accurate. `PatchSetReviewPage` shows the server rejection string, so no client change is needed. `createdChildren` is not in any schema, client or MCP surface.

### Phase 3: UI Review — N/A
The change is backend-only. No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or canonical `openspec/specs/**` file changed; the spec delta is under `openspec/changes/`. The response shape is unchanged.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `PatchSetUndoLaterChildren.describeRoot` names a root only when the undoing user OWNS the source (`findByIdOwned`). The code doc says "there is no sharing-aware by-id read". However, `ApiRoutes.scala:303` registers a `data-source` ACL resource type, so a source shared to the undoing user would be counted rather than named. This is the conservative direction and the delta's "only when" wording allows it. Consider rewording the doc so it does not claim more than it checked.
- `PatchSetUndoBoundPanels.doomedOutputIds` (lines ~101-103) uses irregular arrow alignment, and `PatchSetApplyService`'s capture-failure WARN still says "steps and Outputs" although it now also captures roots. Both are cosmetic.
- `DraftRestore` sorts `ruleRows` and `alertRuleClause` sorts again. This is harmless.
