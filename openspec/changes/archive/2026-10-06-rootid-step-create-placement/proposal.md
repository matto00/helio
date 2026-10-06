## Why

A trunk step created with `rootId` ignores `position` and is spliced in as the root's head. Since HEL-968 (v0.7.15,
2026-09-05) every pipeline-editor insert or append has therefore persisted the step at the head of root 0's chain,
while the editor showed it where the user put it. Pipelines run and render from the persisted chain, so the user's step
order is silently wrong after any reload or run. Agent `add_pipeline_step` calls naming a non-empty root were mostly
refused rather than misplaced: the tool sends `rejectIfReparents: true` by default, and the head-splice always
reparents. Only explicit `attachAsTail: false` calls were head-spliced.

## What Changes

- `POST /api/pipelines/:id/steps` with `rootId` and no `parentStepId` honours `position` as an index into THAT root's
  trunk (0 = before its first trunk step, trunk length = after its last), validated `0 <= position <= trunk length`
  (422 otherwise, nothing persisted). With no `position`, the step is appended as THAT root's trunk continuation
  (spliced onto the root's trunk-last step), never at the head. An empty root behaves as today.
- The `addStep` lane-reference pre-check resolves the same prospective parent the rootId placement will use, so its
  ancestor check is computed against the node the step is actually anchored to.
- The `rootId`/`position` documentation describes the real behaviour: the scaladoc on `CreatePipelineStepRequest`, the
  in-code comment in `persistNewStep`, the JSON Schema `schemas/pipelines/create-pipeline-step-request.schema.json`, and
  the helio-mcp `add_pipeline_step` tool description, which today says "rootId on a root that already has steps trips
  the guard".
- The HEL-1069 guard contract for a `rootId` anchor follows the new placement: with `rejectIfReparents`, a `rootId`
  append is refused only if that root's trunk-last step already has children (a tail lane), and a `rootId` create at
  `position` 0 on a non-empty root is still refused.
- Pipeline editor (HEL-1340 item 4): after a draft or immediate trunk create succeeds, the editor applies the server's
  reported change (the created step plus `reparentedStepIds`) to local state in one update. Steps the server reparented
  are therefore not stale on screen, the created step appears exactly once, other local-only steps and open cards are
  kept, and local config is never overwritten. This replaces the immediate paths' wholesale resync.
- Pipeline editor: an insert's position is resolved at create time from a persisted anchor step, not from the gap index
  stored at insert time. A draft completed after the trunk changed is therefore created (at the anchor, or appended if
  the anchor is gone) instead of looping on 422.
- Read-only production check for steps already misplaced by the defect, reported with counts; any repair is escalated
  for an owner ruling (no migration in this change).

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-steps-persistence`: the "appends a step against a parent or a root" requirement gains the placement rules
  for a `rootId` create (honour `position` within that root's trunk; append at that root's trunk tail).
- `pipeline-editor-page`: the insert-step requirement gains the post-create resync from the server's reported
  change (preserving local-only steps), and create-time position resolution from a persisted anchor.
- `mcp-pipeline-step-placement`: the "second same-root branch" scenario is restated for the new `rootId` anchor (that
  root's trunk-last step), so a `rootId` append onto a childless trunk tail succeeds.

## Impact

- Backend: `PipelineService.persistNewStep` / `addStep` lane pre-check, `PipelineStepProtocol.scala` scaladoc; new
  route tests in `PipelineStepRoutesSpec` (or a new spec extending `com.helio.testkit.HelioRouteTest`).
- Frontend: the create/draft path in `usePipelineDetailPage.ts`, or `usePipelineStepCreation.ts` if HEL-1340's
  extraction has merged; RTL tests; HEL-1340's `PipelineDetailPage.draftCreate.test.tsx` fixture that encodes today's
  head-splice placement (updated with a stated reason).
- API behaviour change for `rootId` + `position` / `rootId`-only creates: the step now lands where the request says.
  helio-mcp `add_pipeline_step` with `rootId` (no `position` parameter exists in the tool) now appends at that root's
  trunk tail instead of being refused by the guard. One existing backend test
  (`PipelineStepReparentRoutesSpec`, "422 for a rootId anchor that already has root-level steps") encodes the old
  behaviour and is updated with the reason.
- helio-mcp: `helio-mcp/src/tools/write.ts` description text only (no package files; HEL-1297/HEL-1348 are running
  there).
- Data: existing pipelines may already hold head-spliced steps; repair is out of scope pending an owner ruling.
