# Files modified — HEL-904 (cumulative across all cycles)

Cycle 30 delta (this cycle) — mechanical class rename only, no behavior change:

- `backend/src/main/scala/com/helio/api/package.scala` — `WorkspaceContextDataType` → `WorkspaceContextOutput` rename (type alias/import reference)
- `backend/src/main/scala/com/helio/api/protocols/workspace/WorkspaceContextProtocol.scala` — renamed the `WorkspaceContextDataType` case class + its `workspaceContextDataTypeFormat` implicit to `WorkspaceContextOutput`/`workspaceContextOutputFormat` (wire field names unchanged, cosmetic Scala identifier only)
- `backend/src/main/scala/com/helio/api/protocols/workspace/WorkspaceResourceSearchProtocol.scala` — updated references to the renamed type
- `backend/src/main/scala/com/helio/services/assistant/AssistantToolExecutor.scala` — updated references to the renamed type
- `backend/src/main/scala/com/helio/services/patchsets/RefinementGrounding.scala` — updated references to the renamed type
- `backend/src/main/scala/com/helio/services/patchsets/RefinementPrompt.scala` — updated references to the renamed type
- `backend/src/main/scala/com/helio/services/proposals/DashboardAuthoringPrompt.scala` — updated references to the renamed type
- `backend/src/main/scala/com/helio/services/proposals/DashboardAuthoringService.scala` — updated references to the renamed type
- `backend/src/main/scala/com/helio/services/workspace/WorkspaceContextBudget.scala` — updated references to the renamed type
- `backend/src/main/scala/com/helio/services/workspace/WorkspaceContextService.scala` — updated references to the renamed type
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceApplyBudgetSpec.scala` — updated test fixtures to the renamed type
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceComputeJoinHintsSpec.scala` — updated test fixtures to the renamed type
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceSpec.scala` — updated test fixtures to the renamed type

For all prior cycles' file lists (cycles 1-29 — dozens of files spanning the full domain-model
migration, repository/service/route deletions, schema reshape, and test retargeting), see
`execution-progress.md`'s per-cycle sections, which enumerate each cycle's changes in full detail.
This file reflects only the delta of the current (final) cycle per the executor instructions to
overwrite on re-runs; the cumulative diff is `git diff main...HEAD --name-only`.
