## 1. Backend

- [x] 1.1 In `DashboardAuthoringPrompt.scala`, rename L48-49 doc comment ("DataType"→"Output") and
      L72 doc comment ("per-DataType"→"per-Output"); rename L57's live prompt fallback string
      "no panel-capability data available for this data type" → "...for this output"; leave L50's
      quoted spec scenario title, and the `dataTypes`/`c.dataType` identifiers, untouched. Verify:
      `grep -n "DataType" DashboardAuthoringPrompt.scala` shows only the untouched identifier/quote
      sites from design.md's table.
- [x] 1.2 In `RefinementPrompt.scala`, rename L107-109 doc comment ("DataType"→"Output"); rename
      the live prompt strings at L117 ("...for this data type"→"...for this output"), L118
      (`"- DataType id="`→`"- Output id="`), and L120-121 ("Available pipeline-output data
      types:"→"Available pipeline Outputs:", matching `DashboardAuthoringPrompt`'s phrasing);
      leave the `dataTypes`/`c.dataType` identifiers untouched. Verify: `sbt
      "testOnly com.helio.services.patchsets.*"` passes.
- [x] 1.3 In `AssistantSystemPrompt.scala`, rename L7,9 doc comment ("DataType"→"Output") and the
      live tool-description text at L72 (`"sources, DataTypes, pipelines, and dashboards."` →
      `"sources, Outputs (resource type \"dataType\"), pipelines, and dashboards."`), L74
      (`"For a DataType, the result..."` → `"For an Output (resource type \"dataType\"), the
      result..."`), L85 ("DataTypes"→"Outputs"), L87 ("DataType"→"Output"). Add a new test in
      `AssistantSystemPromptSpec` asserting `AssistantSystemPrompt.text should include("dataType")`
      (the wire-value hint survives the rename). Verify:
      `sbt "testOnly com.helio.services.assistant.AssistantSystemPromptSpec"` passes, including the
      existing negative assertion at line ~123 (unaffected) and the new hint assertion.
- [x] 1.4 In `WorkspaceAssistantTools.scala`, rename the live tool-description text at L27-28
      (`"...data sources, DataTypes, pipelines,..."` → `"...data sources, Outputs (resource type
      \"dataType\"), pipelines,..."`) and L55 (`"a DataType's columns/..."` → `"an Output's
      (resource type \"dataType\") columns/..."`); leave the `ResourceTypeEnum` wire value
      `"dataType"` at L22 untouched. Add a new test in `WorkspaceAssistantToolsSpec` asserting both
      `findTool.description` and `getResourceTool.description` still include the literal string
      `"dataType"`. Verify: `sbt "testOnly com.helio.services.workspace.WorkspaceAssistantToolsSpec"`
      passes.
- [x] 1.5 In `AssistantProposalToolSchemas.scala`, rename L55, L80 (comment), L448, L451, L458-459
      ("DataType"/"DataTypes"→"Output"/"Outputs"; "output DataType name"→"output name", matching
      the file's own `outputs` schema field naming at L256-259). Verify:
      `sbt "testOnly com.helio.api.protocols.assistant.AssistantProposalToolSchemasSpec"` passes.
- [x] 1.6 In `DashboardAuthoringService.scala`, rename `EmptyWorkspaceMessage` (L62, "no
      pipeline-output data types yet"→"no pipeline Outputs yet") and `degradeMessage` (L276, "for
      data type $outputId"→"for output $outputId"). In `RefinementGrounding.scala`, rename the
      mirrored `degradeMessage` (L110) identically. Verify:
      `sbt "testOnly com.helio.services.proposals.DashboardAuthoringServiceSpec"` passes (no
      existing test pins the old wording, per design.md's fixture check).
- [x] 1.7 Do NOT touch `RefinementEditShape.scala:270` (wire-value guard, correct as-is) or
      `RefinementEditShape.scala:14` (pre-existing stale `DataTypeProtocol` doc reference, unrelated
      defect, out of scope), `AssistantToolExecutor.scala`'s `DataTypeDetail` identifier/comments
      (out of scope), or `WorkspaceContextBudget.scala:91`'s `"dataTypes"` JSON wire key (not
      copy) — see design.md's round-2 audit table for why each is a documented KEEP.
- [x] 1.8 Re-grep exactly the 7 touched files (`DashboardAuthoringPrompt.scala`,
      `RefinementPrompt.scala`, `AssistantSystemPrompt.scala`, `WorkspaceAssistantTools.scala`,
      `AssistantProposalToolSchemas.scala`, `DashboardAuthoringService.scala`,
      `RefinementGrounding.scala`) for `[Dd]ata[Tt]ype` (case-insensitive) and confirm every
      remaining hit is one of design.md's documented KEEP sites (identifiers, the quoted spec
      title, wire enum/JSON-key values, or a genuine column-scalar-type reference). Do NOT run
      this grep against the whole of `backend/src/main` — that directory has ~380 unrelated hits
      outside this ticket's scope (see design.md's round-2 note); the KEEP audit for files outside
      the 8 touched ones is already closed out in design.md's round-2 table and needs no further
      re-verification here.

## 2. Tests

- [x] 2.1 Run the full backend suite (`sbt test`) and confirm no test newly fails; if any test
      asserts the old "DataType" copy verbatim (none identified during design, but re-check),
      update it deliberately to assert the new "Output" copy — never regenerate a snapshot
      blindly.
