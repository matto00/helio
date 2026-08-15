## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/workspace-resource-search/spec.md`, and
  `docs/superpowers/specs/2026-08-14-top-level-assistant-design.md` (canonical epic spec) in full.
- `openspec validate find-get-resource-tools --strict` → `Change 'find-get-resource-tools' is valid`.
- Read `WorkspaceContextService.scala` in full: confirmed `toDataSourceEntry`/`toDataTypeEntry`/
  `toDashboardEntry` are currently `private` (lines 237, 254, 716) and `buildPipeline` is already
  `private[services]` (line 196) — the visibility-widening plan (D2/tasks 1.1) targets exactly the
  three private converters and no others; no additional private member (e.g. the private constants,
  `classifySemanticRole`, `sanitizeSampleRows`, `computeColumnStats` — all already `private[services]`
  or used only internally by the three converters) is needed externally. **This part of the plan is
  accurate and sufficient.**
- Read `DashboardService.scala` (full) and `DataSourceService.scala` (full): confirmed neither exposes
  a `findById`/`findByIdOwned`-backed service method today — matches design.md's claim.
- Read `DataTypeService.scala`, `MetricService.scala`: confirmed both already have `findById` in the
  exact `Future[Either[ServiceError, T]]` shape the plan says to mirror.
- Confirmed via `grep` that `DashboardRepository.findByIdOwned` and `DataSourceRepository.findByIdOwned`
  already exist (so D3's new service-level wrappers are pure pass-throughs, no repo work needed).
- Read `ClaudeModels.scala`: confirmed `ClaudeTool(name, description, inputSchema: JsValue)` matches
  the plan's claim exactly.
- Read `WorkspaceContextProtocol.scala` (full): confirmed no `Metric`/metric-shaped type exists there
  at all — matches design.md's claim.
- Read `DataFieldType`'s actual pattern in `domain/model.scala` (the pattern D4 says `WorkspaceResourceType`
  mirrors): its cases (`StringType`, `IntegerType`, ...) are nested inside `object DataFieldType { ... }`,
  not top-level — so a same-named case (`DataSource`, `DataType`, `Dashboard`) nested inside
  `WorkspaceResourceType`'s companion object will not collide with the top-level domain classes of the
  same name (`domain.DataSource`, `domain.DataType`, `domain.Dashboard`) as long as call sites qualify
  references (e.g. `WorkspaceResourceType.DataSource`), which is the only way `DataFieldType` itself is
  ever used in this codebase. Not a blocker, but flagged as a non-blocking clarity note below.
- Checked every codebase precedent for `fromString`+companion-string-method (`DataFieldType`, `Role`,
  `PanelType`, `Severity`, `Comparator`, `ScheduleKind`, `AlertEventState`): all use `fromString`/
  `asString(x: X): String`, never `toString`. D4 says "`fromString`/`toString`" — inaccurate relative to
  the very pattern it claims to mirror. Cosmetic, not blocking (see notes).
- Traced `getResource`'s per-type dispatch (design.md D1/D3, tasks.md 3.4/3.5) against the actual
  ownership semantics of each underlying lookup:
  - `DataTypeService.findById`, `MetricService.findById` → `findByIdOwned` (owner-only).
  - New `DashboardService.findById`/`DataSourceService.findById` (D3) → `findByIdOwned` (owner-only).
  - Pipeline path (design.md D1, tasks 3.4) → `PipelineService.findSummaryById`, whose own doc comment
    reads **"Sharing-aware read. Owner, editor, and viewer grantees can read."** (`PipelineService.scala:125`),
    backed by `PipelineRepository.findSummaryByIdShared` (`PipelineRepository.scala:124`), which checks a
    real `resource_permissions` grant (`PipelineRepository.scala:68/100-108`) — pipelines are one of only
    two resource types in this codebase with a real sharing model (the other being dashboards; confirmed
    via `grep -rn 'resourceType ===' backend/.../infrastructure/*.scala` — only `"dashboard"` and
    `"pipeline"` appear).
  - Cross-checked against `WorkspaceContextService.assemble`'s own pipeline listing:
    `pipelineService.listSummaries(user)`, whose repo doc comment reads **"Owner-scoped list summaries —
    only returns pipelines owned by the caller"** (`PipelineRepository.scala:336-338`) — i.e. `assemble`
    itself never surfaces a shared-but-unowned pipeline in the first place, unlike `findSummaryById`.
- Confirmed `PipelineSummaryResponse.ownerId: Option[String]` is populated by `toSummaryResponse`
  (`PipelineService.scala:667-678`), so a post-fetch ownership check is a feasible, low-cost fix if this
  gets addressed at implementation time.
- Re-read ticket.md's Scope section (`ticket.md:17-20`): `find` is explicitly specified to return
  "compact summaries ... for **top-K matches**." Re-read design.md's D1 (`design.md:34-41`)/Risks
  (`design.md:96-98`) and tasks.md 3.2 (`tasks.md:34-37`): neither defines a K, a ranking order, or any
  truncation of `find`'s output — the only cap mentioned anywhere is `Page.Default` (200) applied
  *per resource type* to the *candidate* lists `find` scans, not to the *result set it returns*. A
  broad query (e.g. a single common letter) could therefore return up to 5 × 200 = 1000 summaries.

### Verdict: REFUTE

### Change Requests

1. **`getResource`'s pipeline dispatch uses a sharing-aware lookup, contradicting both the spec's own
   NotFound contract and the ticket's "same detail WorkspaceContextService already assembles" charter.**
   `spec.md:24-31`'s Requirement states `getResource` "SHALL return `Left(ServiceError.NotFound(_))` for
   an id that doesn't exist or **isn't owned by `user`**, never an exception," and the accompanying
   Scenario (`spec.md:38-41`) is literally "exists but is owned by a different user → NotFound." Design.md
   D1/D3 (`design.md:34-54`) has `getResource`'s pipeline case reuse `PipelineService.findSummaryById`,
   which is explicitly sharing-aware (owner **or grantee**) per its own doc comment — the only one of the
   5 dispatch paths that is not owner-only. This is a real behavioral inconsistency, not just a wording
   nit: a pipeline shared with (but not owned by) the caller would return `Right` from `getResource`,
   violating the AC as literally written, **and** it would expose detail for a pipeline that
   `WorkspaceContextService.assemble` itself would never have surfaced to that caller in the first place
   (its own pipeline listing, `pipelineService.listSummaries`, is owner-scoped-only — confirmed via the
   repository doc comment). Required: either (a) make the pipeline `getResource` path owner-scoped too
   (e.g. filter `findSummaryById`'s result by `summary.ownerId.contains(user.id.value)` before returning
   detail — `PipelineSummaryResponse.ownerId` is already populated, so this needs no new repo method), or
   (b) if sharing-aware access is intentionally desired for `get_resource` here, say so explicitly in
   design.md and spec.md (naming the exception and updating the Scenario text/AC wording), and explain
   why this diverges from `find`'s owner-only pipeline listing and from every other resource type's
   strictly owner-only `getResource` path. Silently shipping the current mismatch will produce either a
   test (tasks.md 5.5) that doesn't actually validate the AC's stated claim for the pipeline case, or a
   test that fails against D1's own chosen implementation.

2. **`find` has no top-K bound, contradicting the ticket's own scope commitment and the epic's core
   motivation.** `ticket.md:17-20` explicitly promises "compact summaries ... for **top-K matches**."
   Neither design.md's D1 (`design.md:34-41`) nor its Risks section (`design.md:96-98`, which only
   discusses the *candidate-scan* bound of `Page.Default` per type, not the *returned result count*) nor
   tasks.md's 3.2 (`tasks.md:34-37`, "case-insensitive substring match... map to
   `WorkspaceResourceSummary`" — no truncation/sort step) define what K is, how results are ranked, or
   how the result set is bounded. As written, a broad substring query can return up to 1000 summaries
   (5 types × `Page.Default` 200 each) with no cap — directly undermining this ticket's own stated
   purpose (avoiding `WorkspaceContextService`'s unbounded eager dump; see ticket.md's Description and
   the canonical epic spec's Motivation §2, "Context-cost ceiling"). The canonical epic spec explicitly
   flags "exact `find` ranking/matching algorithm... when result counts are large" as an open question
   (`docs/superpowers/specs/2026-08-14-top-level-assistant-design.md:107`) — but that's about *ranking
   quality*, not about whether a bound exists at all; this ticket, as the one implementing `find`, still
   needs to pick *some* concrete result cap (a documented tunable constant, mirroring
   `WorkspaceContextService`'s own style of named, doc-commented bounds like `SampleRowLimit`/
   `MaxJoinHints`) before implementation, not defer it. Required: add a named top-K constant and a
   truncation/sort step to design.md D1 (or a new decision) and tasks.md 3.2, and add a spec.md
   scenario/AC covering the truncation behavior (e.g. "a query matching more than K resources returns at
   most K summaries").

### Non-blocking notes

- D4 (`design.md:56-65`) says `WorkspaceResourceType` should have `fromString`/**`toString`**, but every
  existing `fromString`-paired codebase precedent (`DataFieldType`, `Role`, `PanelType`, `Severity`,
  `Comparator`, `ScheduleKind`, `AlertEventState`) uses `fromString`/**`asString`** as a companion-object
  function, never an `Object.toString` override. Cosmetic — worth aligning the decision text with the
  pattern it claims to mirror so the executor doesn't invent a third convention.
- D4 also states "The tool-schema layer (`WorkspaceAssistantTools`) is what actually receives Claude's
  raw string `type` argument and calls `WorkspaceResourceType.fromString`..." — but tasks.md section 4
  only creates two static `ClaudeTool` values (schema definitions), and the ticket repeatedly states "No
  executor wiring here — HEL-662 owns turning a parsed `tool_use` call into a `WorkspaceSearchService`
  invocation" (design.md Non-Goals, proposal.md). D4's prose reads as if `WorkspaceAssistantTools` itself
  performs runtime parsing/dispatch, which tasks.md doesn't actually build. Worth rewording D4 to
  attribute that behavior to the future HEL-662 executor rather than to this ticket's schema object, so a
  literal reading of design.md doesn't imply an extra (unbuilt) responsibility for `WorkspaceAssistantTools`.
- proposal.md's Impact section and design.md D7 both leave `WorkspaceAssistantTools`'s package
  undecided ("`com.helio.ai` or `com.helio.services`") — fine to leave as an implementation-time call,
  but worth picking one before tasks.md's 4.1 is executed to avoid a mid-implementation back-and-forth.
- Environmental note (not scored against this design): this worktree is missing several gitignored
  `scripts/concertino/*.sh` helpers present in the main checkout (`next-report-number.sh`,
  `persist-evidence.sh`, `emit-event.sh`, etc.) — I ran the main checkout's copy of
  `next-report-number.sh` pointed at this worktree's absolute change-dir path (a stateless, path-only
  script) to produce this report's filename, rather than guessing a fallback name.
