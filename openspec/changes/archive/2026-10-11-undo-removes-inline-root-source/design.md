## Context

All line refs are from origin/main 02dc11abd. `PatchSetUndoService.restoreOne` maps `("pipeline","create")` to
`restoreCreateUndo(edit, id => pipelineService.delete(...))` (PatchSetUndoService.scala:118). The journal row
(`PatchSetApplicationRepository.JournaledEdit`, :93, `jsonFormat7`) stores index/kind/op/priorState/resultingState/newId/
rawResultingConfig. It does **not** record which roots were inline. `resultingState` is the `PipelineSummaryResponse`,
whose `roots[].dataSourceId` cannot tell a created source from an existing one. Apply-time rollback
(`PatchSetApplyRollback.deleteInlineRootSources`, :209) only knows this from the in-memory `CreatePipelineRequest`
(`roots[i].type.isDefined` = inline), paired with the summary roots by position, trusted only when the counts agree.
`InlineSourceCleanup.deleteCallCreated` (services/sources/InlineSourceCleanup.scala) deletes through
`DataSourceService.delete` (409 while referenced by a pipeline or form panel, DataSourceService.scala:649) and then the
implicit Connector. It returns only a Boolean, so a caller cannot tell "kept because referenced" from "failed".
`PatchSetUndoService` already holds `pipelineService`, whose `private[services] inlineSourceCleanup` is the wired helper.

## Goals / Non-Goals

**Goals:** owner option B for new applies; legacy rows unchanged; kept sources reported on the wire and in the toast.
**Non-Goals:** prod orphan cleanup (HEL-1495), legacy heuristics, option C, any change to rollback/create cleanup.

## Decisions

**D1. Journal the created inline sources.** Add `inlineSources: Option[Vector[JournaledInlineSource]]` to `JournaledEdit`,
`JournaledInlineSource(id: String, implicitConnector: Boolean)`. spray-json's `jsonFormatN` reads an absent `Option`
field as `None`, so existing rows still parse. A test pins this with a literal pre-change JSON row. `journalSuccess` fills it only for
`ResolvedAction.PipelineCreate`: `Some(paired)` (empty when there are no inline roots), `None` on a root-count mismatch.
The roots-by-position pairing moves out of `PatchSetApplyRollback.deleteInlineRootSources` into one shared helper
(e.g. `InlineRootPairing` in `services/patchsets`) used by both journal and rollback. Rollback behaviour stays
byte-for-byte the same. Alternative rejected: infer at undo time from source `createdAt` vs `appliedAt`. That is a guess
that could delete a source the user already had.

**D2. Classified delete in `InlineSourceCleanup`.** Add `deleteIfUnreferenced(id, implicitConnector, user, context):
Future[InlineSourceDeleteResult]`. The result ADT is `Removed(name)`, `KeptReferenced(name, reason)`, `AlreadyGone` and
`Failed(name)`. `name` is optional, since the source is read first. It maps `DataSourceService.delete`'s structured
conflict to `KeptReferenced` and `NotFound` to `AlreadyGone`. It deletes the implicit Connector only after `Removed`,
via the existing `ImplicitConnectorCleanup.deleteIfAuto`. A Connector failure is logged, and the source still counts as
removed. It never throws. `deleteCallCreated` keeps its exact current contract. Reimplementing it on top of the new
method is allowed only if every existing caller's Boolean is unchanged.

**D3. Undo path.** Replace the `("pipeline","create")` arm with `restorePipelineCreateUndo`: delete the pipeline as
today. On success:
- `inlineSources = None` (legacy): the outcome is identical to today's.
- `Some(v)`: run `deleteIfUnreferenced` for each source, sequentially.

The edit status stays `restored` whatever the per-source results, because the pipeline undo itself succeeded. A
source-cleanup failure does not stop the reverse walk. The pipeline-delete failure path is unchanged. If
`inlineSourceCleanup` is null (no DataSourceService wired), every journaled source is reported `kept` with an
explanatory reason, and a warning is logged. The Phase-1 conflict check (`PatchSetUndoConflictCheck`) is unchanged: a
referenced source is reported, never a 409 that refuses the whole undo (owner: B, not refuse).

**D4. Wire.** `EditUndoOutcome` gains `inlineSources: Option[Vector[InlineSourceUndoOutcome]]`, with
`InlineSourceUndoOutcome(id, name: Option[String], result: "removed" | "kept" | "alreadyGone", reason: Option[String])`.
The field is omitted when `None`. It is also omitted when the journal holds an empty list (a create whose roots all name
existing sources). Legacy and non-pipeline outcomes are byte-identical to today. Declare the new implicit formats before
the formats that use them.

How each cleanup result maps to the wire (`reason` is always set for `kept`):

| Cleanup result | `result` | `reason` |
| --- | --- | --- |
| `Removed` | `removed` | none |
| `AlreadyGone` | `alreadyGone` | none |
| `KeptReferenced` | `kept` | `InlineSourceCleanup.inUseReason(conflict)`: UI-safe text such as `still used by pipeline "X".`, naming only the referencers the caller can see (hidden ones as a count, HEL-1252), with no ids and no delete-flow remediation |
| `Failed` | `kept` | fixed sentence `REASON_FAILED` = "The data source could not be removed." |
| no helper wired | `kept` | fixed sentence `REASON_UNAVAILABLE` = "The data source was not removed: source cleanup is unavailable." |

The two fixed sentences are named constants. A `reason` never carries an exception message, an id or SQL text.

`Failed` may in fact describe a source that was deleted. Reporting it as kept is the safe side to err on. Update
`PatchSetUndoProtocol` (`jsonFormat5`), `schemas/patch-sets/patch-set-undo-response.schema.json` (a new `$defs` entry,
`additionalProperties: false`), `frontend/src/features/patchSets/types/patchSet.ts` and `helio-mcp/src/types.ts` (type
only).

**D5. Frontend.** The patch-set code has no data-source invalidation today: `invalidateAffectedState` in
`patchSetsSlice.ts` handles panels and dashboards only. Extend it, or the `undoPatchSet` thunk, so that when any undo
outcome lists an `inlineSources` entry with `result: "removed"` or `"alreadyGone"`, it dispatches `fetchSources()`, and `fetchSourceReferences()` when any outcome lists an inline source at all (removed or kept), so the /sources "Used by" column is not stale
(`features/sources/state/sourcesSlice.ts`).

On undo success, the `PatchSetReviewPage` toast reads "Undone." and then adds one line per `kept` entry. Each line uses
that entry's own `reason`, never hardcoded wording in the frontend (the backend owns the text; a failure is never worded as "in use"): `Kept data source "<name>": <reason>`. When `name` is
absent, the fallback label is `Kept a data source: <reason>`. Several kept sources render as separate lines in one
toast. Follow DESIGN.md toast patterns. The connectors list is not refreshed (an accepted gap, listed under Risks).

## Risks / Trade-offs

- Not crash-atomic: the pipeline delete, the source delete and the Connector delete are separate commits (same
  limitation as HEL-1475's helper). A death between them leaves the source behind. Accepted.
- Patch sets journaled before deploy still leak on undo (owner decision); HEL-1495 covers prod cleanup.
- The 409 reason is agent-oriented (ids, remediation advice) and is deliberately NOT shown: `inUseReason` rebuilds user-facing text from the structured conflict, mirroring `SourceDeleteConflictNotice`.
- An inline `static` root creates a Dataset source, and its `dataset_rows` are cascade-deleted. Rows written to an
  unreferenced inline static source after the apply are therefore lost on undo. This is the trade-off accepted by
  choosing B over C.
- Failure to delete an implicit Connector is only logged, and the connectors list is not refreshed after undo.

## Planner Notes

- Self-approved: field names `inlineSources` / `result`; sequential (not parallel) source deletes; status stays `restored`.
- Tests must be red first on main for the "removed" scenarios; new DB specs use `VerifiedEmbeddedPostgres.start`;
  `[hel1468-guard]` must appear in sbt output; no inline FQNs.
