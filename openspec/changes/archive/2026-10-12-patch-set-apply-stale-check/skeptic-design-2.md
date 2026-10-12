## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `e4ef70c31f7c16d9687a199feae997dce0217455` (= origin/main; the planning artifacts are untracked).
cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/patch-set-apply-stale-check/HEL-1458`.

### What I verified (with evidence)

**Round-1 CR1 (the assistant tool schema): resolved.**
- `scripts/check-schema-drift.mjs:727-730` compares `EditTargetSchema` with `$defs.EditTarget` strictly, in both
  directions. `KNOWN_PRE_EXISTING_DRIFT` is an empty `Map([])`.
- D5 and task 2.6 now add `fingerprint` to `AssistantProposalToolSchemas.EditTargetSchema`
  (AssistantProposalToolSchemas.scala:368), with a description saying the server assigns it and discards any value sent.
- `AssistantToolExecutor.executeProposePatchSet` (AssistantToolExecutor.scala:317-333) runs `decode[PatchSet]`, then
  `preview`. D5 strips model-emitted fingerprints before that preview.
- D3 puts the create+fingerprint 400 "at resolution time", not in the reader. So strip-after-decode works for both
  producers (`RefinementParsing.parsePatchSet` followed by preview, and `decode` followed by preview).

**Round-1 CR2 (output delete config): resolved.**
- `resolveOutputDelete` (PatchSetOutputResolvers.scala:63-84) reads only `findOwnedOutput`.
- The D2 table now says that output delete makes the same `findConfigById` read the update resolver makes (line 46),
  and uses it only for the fingerprint. D2's "no second read" claim now names this as its one exception.

**Round-1 CR3 (the per-kind field table): resolved.**
- The D2 table is filled in, and I checked it against each request class:

  | Request class | Location | Fields |
  | --- | --- | --- |
  | `UpdatePanelRequest` | PanelProtocol.scala:89 | title, appearance, type, config |
  | `UpdateDashboardRequest` | DashboardProtocol.scala:59 | name, appearance, layout |
  | `UpdateDataSourceRequest` | DataSourceProtocol.scala:158 | name |
  | `UpdatePipelineRequest` | PipelineProtocol.scala:85 | name |
  | `UpdatePipelineStepRequest` | PipelineStepProtocol.scala:233 | type, config, position, enabled |
  | `UpdateOutputRequest` | OutputProtocol.scala:94 | name, config |

- The panel row includes `type`.
- `expectedLayoutVersion` is excluded explicitly because it is a request-only precondition.
- The dataSource/pipeline name-only delete limitation is written into D2 as OWNER REVIEW.
- The spec requirement now says "(for dataSource and pipeline: `name` only)".
- I checked that the domain objects carry these fields:
  - `Dashboard`: name/appearance/layout, model.scala:228.
  - `PipelineStep`: position/enabled/kind, PipelineStep.scala:39.
  - `Panel`: title/appearance/kind, with config via `PanelResponse.fromDomain`, the same projection
    `PatchSetUndoConflictCheck.checkPanel` uses.
- I checked that the HEL-1503 drift baseline is not stored in step config. It lives in the run repository, so a run
  cannot change a step fingerprint.

**Round-1 CR4 (stale targets reaching MCP callers): resolved.**
- `HttpClient.describeError` (httpClient.ts:398-406) returns `${status} ${statusText}: ${body.message}`.
- D4 now has the server's `message` name every stale `edit <index> (<kind> <id>)`.
- Task 4.1 asserts that this text reaches the tool error.
- helio-mcp `editTargetSchema` (refinementSchemas.ts:25) is a plain `z.object`, which strips unknown keys. D7 and task
  4.1 add `fingerprint`.

**Fresh review of the rest of the plan:**
- **Check placement.** `PatchSetApplyService.apply` (lines 78-82) runs `resolveAll` and then `applyResolved`. A check
  between them runs after authorization and before the first `applyOne`. Its failure is a plain `Left`, so the route
  maps it to an HTTP error. `ResolvedEdit.index` maps back to `patchSet.edits(index).target`.
- **Route mapping.** `PatchSetRoutes` maps errors through `ServiceResponse.run`. The structured-409 precedent exists:
  `StepConfigInvalid` at ServiceResponse.scala:80-89 and `schemas/shared/step-config-error-response.schema.json`.
- **Refinement stamping.** `RefinementService.parseAndValidate` (lines 122-130) discards the preview result and returns
  `patchSet`. That value flows into `AttemptOutcome`, and from there into `RefinementConversationTurns`'
  `latestPatchSet` (lines 59 and 87). D5 says the stamped set is returned and stored.
- **Undo and other construction sites.** `EditTarget(` is constructed only by the reader (PatchSetProtocol.scala:104).
  A defaulted `fingerprint: Option[String] = None` keeps the undo/inverse paths unchecked.
- **Red test.** Planner Notes say the red test sends a raw JSON `fingerprint`. On main the reader ignores it, apply
  returns 200 and the overwrite happens, so this is a real red.
- **Frontend.** `PatchSetReviewPage.tsx` currently:
  - calls `navigate("/")` (a push) after apply, which confirms the Back variant;
  - keys the preview effect on `[patchSet, dispatch]`, so Re-preview needs a trigger, which D6 covers;
  - is the only apply caller (`patchSetService.ts:24`, through the slice).

  D6 covers stamping from the shown preview, a typed 409 rejection, Re-preview, Apply disabled while a preview loads,
  and `replace: true`.

### Verdict: CONFIRM

All four round-1 change requests are resolved in the artifacts, and the claims each depends on hold against origin/main.
The fresh review found no blocking design defect.

### Non-blocking notes

1. The proposal's "What Changes" still describes the fingerprint as "a content hash of the target's user-editable
   state", and spec.md's Purpose still says apply refuses "when any target has changed since". Both overstate the
   name-only dataSource/pipeline scope that D2 and the spec requirement now state correctly. Align the wording in the PR
   body's OWNER REVIEW section.
2. The D2 panel row says "raw via `findByIdInternal`", but the panel resolvers read `panelRepo.findById`. Both go
   through `rowToDomain` (PanelRepository.scala:115/130), so both return the stored, unmaterialized state. Compute the
   fingerprint from the object the resolver already holds. Do not add a read.
3. In `AssistantToolExecutor`, the stripped patch set must be the one captured in `AssistantProposal.Patch(...)`.
   Otherwise a model fingerprint on a create reaches the review page, and that page's own preview returns 400.
4. Task 2.2 says "reject it on create (400) in preview and apply" under "reader/writer". Put that rejection at
   resolution time, as D3 says, and not in `editFormat.read`. A reader-level rejection would fail
   `RefinementParsing.parsePatchSet` before the strip step can run.
5. Task 2.7's "(+ a 409 body schema if the repo keeps error schemas)": the repo does keep them
   (`schemas/shared/step-config-error-response.schema.json`), so add one.
6. Typo in D4: "Rendered rendered".
