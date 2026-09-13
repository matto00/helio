## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD: 7be9301d07f92b5c9eef0fbc824f94ac90f2a126 (artifacts are uncommitted in the change dir).

### What I verified (with evidence)
- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/rename-datatype-prompt-copy/HEL-1127`.
- **CR1 (helio-mcp scope wording): resolved.** ticket.md's re-scope now limits the rename to the 5 named backend directories and excludes helio-mcp (tracked as HEL-1132). proposal.md's What Changes/Impact and design.md's round-2 section say the same thing. I found no remaining "across the codebase" wording.
- **CR2 (unworkable re-grep): resolved.** Task 1.8 now greps only the touched files. I ran my own case-insensitive `datatype|data type` grep over all 5 directories. Every hit outside the planned rename sites is one of these:
  - an identifier: `dataTypes` params, `toDataTypeEntry`, `DataTypeDetail`, `WorkspaceResourceType.DataType`, `validateDataTypeBinding`
  - a JSON wire key or wire enum value: `WorkspaceContextBudget` `"dataTypes"`, `ResourceTypeEnum` `"dataType"`
  - a `c.dataType` column scalar type
  - a HEL-904 historical or doc comment in non-prompt files (`PatchSet*`, `WorkspaceContextService`, `WorkspaceSearchService`, `AuthoringError.scala:20`, `ProposalPanelSupport`)
  None of these is LLM-visible prompt or tool copy. The claimed KEEP sites also check out against the live files:
  - `RefinementEditShape.scala:270` is the `"dataType" is not a valid target.kind` guard.
  - `RefinementEditShape.scala:14` is the stale `DataTypeProtocol` reference. `find -name 'DataTypeProtocol*'` returns nothing.
  - `AssistantToolExecutor.scala:149,159,162,164` use `DataTypeDetail`.
  - `WorkspaceContextBudget` has the `"dataTypes"` key.
- **CR3 (L55 hint disagreement): resolved.** tasks.md 1.4 and design.md's round-2 bullet both add the `(resource type "dataType")` hint at L55 as well as L27-28. The live file matches the plan: `ResourceTypeEnum` at L22, `findTool` description at L27, `getResourceTool` "a DataType's columns" at L55.
- **CR4 (no test for the hint): resolved.** Tasks 1.3 and 1.4 add positive `include("dataType")` assertions. Both target specs exist: `AssistantSystemPromptSpec.scala` and `WorkspaceAssistantToolsSpec.scala`. `findTool` and `getResourceTool` are public `val`s (L24, L51), so the new assertions can reach them. The existing negative assertion (`AssistantSystemPromptSpec.scala:123`, "data source, DataType, pipeline") does not match any planned replacement text.
- Every cited line number matches live HEAD:
  - `DashboardAuthoringPrompt` 48-50, 57, 72
  - `RefinementPrompt` 108-109, 117, 118, 120-121
  - `AssistantSystemPrompt` 7, 9, 72, 74, 85, 87
  - `AssistantProposalToolSchemas` 55, 80, 448, 451, 458-459
  - `DashboardAuthoringService` 62, 276
  - `RefinementGrounding` 110
- Existing tests don't pin the renamed strings. I grepped `backend/src/test` for the renamed copy and found no verbatim asserts, which matches design.md's fixture-check claim.

### Verdict: CONFIRM

### Non-blocking notes
- tasks.md 1.8 says "exactly the 8 touched files" but lists 7, and 7 is the correct count. The executor should grep the 7 files listed.
- design.md's round-1 table row for `DashboardAuthoringService.scala L62` still says "no pipeline-output Outputs yet". The round-2 bullet and tasks.md 1.6 correct this to "no pipeline Outputs yet". Follow tasks.md.
- design.md calls the round-2 audit "closed", but it only lists 4 extra KEEP sites. It leaves out the many identifier and historical-comment hits in `PatchSet*`, `WorkspaceContext*`, `WorkspaceSearchService`, `ProposalPanelSupport`, `AuthoringError` and `DashboardProposalService`. I checked them: none is LLM-facing copy, so the scope conclusion holds. The doc overstates how complete its list is.
- Task 1.2's verify command (`testOnly com.helio.services.patchsets.*`) and task 1.6 have no new assertion for the renamed RefinementPrompt and degrade strings. That's acceptable for a copy-only change, and task 2.1 runs the full suite anyway.
