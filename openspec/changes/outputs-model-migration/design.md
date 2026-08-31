## Context

Full technical scope, migration step order, and the exact consumer list are
already fully specified in `ticket.md` and the design spec
(`docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md`,
sections *Concept model*, *Data model & migration*, *Authorization & RLS*,
*Retirements*) — this document records the decisions that shape *how* the
executor should sequence the work, not a restatement of that scope.

This is the largest, least-reversible ticket in the Pipelines & Outputs
remodel: it deletes two tables, two nav pages, and every consumer of them
across ~78 backend files, in one PR that must leave `sbt test` green.

## Goals / Non-Goals

**Goals:**
- Land `outputs`, `node_snapshots`, `pipeline_steps.parent_step_id` with a
  data migration that loses zero user data (every bound panel keeps its
  data; every orphan type becomes a table Output; alert rules keep firing
  against the same effective rows).
- Delete every DataType/Metric consumer so the backend compiles and
  `sbt test` is green, without leaving any `@deprecated`/shim/dual-read path.
- Keep the pre-commit gate (schemas, schema-drift, OpenSpec) green in the
  same commit as the protocol deletions.

**Non-Goals:**
- New Output routes/schemas (P1.3), helio-mcp (P1.4), frontend (P1.5+). The
  frontend will not compile against the new API shape and is expected to be
  non-functional until P1.6 (decision 17) — this is not a defect to fix here.
- Engine tree-walk (P1.2) — the engine keeps running the trunk linearly via
  `trunkOf`; migration-created tails are inert until P1.2 lands.

## Decisions

1. **Sequencing within the ticket** (to keep every intermediate commit
   compilable, even though only the final state needs to hit `main`):
   a. Domain model additions (`Output`, `OutputId`, `OutputKind`, `NodeRef`,
      `parentStepId` on `PipelineStep`, `inferredSchema` on `DataSource`,
      `targetOutputId` on `AlertRule`) land alongside the new repositories
      (`OutputRepository`, `NodeSnapshotRepository`) and tree-ordered
      `PipelineStepRepository` reads, all additive — nothing deleted yet.
   b. The Flyway migration (V94) lands with its full data-migration logic
      and the red-first test, additive alongside the old tables (both old
      and new schema coexist through this step so the migration can be
      tested against the fixture without touching consumers yet).
   c. Every consumer is rewired or deleted in dependency order: leaf
      consumers (specs, routes) before the services/repositories they call,
      so no intermediate state references a symbol that no longer exists.
   d. Schema/OpenSpec deletions land in the same commit as their
      corresponding protocol deletions (not before, not after) — this is
      what keeps `check:schemas`/`check-schema-drift.mjs` green throughout,
      per decision 17's "P1.1 owns every schemas/ deletion" clause.
   e. Old tables (`metrics`, `data_types`, `data_type_rows`,
      `pipelines.output_data_type_id`) are dropped only after every
      consumer is gone and the data migration is proven — this is step (g)
      of the ticket's migration-steps list, last within the same V94
      migration file.
2. **Migration is one Flyway file** (not split across several), because the
   data-migration steps have a strict order dependency (companion types →
   inferred_schema must precede dropping data_types; computed fields →
   compute steps must precede dropping data_types.computed_fields; alert
   rules retarget must precede dropping the target_data_type_id FK) and
   Flyway migrations are immutable once applied — splitting risks a
   half-applied intermediate state on a real database.
3. **Verification approach for "no data loss":** the red-first migration
   test runs the real V94 migration against a fixture derived from
   `pg_dump --data-only` of the local dev DB (per acceptance criteria), not
   a hand-authored SQL fixture — this is what the executor and the skeptic
   both use as ground truth, since a hand-authored fixture could miss a
   real shape the migration doesn't yet handle.
4. **RLS smoke test mechanism:** per the acceptance criteria, the test must
   `SET ROLE` (or connect as) a non-superuser, non-`BYPASSRLS` role created
   by the test itself — the shared dev/CI connection is a superuser, so any
   test that doesn't do this is vacuous (see
   `project_rls_testing_parity_gap` prior finding). The skeptic's final gate
   must independently re-run this test and confirm it goes red when a
   policy is dropped.

## Gate-Chain Implications Checklist

This ticket modifies `scripts/check-schema-drift.mjs`, which
`.husky/pre-commit` invokes on every commit (`check:schemas`) — CON-132's
checklist applies. **Revision (round 2, per skeptic finding 2):** the
script's actual scope is wider than "schemas + backend protocols" — it also
cross-validates the canonical panel-kind set against
`DashboardProposalService.DataPanelKinds` (`DashboardProposalService.scala:211`),
`helio-mcp/src/tools/proposal.ts`'s `PANEL_TYPES` (`proposal.ts:28`),
`helio-mcp/src/tools/proposalValidation.ts`'s `DATA_PANEL_TYPES`
(`proposalValidation.ts:19`), and
`frontend/src/features/dashboards/ui/ProposalReview.tsx`'s `DATA_PANEL_TYPES`
(`ProposalReview.tsx:29`, also referenced at `:60,146`). (Round-3 correction,
per skeptic finding 2: the round-2 citations above were `check-schema-drift.mjs`'s
own line numbers, not the target files'.)
Collapsing the bound panel kinds to `OutputPanel` changes
`canonicalPanelTypes`, which necessarily desynchronizes those four
non-backend surfaces.

**Revision (round 3, per skeptic finding 2 and the coordinator's ruling):**
"narrow mechanical edit" undersold the actual work — treated properly, this
is five concrete, independently-breaking pieces of `check-schema-drift.mjs`
(`scripts/check-schema-drift.mjs`, read line-by-line for this revision, not
just at the four originally-cited ranges), each requiring an explicit fix in
the same commit as the panel-kind collapse (task 3.6):

1. **The hard arm-count guard (`:205`).** `if (canonicalPanelTypes.length <
   8) { …; process.exit(1) }` fires unconditionally before any cross-surface
   comparison runs. The Phase-1 kind set is 5 values
   (`output|text|markdown|image|divider`), so this guard must change to
   `< 5` (or a tighter `!== 5`, since the set is now closed and small enough
   that an exact match is a stronger, still-safe invariant) with its error
   message's `"(expected >= 8)"` updated to match — otherwise the script
   hard-exits on `PanelType.fromString`'s own reformatting, before it ever
   reaches the surfaces this ticket actually changed.
2. **The extraction markers (`:195-199`).** `extractBetween(modelSrc, "def
   fromString(s: String)", "def asString(t: PanelType)", ...)` and the
   `case "x" => Right` regex assume `PanelType`'s method signatures are
   unchanged. Task 3.6 collapses `PanelType`/`PanelBindingSpec` into the new
   `kind` discriminator — if the resulting type is renamed (e.g.
   `PanelKind`) or its `fromString`/`asString` signatures change, these two
   literal marker strings must be updated in the same commit, or
   `extractBetween` throws before any comparison runs.
3. **The four `panelTypeSurfaces` JSON pointers (`:232-263`).**
   `create-panel-request.schema.json`, `panel.schema.json`, and
   `update-panels-batch-request.schema.json` are all read at
   `["properties","type","enum"]` (or nested to the same leaf); task 5.2
   renames that field to `kind` for all three, so `getEnumAt`'s path array
   must be re-pointed to `["properties","kind","enum"]` (and the batch
   pair's nested equivalent) in the same commit as 5.2 itself — not as a
   trailing fixup.
4. **`schemas/dashboards/dashboard-proposal.schema.json`
   (`$defs.ProposalPanel.properties.type.enum`) is compared against
   `agentFacingPanelTypes` (canonical kinds minus `divider`) and appears in
   no task in rounds 1-2.** The spec's own "P1.4 owns proposal schemas" line
   does not exempt this file from `check-schema-drift.mjs`, which runs
   unconditionally on every commit regardless of which ticket "owns" the
   eventual full proposal rewrite — the moment `PanelType`'s arm set
   changes, this pointer goes stale and the gate fails on P1.1's own commit
   unless P1.1 also updates this one enum list. **Decision:** update only
   this file's `type.enum` array to the new kind set in the same commit as
   3.6/5.2 (task 5.7 below) — this is the same class of minimal/mechanical
   edit as the other cross-surface arrays, not a proposal-schema rewrite;
   P1.4 still owns every other change to this schema (new fields, new
   validation rules, the rest of its shape).
5. **`DataPanelKinds` is NOT a passive constant list — it is a live backend
   validation predicate, and retargeting it to the Output-kind set (as
   round 3 originally planned) silently inverts that validation.** Verified
   directly against the live tree (round 4): `DataPanelKinds` is consumed at
   `ProposalPanelSupport.scala:37` (`if (DataPanelKinds.contains(panel.type)
   && panel.dataTypeId.isEmpty)` — rejects an unbound data panel),
   `ProposalPanelSupport.scala:157` (binding-vs-config precedence), and
   `CombinedProposalService.scala:123` (`!DataPanelKinds.contains(panel.type)
   && …` — the dangling-sentinel-ref guard), covered by
   `CombinedApplyProposalDanglingRefSpec.scala:39` (task 6.4 requires this
   spec green). After tasks 3.6/5.2 collapse the panel discriminator to
   `kind ∈ {output, text, markdown, image, divider}`, a naive
   `DataPanelKinds = Set("metric","chart","table","collection","timeline")`
   retarget (the live value has no `markdown` arm today) would make
   `DataPanelKinds.contains(panel.type)`
   **false for every data panel** (they are all `kind = "output"` now) and
   **true for none of them** (none of the five surviving panel-kind values
   match any of the five stale visualization-kind strings) — silently
   disabling the unbound-panel rejection entirely. **Decision:** `DataPanelKinds`
   becomes `Set("output")` — the single panel *kind* that requires an
   Output binding — not the old Output-*visualization*-kind enumeration;
   all three Scala call sites keep their existing logic and existing field
   name **byte-for-byte unchanged** — `ProposalPanel.type` keeps its name
   (round-4 finding: `panel.kind` does not exist and renaming it would
   collide with the P1.4-owned boundary on `dashboard-proposal.schema.json`);
   only `DataPanelKinds`' own *value* moves from the six visualization kinds
   to `Set("output")`, since `panel.type` now carries the placement
   discriminator (`output|text|markdown|image|divider`) rather than a
   visualization type. The set membership test itself is untouched. The two
   `.ts` mirrors (`proposalValidation.ts:19`'s `DATA_PANEL_TYPES`,
   `ProposalReview.tsx:29`'s `DATA_PANEL_TYPES`, also read at `:60,146`)
   follow the identical `["output"]` value, not the six-visualization-kind
   set. `CombinedApplyProposalDanglingRefSpec.scala:39` and any other spec
   asserting today's `DataPanelKinds` membership (e.g. `chart` panel
   behavior) must be updated to assert on `kind = "output"` instead — named
   explicitly in task 3.10 below, not left implicit.

Every one of these five items is added as its own line in task 5.7 (revised
below) rather than left as a single "update the drift script" bullet — the
round-2 finding's whole point was that a bullet-level task hides exactly
this kind of line-level breakage.

- **What does it execute?** A Node script that walks `schemas/**/*.json`,
  resolves each schema's `title` against a Scala protocol case class under
  `backend/src/main/scala/com/helio/api/protocols/**`, hard-exits if the
  panel-kind arm count (across the backend protocol AND the four
  cross-surface files above) falls out of sync, and is itself invoked by
  `.husky/pre-commit` alongside `check:helio-mcp-types`, `typecheck`, and
  `npm test` — all of which also run on every commit and must stay green.
- **What environment does it inherit, and from where?** Whatever `node`
  and working directory the invoking `git commit` runs in — no shell-out to
  `sbt` or a database; a filesystem walk over `schemas/` plus a regex/text
  scan of the backend source tree AND the four named
  frontend/helio-mcp files.
- **Does it write anything outside its own sandbox?** No — it only reads
  `schemas/`, backend source files, and the four named frontend/helio-mcp
  files, and exits non-zero on mismatch; it writes no files.
- **Does it behave differently from a linked worktree than from a main
  checkout?** No — it only reads paths relative to the repo root the commit
  runs in, which resolves identically whether that root is a linked
  worktree or the main checkout.
- **What happens on its first run after this ticket's changes?** It must
  find the reshaped panel-kind schema, the updated backend arm count, AND
  the four cross-surface files' updated kind lists, all in the same commit
  — there is no transitional state where old and new shapes are both
  accepted (decision 11 forbids a dual-read path). The executor updates the
  script's hardcoded file list/arm count and all four cross-surface
  constant lists in the exact same commit as the schema reshape, never a
  following one, or every subsequent commit in this ticket fails
  pre-commit. `check:helio-mcp-types` and frontend `typecheck` must also
  stay green after this narrow edit — a bare string-array change satisfies
  both without needing the full P1.4/P1.5 rewrites.

### Decision: scope of the backend proposal services this ticket must touch

Skeptic finding 3 (round 1) identified `PipelineProposalService`,
`ProposalPanelSupport`, and `DashboardProposalService` as live backend
consumers with no owner in the original plan — these are backend Scala
services (not the frontend/MCP proposal *authoring* surface, which stays
out of scope per P1.4/P1.5). Since they import `DataTypeService`/
`MetricRepository` directly, the backend will not compile unless they are
rewired. **Decision:** rewire these to the minimum needed for compilation
and for `sbt test` green — proposal apply creates an Output on the
pipeline's last trunk step instead of minting a DataType/binding a metric,
using the same lifting logic as the migration's own bound-panel-to-Output
step (see ticket.md's data-move step 10b) — without building new
grounding, review-page rendering, or MCP tool changes (those remain P1.4's
job, and the frontend review page is expected non-functional until P1.5/
P1.6 per decision 17). This is "make it compile and behave sanely," not
"build the P1.4 Outputs-proposal feature early."

### Decision: `ProposalPanelSupport`'s other kind-valued predicates are retired, not retargeted

Round 4 finding 2: `DataPanelKinds` was not the only predicate over
`panel.type` in this file that silently breaks once `panel.type`'s value
domain becomes the placement-kind set. Its siblings —
`ProposalPanelSupport.scala:39,49` (`panel.type == "chart"`, gating
`validateChartType`/`ChartPanel.rejectsAggregation`), `:46,217`
(`== DashboardProposalService.TimelineKind`, gating timeline `sort`
validation/config derivation), `:209` (`== MetricKind`, gating
label/unit derivation), and `:136`
(`MetricIdSupportedKinds`, `DashboardProposalService.scala:219`) — all
test for a specific pre-collapse visualization type on the panel itself.
**Decision:** since this ticket's proposal-service rewire is explicitly
scoped to "make it compile and behave sanely," not rebuild proposal-time
Output-kind-aware validation (that grounding work, keyed to the target
node's projected schema, is P1.4's stated job — see the Agent/MCP surface
section of the design spec), these five checks are **deleted outright**
along with the code paths they guard (chart-type validation,
aggregation-rejection, timeline-sort validation/derivation, metric
label/unit derivation, and `MetricIdSupportedKinds` itself) rather than
retargeted to a value that no longer exists on the panel. This is
consistent with decision 11 (no dead/dangling checks) and with the ticket's
own framing that a panel no longer carries visualization-kind information —
that now lives on the Output's `OutputKind`/config, set at Output-creation
time, which this ticket's minimal proposal rewire does not attempt to
validate against (P1.4 does). Named explicitly as task 3.10a below so it is
not left implicit inside 3.9's "rewire panel resolution to Outputs."

### Decision: `PanelCapabilityService` is KEPT and rewired, not deleted

Round 2's skeptic claimed `PanelCapabilityService`'s only live callers were
`ApiRoutes.scala:267` and `DataTypeRoutes.scala:12`, both deleted, and
recommended deleting the service outright. **Verified independently
(rounds 3 and 4, `grep -n "PanelCapabilityService"` across
`backend/src/main/scala/com/helio`): that claim was wrong.** It is a live
constructor dependency of `RefinementGrounding.scala:46`,
`AssistantService.scala:43`, `AssistantToolExecutor.scala:46`, and
`DashboardAuthoringService.scala:53` — none of which this ticket deletes.
**Decision:** keep `PanelCapabilityService`, rewire its capability
computation to resolve against a pipeline node's Outputs instead of a
DataType; only the public route it used to back
(`GET /api/types/:id/panel-capabilities`, deleted with `DataTypeRoutes`)
and `PanelCapabilityProtocol`'s route-facing wire shape are retired. Its
**test-side blast radius is real and must be owned too** (round 4 finding):
12 backend spec files construct `new PanelCapabilityService(dataTypeRepo,
dataTypeRowRepo)` with the two repositories task 4.1 deletes —
`AssistantToolExecutorSpec:66`, `AssistantServiceSpec:139`,
`RefinementRoutesSpec:114`, `RefinementServiceSpec:127`,
`DashboardAuthoringRoutesSpec:112`, `DashboardAuthoringServiceSpec:120`,
`AuthoringTelemetrySpec:117`, `ResourceTaggingSpec:125`,
`DataTypeDataSourceAclSpec:128`, `PipelineRunServiceSpec:1092`,
`PanelCapabilityServiceSpec:58`, `DataTypeRoutesSpec:78` (the last two are
themselves deleted alongside their subjects; the other ten belong to
services that survive and must be rewired to the new constructor — see
task 3.11a below). Stale doc comments at `PanelBindingSpec.scala:32,103-119`
and `PanelCapabilityProtocol.scala:8` referencing the old introspection
endpoint should be updated in the same pass, not left dangling.

## Risks / Trade-offs

- **Largest single migration in the repo's history** (two tables dropped,
  one column set dropped from a populated `panels` table, three FKs
  re-keyed) — mitigated by the red-first fixture test and the RLS smoke
  test being run against a dev-DB-shaped fixture, not a toy one, plus the
  skeptic's mandate to verify against a real database rather than by
  reading SQL.
- **Shared dev Postgres DB across worktrees** — this ticket's migration
  runs against the same dev DB every other in-flight worktree's backend
  connects to. If `flyway_schema_history` looks poisoned by another
  branch's migration, that must be diagnosed before assuming this change
  is broken (see `project_shared_dev_db_flyway_collision_hazard`); the
  executor/evaluator must not leave the shared dev DB in a state that
  breaks other branches (e.g. must not merge V94 into dev's applied
  history if this PR is abandoned).
- **~78-file consumer deletion is easy to leave partially done** — the
  ticket's own `grep` acceptance criterion is the objective proof; the
  evaluator and skeptic both re-run it verbatim rather than trusting a
  file list in the PR description.
- **Frontend/MCP breakage is expected, not a regression** — the evaluator
  must not flag "frontend doesn't compile against the new API" as a
  defect; the UI gate is explicitly N/A for this row (decision 17).

## Decision: four named wire-field-NAME exemptions from the 6.1 grep (plus one wire-VALUE exemption), all P1.4/P1.5-owned surfaces

Cycle 28's execution-cycle audit found `model.scala` still DEFINING (not just historically
mentioning) `DataTypeId`/`MetricId`/`DataType`/`ComputedField`/`MetricDefinition`/`MetricFormat`/
`MetricAggregation`/`MetricUsagePanel`/`MetricUsage`, plus internal call sites
(`PanelCapabilityService`, `IdParsing`, `RefinementGrounding`, `DashboardAuthoringService`,
`AssistantToolExecutor`) still threading `DataTypeId(...)` wrappers — traced to task 3.11's own
tasks.md entry deferring the retarget to "section 4/5's wire-shape-renaming job," a task that was
never actually written anywhere in tasks.md. The coordinator ruled (cycle 28→29 handoff): close
this gap now, IN THIS TICKET, with named exemptions for wire FIELD NAMES (not types) —
everything else in that list is retargeted onto `OutputId`/deleted outright in cycle 29.

(Final-gate wire-contract-diff skeptic, round 1: the original "exactly two" framing was
incomplete — two more field-name sites of the identical shape, plus one wire VALUE, were found
still standing at HEAD and are added below as Exemptions 3-4 and a fifth value-exemption. Nothing
here required a code change; this closes a documentation gap only.)

**Exemption 1 — `PipelineProposalProtocol.PipelineProposalApplyResponse.outputDataTypeId` /
`PipelineProposal.outputDataTypeName`.** These are wire FIELD NAMES on the agent-facing pipeline-
proposal-apply response/request, not a `DataTypeId`-typed value (the field itself is `String`).
Per this design.md's own "scope of the backend proposal services this ticket must touch" decision
above, the agent-facing proposal wire contract is P1.4's territory ("make it compile and behave
sanely," not rebuild the Output-proposal feature). Renaming the field now would not defer work to
P1.4 — it would hand P1.4 a wire contract it never agreed to, and helio-mcp/frontend proposal-flow
code (explicitly out of scope here, see ticket.md's "Out of scope" section) already depends on the
current field name. Exempt; P1.4 renames it if/when it rebuilds that surface.

**Exemption 2 — `WorkspaceContextProtocol`'s `WorkspaceContextJoinHint.leftDataTypeId`/
`rightDataTypeId` and `WorkspaceContextPipeline.outputDataTypeId`/`outputDataTypeName`.** Same
class of problem, wider blast radius: these are `GET /api/workspace/context`'s wire field names
(all typed `String` internally — `WorkspaceContextService`'s own `JoinCandidate.dataTypeId: String`
confirms there is no `DataTypeId`-typed value anywhere in this path to retarget, only a naming
convention), and this endpoint is the exact payload helio-mcp's `get_workspace_context`-style tools
and multiple frontend pipeline/panel pages already parse by these literal key names (confirmed:
`grep -rln outputDataTypeId helio-mcp/src frontend/src` returns 30+ files, none of which this
ticket may touch per its "Out of scope" section and per P1.5/P1.6's named ownership of those
pages). Renaming these field names now would require touching dozens of P1.4/P1.5/P1.6-owned files
in the SAME commit to keep the tree compiling/passing, which is a scope violation this ticket must
not make unilaterally. Exempt for the same reason as Exemption 1 — the owning ticket renames it
when it touches that surface, if it chooses to.

**Exemption 3 — `PipelineAnalyzeProposalProtocol.PipelineAnalyzeProposalResponse.outputDataTypeName`.**
Live response field on `POST /api/pipelines/analyze-proposal` (`PipelineAnalyzeProposalProtocol.scala:16`,
`jsonFormat4`). Same class as Exemption 1 — a `String`-typed wire field name on an agent-facing
pipeline-analyze surface, not a `DataTypeId`-typed value. This response feeds the same
proposal-apply flow Exemption 1 already covers; renaming it here without also renaming
Exemption 1's sibling field in the same commit would leave the two inconsistent for no reason.
Exempt for the same reason and under the same P1.4 ownership as Exemption 1.

**Exemption 4 — `AssistantProposalToolSchemas`'s `"outputDataTypeName"` property/`required` entry.**
`AssistantProposalToolSchemas.scala:160,171,174,192` mirrors Exemption 3's field name into the
Claude-facing tool-call JSON schema (an agent-facing wire surface in its own right, not a code
comment). It exists specifically so the tool-call shape stays consistent with the HTTP response it
describes (Exemption 3) — renaming one without the other would break that consistency, and this
mirror is generated from/kept in lockstep with the same P1.4-owned surface. Exempt for the same
reason.

**Value-exemption — the `"dataType"` `WorkspaceResourceType`/`resourceType` wire value.** Distinct
from the four field-NAME exemptions above: this is a wire VALUE (`WorkspaceResourceType.DataType`,
`WorkspaceResourceSearchProtocol`'s `"dataType"` discriminator), not a field name, so it falls
outside the literal scope this decision's title originally described. `WorkspaceSearchService`
still emits `resourceType = "dataType"` search results — now sourced from `OutputRepository`
rather than the deleted `DataTypeRepository` — as a deliberate transitional label (see the
`workspace-resource-search` spec delta, corrected alongside this decision in the same skeptic
round). Renaming this value has the identical 30+-file frontend/MCP blast radius as Exemption 2
(`grep -rln resourceType.*dataType\|'"'"'dataType'"'"' helio-mcp/src frontend/src` overlaps heavily
with Exemption 2's file set) and the identical P1.4/P1.5 ownership boundary. Exempt for the same
reason as Exemption 2 — the owning ticket renames it when it touches that surface, if it chooses
to.

**What IS retargeted in cycle 29 (not exempt):** `PanelCapabilityService.getCapabilities`'s public
parameter (now `OutputId`, was `DataTypeId`) and its three internal call sites
(`RefinementGrounding`, `DashboardAuthoringService`, `AssistantToolExecutor`) — these are
backend-internal-only, zero external wire impact, confirmed by grep before renaming
(`getCapabilities` has no route wired to it at all; the route it originally backed,
`GET /api/types/:id/panel-capabilities`, was already deleted alongside `DataTypeRoutes` in task
4.1 — several doc comments had gone stale still claiming it was "still-live," corrected in cycle
29). `IdParsing.DataTypeIdSegment`/`MetricIdSegment` deleted outright (zero remaining callers).
`model.scala`'s `DataTypeId`/`MetricId`/`DataType`/`ComputedField`/`MetricDefinition`/
`MetricFormat`/`MetricAggregation`/`MetricUsagePanel`/`MetricUsage` all deleted outright (all were
either fully dead — `DataType`'s only consumer, `PipelineAnalyzeService.deriveSourceSchema`, had
zero callers anywhere and was deleted alongside it — or test-fixture-only, retargeted to plain
`String` ids since every consumer only ever read `.id.value`/`.value`). `PanelCapabilityService`
itself is KEPT, not deleted, per task 3.11's own precedent ("if callers are all retargeted or
deleted, prefer deleting outright over rewiring into orphanhood") — re-verified fresh in cycle 29:
it has 4 live internal callers (`RefinementGrounding`, `DashboardAuthoringService`,
`AssistantToolExecutor`, `AssistantService`'s constructor injection), none of which this ticket
deletes, so deleting the service itself would be the "orphanhood" it is NOT in.
