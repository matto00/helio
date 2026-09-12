# HEL-1118 triage findings

**Revision note (round 2, addressing skeptic-final-1.md):** the skeptic REFUTEd the round-1
version of this document for four reasons: (1) a stale, contradictory paragraph left in
`WorkspaceContextService.scala`'s own edited scaladoc block, (2) an identical `per-DataType`
phrasing miss at `DashboardAuthoringService.scala:66`, six lines from a correctly-fixed sibling,
(3) a newly-introduced false claim ("`validateTolerant` is currently unreferenced" — it is still
exercised by `ExpressionEvaluatorSpec`), and (4) an approximate, non-reconciling count
(`91+108+9+2+16=226 ✓`, with three of five terms explicitly "~"). All four are fixed below. Per
the skeptic's instruction, this revision also did a full, line-by-line re-read of every hit
(not just the four cited lines) and found **9 more genuinely-stale sites** the original pass
missed, all fixed in this round (listed in their own subsection below). The counts below are
**exact grep-line counts**, re-derived after every fix, not estimates.

## Item 1: `DataSource.scala` scaladoc

- **`DatasetSource` scaladoc (lines ~9-19, ~146-158):** already correct. HEL-1073 renamed
  `StaticSource` -> `DatasetSource`; HEL-1074 rewrote the scaladoc to describe the
  `dataset_schema`+`dataset_rows` path exclusively. No edit made (confirmed, not touched).
- **`DataSource.scala:44` inferredSchema-backfill claim:** was stale. The comment said the empty
  default persisted "until the data-migration step (tasks.md §2.9) backfills it," worded as a
  still-pending step. Verified against `V94__*.sql` section 8 ("Data migration step 2.9(a):
  companion types -> inferred_schema") — this backfill ran as part of the V94 migration, which is
  already applied. Corrected the comment to state the backfill already happened at deploy time.
  **Round 2 correction** (skeptic non-blocking note): the round-1 wording overstated it as backfilling
  "every pre-existing row" — V94 section 8 only folds in rows that HAD a companion type
  (`source_id IS NOT NULL`, not a pipeline's own output type); a pre-existing source with no
  companion type still reaches the empty default today. Reworded to state both cases precisely.

## Item 2: sweep of `backend/src/main/**/*.scala`

Grep pattern: `DataType\b|type registry|snapshot.?row` (case-insensitive), `backend/src/main`.
**188 exact hits** at the current (post-fix) HEAD, across 65 files (`type registry`: 0 hits;
`snapshot.?row`: 3 hits, all referring to the live `node_snapshots` table — accurate; the rest are
`DataType\b`). This count moves between commits as fixes land (some fixes remove `DataType`
tokens entirely, e.g. renaming `DataType` -> `Output`); it is re-derived fresh below rather than
carried forward from an earlier commit's grep.

**Exact classification of all 188 hits, split code vs. comment:**

| Bucket | Code hits | Comment hits | Total |
| --- | --- | --- | --- |
| unrelated-identifier | 87 | 21 | 108 |
| accurate-historical | 0 | 73 | 73 |
| uncertain | 0 | 7 (4 distinct sites) | 7 |
| genuinely-stale (unfixed) | 0 | 0 | 0 |
| **Total** | **87** | **101** | **188** |

(Comment-hit lines were re-grepped and individually re-read against the current file content,
not sampled — every one of the 101 comment-matching lines is accounted for in the table above,
resolving skeptic CR4's "the arithmetic was supposed to make this impossible" objection. Round-3
correction (driver-directed, skeptic-final-2.md): the "uncertain" row previously said 6/"4 distinct
sites" while the list below it already enumerated 7 lines across the same 4 sites — `RefinementPrompt.
scala:108-109` is 2 separate grep-matched lines, not 1, and that second line was left out of the
header count when `WorkspaceAssistantTools.scala:55` was added in round 2. The 87+101=188 total was
already correct — the per-bucket split beneath it, specifically the uncertain row's line count, was
the one number that didn't match its own listed contents. Fixed by correcting the uncertain row's
line count and the comment-hits/total column sums that depend on it; the site count (4 files) and
every other bucket's contents are unchanged.)

- **unrelated-identifier (87 code + 21 comment = 108):** a live, differently-named concept in
  every case checked — e.g. `SchemaField.dataType: String` (a column's type string, unrelated to
  the retired `DataType` domain model), `@param dataType` docs, Spark's own `DataType` import,
  the still-recognized-but-rejected lowercase `"dataType"` wire-kind string in `PatchSetProtocol`/
  `PatchSetApply*`/`PatchSetUndo*` (a real, still-checked value — just always rejected post-HEL-904),
  and `WorkspaceResourceDetail.DataTypeDetail`/`WorkspaceResourceType.DataType` (live, legacy-named
  wire identifiers that still round-trip real requests). None edited.
- **accurate-historical (73, all comment-level):** correctly describe a past removal ("REMOVED
  outright", "retired by HEL-904", "no longer a valid target.kind", "no companion DataType row
  anymore", "no longer mints a DataType", etc.). Left untouched. Includes the two calibration
  checks named in the ticket:
  - `PanelServiceHelpers.scala:192` ("the DataType-binding resolvers ... were removed here") —
    accurate-historical, past tense, correctly describes a removal. Not touched.
  - Large clusters in `patchsets/*` (PatchSetPreviewImpact, PatchSetApplyForward,
    PatchSetApplyRollback, PatchSetApplyTypes, PatchSetUndo*, PatchSetPreviewProjection,
    PatchSetApplyServiceJson) and `pipelines/*` (PipelineRepository, PipelineRunRepository) —
    all HEL-904-task-3.3-era "X removed outright" comments, correctly past-tense.
- **uncertain (7 comment lines, 4 distinct sites):** LLM-prompt-facing copy that uses "DataType"
  as loose product terminology for what is now an Output, rather than a claim about a live storage
  mechanism:
  - `DashboardAuthoringPrompt.scala:49,72` ("the exact per-DataType ... grounding text") — renders
    as `Output id=...` in the actual generated prompt text.
  - `RefinementPrompt.scala:108-109` ("workspace-wide pipeline-output DataType ... a DataType not
    yet used").
  - `AssistantSystemPrompt.scala:7,9` ("per-DataType grounding data ... no matching DataType").
  - `WorkspaceAssistantTools.scala:55` — the live `get_resource` LLM tool description string
    ("a DataType's columns/sample rows/column stats") — **added in this revision**; the skeptic's
    non-blocking note pointed out it was missing a bucket entry entirely. It matches the wire
    discriminator itself (`WorkspaceResourceType.DataType.asString == "dataType"`), so "leave it"
    is the call, but it is now listed.

  Left un-edited rather than guessed at — low confidence either way, and editing prompt copy
  risks an unrelated behavior change to LLM grounding/tool-description text (out of a
  comment-only ticket's scope to judge that tradeoff).
- **genuinely-stale: 0 remaining** — every hit found across two full passes (round 1's sweep +
  round 2's skeptic-triggered full re-read) has been fixed. See both lists below.

### Genuinely-stale hits fixed — round 1 (16, from the original sweep)

1. `domain/model/DataSource.scala:44` — inferredSchema-backfill comment described the backfill as
   still-pending; it already ran (V94 migration).
2. `domain/model/WorkspaceResourceType.scala` — companion scaladoc claimed a live top-level domain
   case class `DataType` exists in the package; no such class exists post-HEL-904.
3. `services/proposals/DashboardAuthoringService.scala:261` (flagged suspect) — "One per-DataType
   capability fetch" described iterating `workspace.dataTypes`, whose elements are
   `WorkspaceContextOutput`s, not the retired `DataType` model.
4. `services/sources/DataSourceService.scala` (9 hunks, corrected from round 1's miscounted "10" —
   skeptic bookkeeping note) — "DataType registration"/"linked DataType's fixed schema is
   re-upserted" described a companion-row mechanism that no longer exists.
5. `infrastructure/persistence/sources/DataSourceRepository.scala:141` — `findByIdInternal`'s
   "Permitted callers" list named `DataTypeService.checkSourceLink`, a deleted class with no
   remaining callers of this method.
6. `domain/engine/ExpressionEvaluator.scala` (2 blocks) — described `validateTolerant` as
   presently "used only by `DataTypeService`" (retired). **Round-2 correction**: round 1's fix
   claimed the method is "currently unreferenced," which is false —
   `ExpressionEvaluatorSpec.scala` still exercises it directly. Reworded to "no callers remain in
   `backend/src/main`, though `ExpressionEvaluatorSpec` still exercises it directly" — accurate,
   scoped to production code.
7. `api/http/RequestValidation.scala:140` — `validateMetricName` doc described a `MetricService`
   caller in the present tense; verified zero remaining callers anywhere (`backend/src/main` AND
   `backend/src/test`).
8. `services/dashboards/DashboardService.scala:69` — present-tense "mirroring
   `DataTypeService.findById`'s exact shape".
9. `services/alerts/AlertRuleService.scala:14` — present-tense "(mirrors `DataTypeService`'s
   shape)".
10. `domain/connectors/ConnectorDriver.scala:108-112` — described `CreateSourceResponse`'s field as
    `dataType`/said the helper "persists a new `DataType`"; the actual field is `inferredSchema`.
11. `services/sources/ContentSourceSupport.scala:40-42` — "every content connector's `DataType`
    registers".
12. `domain/shapes/OutputContract.scala:29` — "binds via the runtime `DataType` schema".
13. `services/workspace/WorkspaceContextService.scala` — `toDataTypeEntry`'s leading doc comment
    was pre-HEL-904 and contradicted the method's own body a few lines below.
14. `api/protocols/workspace/WorkspaceContextProtocol.scala` — `WorkspaceContextOutput`'s doc
    described `sourceId`/`pipelineOutput` as classified off a live domain `DataType`.

### Genuinely-stale hits fixed — round 2 (9 more, found via the skeptic-triggered full re-read)

15. `services/workspace/WorkspaceContextService.scala:37-42` (old numbering; skeptic CR1) — a
    paragraph left inside the very scaladoc block round 1 edited still asserted, in the present
    tense, that the constructor "takes `dataTypeService: DataTypeService`" — directly contradicting
    both round 1's own fix six lines above AND the file's own HEL-904 task-3.12 comment 20 lines
    below, which states that param was replaced by `outputRepo`. Removed the stale paragraph
    outright (it carried no information the surrounding, already-accurate text didn't already
    cover).
16. `services/proposals/DashboardAuthoringService.scala:66` (skeptic CR2) — `GroundedContext`'s doc
    still read "a per-DataType panel-capability menu", the identical construction round 1 correctly
    fixed six lines away at line 261. Fixed to "per-Output".
17. `services/patchsets/RefinementGrounding.scala` (3 sites: class doc line 18, `assemble` doc
    line 36, `withWorkspaceContext` doc lines 80-84) — the **exact same missed pattern as #16**,
    in a file whose OWN line 95 (fixed in round 1) already used the corrected "per-Output" wording
    six lines away from these three untouched "per-DataType"/"pipeline-output DataType(s)" sites.
    This is the clearest evidence the round-1 sweep was not exhaustive even within files it had
    already partially fixed.
18. `api/protocols/proposals/DashboardAuthoringProtocol.scala:33` — "e.g. a per-DataType
    panel-capability fetch that failed", the same construction as #16/#17, describing the same
    `fetchCapability` mechanism from the wire-response-doc side.
19. `api/ApiRoutes.scala:86` and `services/pipelines/PipelineRunService.scala:1307` — both cited
    `BinaryRefRepository.overwriteForDataType`, a method that was renamed to `overwriteForNode` by
    HEL-904 task 3.4's re-key to `(pipelineId, nodeStepId)` (verified: `overwriteForDataType` does
    not exist anywhere in `BinaryRefRepository.scala`; `overwriteForNode` is the file's own stated
    "only writer"). This is a stale **method name**, not just stale prose — a reader grepping for
    the cited method would find nothing.
20. `api/protocols/pipelines/PipelineProposalProtocol.scala:10` — the file header described
    `PipelineProposal`'s wire shape as carrying "an output DataType contract" (singular); the
    actual field is `outputs: Vector[CreatePipelineTransactionalOutputRequest] = Vector.empty`
    (plural, and the file's own line ~113-117 already correctly says the DataType/Metric output
    contract "no longer exists"). Fixed to "zero or more Outputs".
21. `domain/model/model.scala:944` — `ImageUpload`'s doc contrasted itself with `[[BinaryRef]]`
    as having "no parent DataType/row", implying `BinaryRef` currently has one; `BinaryRef` was
    itself re-keyed off `DataType` by HEL-904 task 3.4 (see #19) and carries no companion-DataType
    row either anymore. Fixed to contrast against `BinaryRef`'s actual current parent
    (`pipelineId`/`nodeStepId`).
22. `api/protocols/workspace/WorkspaceResourceSearchProtocol.scala` (2 sites) — both said
    `getResource`'s detail "wraps the existing `WorkspaceContext{DataSource,DataType,Pipeline,
    Dashboard}` types verbatim"; no `WorkspaceContextDataType` type exists — the real type is
    `WorkspaceContextOutput`. Fixed both to name the real type, keeping a note that the wire
    discriminator string itself is still `"dataType"`.
23. Terminology-consistency pass, same "DataType-as-loose-synonym-for-Output" pattern as #16-18,
    applied for internal consistency once the pattern was established as genuinely-stale rather
    than stylistic: `services/proposals/ProposalPanelSupport.scala:49`,
    `api/protocols/proposals/CombinedProposalProtocol.scala:18`,
    `api/protocols/proposals/DashboardProposalProtocol.scala:9`,
    `api/protocols/pipelines/PipelineProtocol.scala:235`,
    `services/pipelines/PipelineRunService.scala:1079`,
    `domain/steps/ComputeStep.scala:107`, `domain/engine/InProcessPipelineEngine.scala:252`,
    `domain/engine/JsonFlattener.scala:9`, `services/hooks/HookTriggerService.scala:88`,
    `services/workspace/WorkspaceContextComputations.scala` (the `computeJoinHints`/
    `JoinCandidate` doc block, ~10 lines — also corrected a now-vacuous "excludes a
    source-companion DataType" clause to note post-HEL-904 no such entry exists at all), and
    `services/workspace/WorkspaceContextBudget.scala` (3 lines). Each described the current
    pipeline-Output concept using the retired `DataType` name as though it were still the live
    domain type.

## Item 3: MCP wire-literal

- `helio-mcp/src/helioApi.ts:456` (`createDataSource`'s POST body): `type: "static"` ->
  `type: "dataset"`.
- `helio-mcp/src/helioApi.ts:444` (docstring immediately above): "Create a `static` data source"
  -> "Create a `dataset` data source", so the docstring doesn't describe the retired wire value
  right next to the now-fixed literal.
- `helio-mcp/src/helioApi.ts:93`'s `CSV_LIKE_TYPES = new Set(["csv", "static", "dataset"])` — left
  untouched, confirmed. Its own comment explains `"static"` is kept as a deliberate read-side
  alias for a not-yet-refreshed client/stored proposal (HEL-1073's own sunset timeline, not this
  ticket's scope).

## Spinoff candidates (not actioned here — comment-only ticket)

- `RequestValidation.validateMetricName` is genuinely dead code — zero references anywhere in
  `backend/src/main` or `backend/src/test` (its sole historical caller, `MetricService`, was
  deleted outright by HEL-904). Safe to delete outright in a follow-up.
- `ExpressionEvaluator.validateTolerant` is **not** in the same state — **round-2 correction**
  (skeptic CR3): round 1's triage lumped it in with `validateMetricName` as "dead code, safe to
  delete", which is wrong. It has no callers in `backend/src/main`, but
  `ExpressionEvaluatorSpec.scala` still calls it directly in multiple tests. Any follow-up must
  either delete the spec coverage alongside the method or leave both in place — it is NOT safe to
  delete unilaterally the way `validateMetricName` is.
