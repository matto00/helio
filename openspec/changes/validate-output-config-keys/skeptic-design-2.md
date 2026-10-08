## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed against worktree HEAD 55b7c4269d90eea7f3c71f3a2e3857a4018ee47b (the change dir is untracked; this is planning only).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/output-config-key-validation/hel-1313`.

### What I verified (with evidence)

**Round-1 CR1 (rollback restoring a rejected value): resolved.**
- `PatchSetApplyRollback.scala` L180-181 re-sends `priorConfig` through `outputService.update`. D9 adds an internal `restoring` flag that only rollback passes.
- Reachability: `OutputRoutes.scala` L98 calls `update(outputId, req, user)`, and `PatchSetApplyForward.scala` L105 calls `update(id, request, user)`. Neither path can set a defaulted 4th parameter, and helio-mcp only reaches the backend through HTTP. So the flag is not reachable from a route.
- `PatchSetUndoService.restoreOne` (L105-122) has no `("output","update")` case, so undo never re-validates Output config. Its only Output write is the raw `insertInternal` at L297. D9's comment-only handling is correct.
- The Risks bullet is corrected. Task 4.4 now names the scatter→bar→rollback case, and a spec scenario was added.

**Round-1 CR3 (editor error message): resolved.**
- `OutputEditorSheet.tsx` L355-356 sets a fixed `"Failed to save output."`.
- `outputsSlice.ts` L151/L163 `rejectWithValue(extractErrorMessage(...))`, and `.unwrap()` throws that value. So D7's revised claim is accurate.
- Task 2.1 and task 4.5 cover the fix.

**Round-1 CR2 (metric aggregation shape): only partly resolved, and the revision introduced a new problem.** The accepted shapes now match the readers:
- `OutputSummaryReducer.metricField` L90-93 takes `fieldMapping.value` first, then `aggregation.value`, with `agg` read independently.
- `MetricOutputPanel.tsx` uses `resolveServerMetricField`.
- `buildOutputConfig.ts` metric branch: with an agg selected it emits `aggregation: {value, agg}` and a `fieldMapping` without `value`. With no agg it emits `fieldMapping.value` and `aggregation: null`. Because PATCH is a shallow merge, `fieldMapping` is replaced wholesale. The editor therefore never produces a field conflict.
- e2e fixtures (`hel1275` L133-135, `hel1331` L45) send `{fieldMapping:{}, aggregation:{value,agg}}`, which is accepted.
- `FirstRunPlanner` (L71, L129-130) and `PersonaTemplates` write no metric Outputs. Their chart types are `bar`/`line` only (5 bar, 3 line), so they pass the chartType enum.

The problem is the gating of the new field-resolution rule (CR1 below).

**Live writers vs the key set and chartType enum: no rejection found.**
- `frontend/src/utils/chartAppearance.ts` L4 has `ChartType = "bar"|"line"|"pie"|"scatter"`.
- Editor keys are all in the per-kind sets.
- Shape output expansions are dormant: the backend has no producer.
- Dashboard-proposal panel `aggregation`/`fieldMapping` (`DashboardProposalProtocol` L117/L142, `AssistantProposalToolSchemas` L73/L120) is panel wire shape. No code writes it into Output config (grep `\.aggregation` in backend main).

**D10 null-clear vs shallow merge.** `OutputService.mergeConfig` (L485-493) is `existing ++ patch`, so `{"metricLabel": null}` persists as a stored JSON `null`. It does not delete the key. `OutputRepository.updateOwned` (L253-276) writes the merged object verbatim. That is consistent with the existing contract text "an explicit `null` clears it" (`openspec/specs/output-routes-api/spec.md` L251). It is also self-consistent under D3: re-sending `null` later equals the stored `JsNull`, so the write is accepted. But the plan never says which meaning "cleared" has (see CR2).

### Verdict: REFUTE

### Change Requests

1. **Narrow the scope of the metric "must resolve a field" rule, or it rejects a config the in-app editor produces today.**
   - The rule appears in spec delta `output-routes-api` ("A metric Output's resulting config SHALL name its field via `fieldMapping.value` or `aggregation.value` ...") and in design D5 ("For a metric the resulting config must resolve a field"). Neither text conditions it on a non-null aggregation, and the requirement says the check runs "always on create".
   - What the editor sends today: `OutputEditorSheet.handleSave` has no field gating (Save is only `disabled={saving}`, L442-471). `buildOutputConfig` sends `{fieldMapping: {}, aggregation: null, format: null, compare: null}` for a metric saved before a field is picked.
   - Under the natural reading of the spec text, that save becomes a 400. The same goes for an MCP `add_output` metric with only a label mapping.
   - It would also change which error the existing HEL-892 test sees: `OutputRoutesSpec` L240-248 (metric `{fieldMapping:{bogusSlot}}` must name `bogusSlot`). That invites a fixture edit.
   - A metric that "resolves to no field" is a deliberately supported state (HEL-1326: `metric: null`, pinned by `OutputFilteredMetricRoutesSpec` L154-158). Rejecting it is scope beyond the ticket, which concerns keys and aggregation.
   - Required changes:
     - (a) In D5 and the spec requirement, state that the field-resolution and field-equality checks apply only when the write sets a non-null metric `aggregation`.
     - (b) Add a spec scenario and a task 4.1/4.2 case: a metric created with `{fieldMapping: {}, aggregation: null}` succeeds, and a metric created with `{fieldMapping: {label: "x"}}` succeeds.
     - (c) Keep the existing "`{agg}` with no field → 400" scenario.

2. **Say what D10's "clears the key" means, and pin the test to it.**
   - Under the unchanged shallow `mergeConfig`, a `null` write stores JSON `null`. It does not remove the key. Task 4.2 ("a null clear") and the spec scenario ("the key is cleared") can be read either way.
   - An implementer who asserts the key is absent would have to change `mergeConfig` to drop nulls. That silently alters the PATCH contract for every key: a known key like `aggregation`/`compare` would then be deleted rather than nulled. Nothing in the plan scopes that.
   - Required change: state in D10 and the spec that clearing persists the key as JSON `null` (mergeConfig unchanged), that GET returns `"metricLabel": null`, and that re-sending that `null` is accepted as unchanged. Make the 4.2 assertion check that exact stored value.

### Non-blocking notes
- `OutputRoutesSpec` L291-297 (HEL-946 "returns the config the request body carried") creates a chart with `legend: {show: true}`. Under the new contract it will 400, and its fixture must move to a known key. That change is legitimate, but task 1.6 only names the HEL-877 legend/tooltip tests. List this one too, so a reviewer does not read the edit as a fixture-to-pass symptom.
- D9: prefer a separate internal method (or a sealed write-policy argument, mirroring `DashboardService`'s `LayoutWritePolicy.RestorePriorStored` used by rollback L103) over a defaulted Boolean. Either way, add a test that a route PATCH with the scatter+aggregation value still 400s, so the bypass is shown to be rollback-only.
- Under the "validate only when the written value differs" gating, a PATCH that changes only `fieldMapping.value` can leave a stored conflicting `aggregation.value` unchecked. This is an acceptable trade-off, but worth one line in Risks.
- helio-news `build.py` was still not inspected (disclosed in Risks). Note it in the PR body for the owner.
