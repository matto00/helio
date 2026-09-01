## Skeptic Report — final gate, axis: wire-contract diff (round 1)

HEAD `dc95ccc4` vs `main`. Every statement below was derived from fresh commands run in this
worktree; the executor/evaluator reports were not consulted for any conclusion.

### What I verified (with evidence)

1. **Route inventory, main vs HEAD.** Compared every `path(...)`/`pathPrefix(...)` literal across
   `api/routes/**` + `ApiRoutes.scala` at both revisions (`git grep -hoE ... | sort | uniq -c`,
   diffed). Exactly four deletions: `pathPrefix("types")` + `path(DataTypeIdSegment` (×5),
   `pathPrefix("metrics")` + `path(MetricIdSegment` (×2), one `pathPrefix("panels")` occurrence
   (`/api/panels/bound`), and two `path(PanelIdSegment` occurrences (`/query`). Nothing else
   removed. All four match ticket.md's sanctioned removal list.
   - `DataTypeRoutes.scala` (deleted) carried `GET /api/types`, `GET :id/rows`,
     `:id/validate-expression`, `:id/panel-capabilities`, `:id/assertion-status`,
     `GET/PATCH/DELETE :id` — all named in ticket.md / spec line 195.
   - `GET /api/panels/:id/query` is nominally P1.3's per spec line 142, but is forced here:
     `Panel.buildQuery` depends on the panel-level binding/aggregation this ticket deletes.
     Documented in `PanelRoutes.scala:72-74` and truthfully re-labelled in
     `DashboardPanelAclSpec.scala:446-453` ("the route itself was removed outright"). Not creep.
2. **No new Output routes.** `git grep -nE '"outputs"|OutputIdSegment|"capabilities"'` over
   `api/**` at HEAD returns zero route literals for Outputs. P1.3's surface has not leaked in.
3. **`POST /api/panels` wire shape.** `schemas/panels/panel.schema.json` and
   `create-panel-request.schema.json` both now enumerate `type ∈ {text, markdown, image, divider,
   output}`; the five bound `$defs` are replaced by a single `OutputConfig {outputId: string}`.
   The wire discriminator field is still named `type` (not `kind`) — matches Scala `PanelType`;
   the `kind` rename correctly remains P1.3's. `outputId` requiredness is enforced server-side, not
   by schema: `OutputPanel.scala:71-72` `validateConfig = if (config.outputId.value.isEmpty)
   Left("outputId is required")`, invoked at `PanelService.scala:149`; nonexistent/cross-user ids
   404 via `rejectMissingOutput` (`PanelService.scala:412-430`). Task 5.2's claim holds.
4. **`POST /api/pipelines`.** `CreatePipelineRequest` loses `outputDataTypeName` (`jsonFormat4` →
   `jsonFormat3`); `PipelineSummaryResponse` loses `outputDataTypeName`/`outputDataTypeId`
   (`jsonFormat11` → `jsonFormat9`); `pipeline-analyze-response.schema.json` drops both from
   `properties` and `required`. Verified in the protocol source, not only the schema.
5. **Alerts.** `AlertRuleResponse`/`CreateAlertRuleRequest`/`AlertEventResponse` all carry
   `targetOutputId`; `alert-rule`, `create-alert-rule-request`, `alert-event` schemas match
   (`required` includes `targetOutputId`, no `targetDataTypeId` anywhere). Route tests assert the
   real wire key (`AlertRuleRoutesSpec.scala:109,134,205`).
6. **`check-schema-drift.mjs` fresh run**: `EXIT=0`, "60 checked across 46 protocol files",
   "panel-type enums in sync ... 7 surfaces". Spot-checked non-vacuously: `alert-rule.schema.json`
   title `AlertRuleResponse` ↔ `AlertRuleProtocol.AlertRuleResponse` — field-for-field identical
   including the renamed `targetOutputId`, so the checker is comparing current shapes, not
   stale-but-matching ones. The arm-count guard moved `< 8` → `< 5` with its message, in the same
   commit as the collapse — a threshold move, not a disabling.
7. **Frontend/MCP blast radius**: `git diff --stat -- 'frontend/**' 'helio-mcp/**'` = 6 files,
   all one-constant mechanical edits of the drift-script cross-surface set (`PANEL_TYPES`,
   `DATA_PANEL_TYPES` ×3) plus their two test fixtures. No feature/UX code. Sanctioned by task 5.7
   + design.md's Gate-Chain decision (which names `proposal.ts`, `proposalValidation.ts`,
   `ProposalReview.tsx`).
8. **`schemas/`**: `schemas/metrics/` and `schemas/data-types/` are gone; `schemas/outputs/`
   contains only `output-assertion-status.schema.json` (the sanctioned move) — no P1.3 Output
   schemas added. `bound-panel-request/response`, `panel-capabilities-response`, `panel-query`
   deleted. `workspace-teardown-response` drops `typesDeleted` and narrows `resourceKind` to
   `["data_source"]` — consequent to the sanctioned teardown-branch deletion.

### Verdict: REFUTE

Two findings, both narrow and cheap, both squarely on this axis (shipped wire surface vs. what the
change's own artifacts say it is). Nothing functional is broken; the objection is that the wire
contract as shipped contradicts the change's own spec delta, and that the exemption list this
ticket presents as exhaustive is not.

### Change Requests

1. **`openspec/changes/outputs-model-migration/specs/workspace-resource-search/spec.md:9-12`
   states behavior that is the opposite of what shipped**, and this delta is what gets archived
   into `openspec/specs/` as the contract of record.
   - Spec delta: "**THEN** its result kinds no longer include `dataType` or `metric`".
   - Shipped code: `WorkspaceResourceType.scala:16,23,33` **keeps** `DataType` → wire value
     `"dataType"` (only `Metric` was removed), and `WorkspaceSearchService.scala:76-77,133-137`
     still emits `resourceType = "dataType"` results — now sourced from `OutputRepository`.
     `WorkspaceResourceSearchProtocol.scala:52,62` still writes/reads the `"dataType"`
     discriminator, wrapping a `WorkspaceContextOutput`.
   - The shipped behavior is even asserted by a test:
     `WorkspaceSearchServiceSpec.scala:221` `hit.resourceType shouldBe "dataType"`.
   - `WorkspaceSearchService.scala:128-130` explicitly defers the rename ("renaming that wire value
     is section 5's schema-surface job, not this task's") — but no section-5 task owns it, so the
     deferral has no owner and the spec delta was written against the un-executed plan.
   - Required: make the two agree. Keeping the `"dataType"` wire value is the defensible choice
     (renaming it breaks the 30+ MCP/frontend consumers this ticket may not touch) — in which case
     rewrite the scenario to say the `metric` kind is removed while the `dataType` kind is
     **retained as a transitional wire label now carrying Outputs**, and record it as a third named
     exemption (see CR 2). Do not leave a spec of record asserting a kind is gone when it ships.

2. **design.md's exemption decision (`:317-345`) claims "exactly two named exemptions" for
   surviving DataType-shaped wire naming; the grep shows more than two.** Fresh
   `grep -rn "DataType\|Metric" backend/src/main/scala/com/helio/api/protocols/` at HEAD, with
   every hit classified (comments excluded), yields these **wire-facing** survivors:
   - Exemption 1 ✔ `PipelineProposalProtocol.scala:106,117,193,208-211`.
   - Exemption 2 ✔ `WorkspaceContextProtocol.scala:56,58,126,127`.
   - **Unlisted:** `PipelineAnalyzeProposalProtocol.scala:16` —
     `PipelineAnalyzeProposalResponse.outputDataTypeName`, a live response field on
     `POST /api/pipelines/analyze-proposal`, in `jsonFormat4` at `:30`.
   - **Unlisted:** `AssistantProposalToolSchemas.scala:160,171,174,192` — the literal
     `"outputDataTypeName"` property/`required` entry in the Claude-facing tool JSON schema (an
     agent-facing wire surface, not a comment).
   - **Unlisted (wire *value*, not field name):** the `"dataType"` `resourceType` discriminator of
     CR 1 — the exemption text scopes itself to field *names* and therefore does not cover it.
   These are all the same family as Exemption 1 and I do not dispute keeping them; the defect is
   that AC 6.1 and design.md present the list as exhaustive, so a future reader (and P1.4, which
   inherits the rename) will miss two protocol files and one enum value. Required: extend design.md's
   exemption decision to name `PipelineAnalyzeProposalResponse.outputDataTypeName`,
   `AssistantProposalToolSchemas`' mirror of it, and the `"dataType"` resourceType value, and state
   the same P1.4 hand-off for each. No code change needed.

### Non-blocking notes

- `schemas/panels/panel.schema.json:5` had its literal em-dash rewritten as the escape `—`
  ("Discriminated panel response — ..."); several touched Scala doc comments similarly swapped
  `—` for `--`. Cosmetic encoding churn, no wire effect, but it is unrelated noise in the diff.
- `PublicDashboardRoutes.scala` keeps its route but `dataAsOf` is now always absent on the public
  panels response (the `findLastRunAtByOutputDataTypeId` lookup was removed). Spec line 191 assigns
  the rewire to P1.3, so this is a sanctioned temporary wire degradation — worth an explicit line
  in the PR body so P1.3 does not lose it.
- `frontend/src/features/proposals/ui/CombinedProposalReview.tsx` is a **fourth**
  `DATA_PANEL_TYPES` mirror, not among the three files the drift script checks or design.md names.
  Updating it was correct (leaving it stale would have been a latent labelling bug), but it is
  outside the letter of task 5.7's file list — worth adding to that list retroactively.
