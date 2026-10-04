## Skeptic Report — final gate (round 1, skeptic-final-1.md)
Reviewed head: 5dff25bcc2196ed777f060be29dd7b41a12a30eb

### What I verified (with evidence)
- Diff vs live base ea57dac8: no migration, nothing under layout/CommandBar/PanelGrid/useLayoutSave, features/sources/**, DataSourceReferenceRepository. Only backend change is dropping `authorable=false` from JoinStep.
- AC1/2: running app (cwd of 6390/9297 processes verified as this worktree): "Join tables" in palette, POST 201, editor shows Right source (SecondaryInputPicker), Join key select, INNER/LEFT only.
- AC3: persisted step config via GET = exactly {joinKey, joinType, secondaryInput}. No persist on mount: seeded joinType "outer" + joinKey "zzz" via PATCH, reloaded in dark theme; editor showed "zzz (not in input)", INNER/LEFT both unpressed with an alert, and step updatedAt unchanged after load. Lane-ref display covered by JoinConfig.test.tsx:99 ("stored lane reference is shown, not replaced"); I did not exercise a stored lane live.
- AC4: JOIN_OP_TYPE and special case gone, comment rewritten (diff).
- AC5 seam reds, my own, assertion-level for every leg:
  - Frontend: cast mutation `join_key` in onJoinChange (as never) -> JoinConfig.seam 2/2 FAIL on `toEqual` (not TS2353). Reverted.
  - Backend: renamed `joinKey`->`join_key` in shared fixture -> JoinStepConfigSeamSpec 2/3 FAIL (decode key-not-found; POST/GET round-trip mismatch). Reverted (git status clean).
  - helio-mcp: evaluator-reproduced fixture-rename red; the leg is a description-text check (weaker than the other two but honest about it, and the tool is a passthrough). Passes now 3/3.
- AC6: built the join through the UI between two real static sources, clicked "Run pipeline": output rows {id1,ann,10,right_name ANN,Oslo},{id2,bob,20,right_name BOB,Rome}, total 2 (unmatched dropped). Output creation was via API (UI Output flow not part of this change). Both themes inspected (light configured; dark with honest-display state); sibling Lookup compared in light: same uppercase labels, Select, spacing. Join type row reuses the existing filter-combinator pattern. No hardcoded values/new CSS. Evidence: .concertino/runs/HEL-958/evidence/skeptic-join-light.png, skeptic-join-lookup-light.png, skeptic-join-honest-dark.png. Only console error is the usual 404 on pipeline /schedule.
- Fallback moves: provenance tests moved join->groupby (still absent from OP_TYPES, asserts "Groupby" humanised; would fail if groupby were registered); StepCard repointed to synthetic noeditor op with the same assertions. Not vacuous.
- Gates: lint 0 warnings, typecheck, format:check clean; frontend pipelines+panels 188 suites/2142 tests pass; root jest joinStepSeam 3/3; `nice -n 19 sbt testFull`: 5600 run, 1 failed (ApiRoutesPipelineRunGuardSpec rate-limit timing test), rerun with JoinStepConfigSeamSpec 7/7 pass. sbt shut down separately.
- Cleanup: deleted my output, pipeline, 2 sources by id; deleted my user f03e0374-... and its pipeline_run_rate_window row in psql. Worktree git status clean (only the evaluator's untracked report). Scratch evidence PNGs left under .concertino/runs.

### Verdict: CONFIRM

### Non-blocking notes
- ApiRoutesPipelineRunGuardSpec SOURCE_FETCH rate-limit test flaked once under load; passes on rerun (same timing-flake class).
- MCP seam leg checks the tool description text only; acceptable given passthrough.
- Dark focus strip on card header is pre-existing (also on Lookup).
- e2e spec leaves a registered user/sources in the dev DB.
