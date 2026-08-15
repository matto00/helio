## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and all four spec deltas
  (`patch-set-undo`, `patch-set-apply`, `patch-set-preview`, `mcp-patch-set-tools`) in full.
- Read `PatchSetApplyRollback.scala` in full (the load-bearing precedent) plus
  `PatchSetApplyTypes.scala`, `PatchSetApplyResolvers.scala` (partial, the
  `resolvePanelUpdate`/`resolvePanelDelete`/`buildDashboardUpdateResolved` construction sites),
  `PatchSetApplyForward.scala`, `PatchSetApplyService.scala`, and `PatchSetApplyServiceJson.scala`.
- Confirmed `RootJsonFormat[XResponse]` is genuinely bidirectional for every kind D5 relies on:
  `panelResponseFormat` (`PanelProtocol.scala:169`, `jsonFormat9`), `dashboardResponseFormat`
  (`DashboardProtocol.scala:208`, `jsonFormat6`), `dataTypeResponseFormat`
  (`DataTypeProtocol.scala:65`, `jsonFormat9`), `pipelineSummaryResponseFormat`
  (`PipelineProtocol.scala:82`, `jsonFormat11`), `dataSourceResponseFormat`
  (`DataSourceProtocol.scala:411`, hand-written `read`/`write`), and `pipelineStepResponseFormat`
  (`PipelineStepProtocol.scala:238`, hand-written discriminated `read`/`write`). D5's claim holds.
- Field-by-field-checked every `fullXInverse`/`XCreateRequestFromPrior` builder in
  `PatchSetApplyRollback.scala` (lines 227–330) against the matching `XResponse` shape's fields —
  `PanelResponse`, `DashboardResponse`, `DataTypeResponse` all carry everything the domain-object
  builders need; no missing-field gap found for concern #1 as narrowly posed.
- Confirmed `EditOutcome.priorState`/`resultingState` really are response-shaped JSON (not a
  different shape) by reading the construction sites directly:
  `PatchSetApplyResolvers.scala:296-300` / `:323-327` (`priorStateJson = panelResponseFormat.write(...)`)
  and `PatchSetApplyForward.scala:30,36` (`resultingState = panelResponseFormat.write(...)`).
- Confirmed `resultingState` is `None` for every `delete` op (`PatchSetApplyForward.scala:33,45,63,75,83,95`
  — `edit.toOutcome("applied")` with no `resultingState` arg) — consistent with D4's "no live resource
  to conflict-check against" framing for delete-edit undo, narrowly.
- Traced the **conflict-detection JSON-equality mechanism (D4a)** against real dynamic/materialized
  fields in the response shapes it would compare, and found two independent, concrete false-positive
  sources (detailed in CR1 below) — `PipelineSummaryResponse.lastRunStatus/lastRunAt/lastRunRowCount`
  (`PipelineProtocol.scala:15-25`, populated from a persisted `pipelines.last_run_at` column per
  `PipelineRepository.scala:415`, updated on every run regardless of trigger source — the shipped
  HEL-340 scheduled-runs epic fires these independent of any patch-set edit) and
  `MetricPanelConfig.metricDeprecated`/effective `dataTypeId`/`fieldMapping`/`aggregation`/`unit`
  (`MetricPanel.scala:19-32`, doc comment: "always freshly recomputed... from the resolved metric's
  current deprecated flag... never decoded from client input" — confirmed never persisted, always
  materialized fresh from live `MetricDefinition` state at `PanelServiceHelpers.scala:272-296`).
- Confirmed `PatchSetReviewPage.handleAccept` navigates immediately after apply
  (`PatchSetReviewPage.tsx:79-80`, `await ...apply...; navigate("/")`) and that the shared `Toast`
  auto-dismisses after a **default 4000ms** unless an explicit `duration: 0`/longer is passed
  (`toastsSlice.ts:14`, `Toast.tsx:46-54`) — design.md/tasks.md specify no override for the new
  "Applied. Undo" toast.
- Confirmed the delete-edit rollback matrix's `unrecoverable` tier for dashboard/dataSource/
  dataType/pipeline (`PatchSetApplyRollback.scala:126-129,146-148,156-158,175-178`) and that these
  four kinds' `delete` op is a normal, fully-supported, fully-successful patch-set edit (not
  disallowed) per `PatchSetApplyForward.scala:44-45,62-63,74-75,82-83`.
- Confirmed V79 is genuinely the next unclaimed Flyway version (`ls backend/.../db/migration` tops
  out at `V78__refinement_conversations.sql`) and that `V77__authoring_conversations.sql` (not V78,
  which only `ALTER TABLE ... ADD COLUMN`s) is the actual RLS-establishing precedent design.md cites
  — a minor mis-citation, not a blocking issue.
- Confirmed `Toast`'s `action: {label, onClick}` genuinely exists (`Toast.tsx:68-72`), so D6's Toast
  claim itself is accurate; the gap is the missing `duration` override, not the component's capability.
- Confirmed `helio-mcp/src/tools/refinement.ts`'s existing `propose_patch_set`/`apply_patch_set`
  pair, matching D6's "joins" framing for the new `undo_patch_set` tool — no issue found there.

### Verdict: REFUTE

### Change Requests

1. **D4a's "current live state vs. `resultingState`, whole-JSON equality" conflict check is
   unsound — it will produce real false-positive conflicts (and possibly deterministic ones) that
   defeat undo for entire, already-shipped feature areas.** Two independently-verified, concrete
   mechanisms:
   - **Pipeline undo.** `PipelineSummaryResponse` (`PipelineProtocol.scala:15-25`) carries
     `lastRunStatus`/`lastRunAt`/`lastRunRowCount`, sourced from a persisted `pipelines` row column
     (`PipelineRepository.scala:415`) that updates on **every** pipeline run — scheduled (HEL-340,
     shipped), manual, or hook-triggered — entirely independent of any patch-set edit. A
     `pipelineUpdate` or `pipelineCreate` edit's `resultingState` freezes these fields at apply-time;
     any run of that pipeline before the user clicks Undo (near-guaranteed for a scheduled pipeline)
     will make a fresh fetch's `lastRunAt` differ, and D4a's whole-JSON equality check has no way to
     tell that from an actual conflicting edit. In practice, undo of any pipeline-name-change patch
     set on a scheduled pipeline will refuse with a false `409` almost every time.
   - **Metric-bound panel undo.** `MetricPanel.scala:19-32`'s own doc comment confirms
     `metricDeprecated` (and, when `metricId` is set, the effective `dataTypeId`/`fieldMapping`/
     `aggregation`/`unit`) are "always freshly recomputed... from the resolved metric's current
     `deprecated` flag... never decoded from client input" (`PanelServiceHelpers.scala:272-296`,
     `withMaterializedMetric`) — i.e. never persisted, always materialized fresh at read/resolve
     time. `PatchSetApplyForward`'s `PanelUpdate` case resolves this via
     `panelService.update`→`resolveSingleBinding` before capturing `resultingState`
     (`PanelService.scala:462`), but `PatchSetApplyResolvers.resolvePanelUpdate` captures
     `priorState` via a bare `ctx.panelRepo.findByIdInternal` (`PatchSetApplyResolvers.scala:282,298`)
     with **no** binding resolution. Design.md never specifies whether undo's "fresh fetch" of
     current live state (for the conflict check) goes through the resolved path or the bare-repo
     path. If it mirrors the resolvers' bare-repo pattern (the more likely naive implementation,
     since that's the only precedent in scope), the comparison is apples-to-oranges on *every*
     metric-bound panel's update-undo, independent of whether anything actually changed — a
     deterministic false conflict, not a rare edge case. If it instead threads a resolved fetch
     through, the comparison still false-positives whenever the bound metric's own definition
     changes between apply and undo (HEL-553/560, both shipped, make this a normal occurrence).
   - **Required revision:** D4a must specify field-scoped comparison — restrict conflict-check
     equality to exactly the fields each kind's inverse-builder actually restores (mirroring
     `fullPanelInverse`'s `title`/`appearance`/`config`-via-`fullConfigInverse` field set, `not`
     the raw response's server-materialized/dynamic fields like `lastRunStatus`/`lastRunAt`/
     `lastRunRowCount`/`metricDeprecated`/metric-derived effective fields) — or explicitly name and
     exclude the volatile fields per kind. A whole-JSON diff against a response shape that mixes
     user-edited state with server-computed state cannot be the conflict signal as currently
     specified.

2. **D4/D5's plan to reuse `PatchSetApplyRollback`'s per-kind `unrecoverable` tier for delete-edit
   undo directly contradicts the atomicity guarantee `specs/patch-set-undo/spec.md` formally makes,
   and tasks.md compounds the contradiction.**
   - `specs/patch-set-undo/spec.md:3-6` states undo "SHALL restore every edit in the named
     application to its pre-apply state ... or restore none of them" — a hard, binding, testable
     all-or-nothing requirement with no carve-out.
   - But `PatchSetApplyRollback.scala:126-129,146-148,156-158,175-178` marks dashboard/dataSource/
     dataType/pipeline `delete`-undo `unrecoverable` unconditionally (cascades, no recreate API) —
     and design.md D5 explicitly says undo's delete-edit case "reuses the SAME per-kind matrix" for
     this. A fully-successful application containing e.g. a `pipeline delete` edit (a normal,
     first-class, fully-supported op per `PatchSetApplyForward.scala:82-83` — not something
     pre-validation rejects) can **never** satisfy the spec's "restore every edit" requirement, by
     the design's own stated mechanism. Design.md never reconciles this: does Phase 1 detect a
     structurally-unrecoverable delete edit up front and refuse the *whole* undo before any
     mutation (treating it like a conflict, even though nothing "changed" — it was always
     impossible), or does Phase 2 charge ahead and return a mixed-outcome response (some edits
     `restored`, this one `unrecoverable`), silently breaking the promised guarantee? Neither
     design.md nor tasks.md 2.2/2.3 says.
   - `tasks.md:31` (5.3) makes this worse by *literally claiming the opposite of what the mechanism
     can deliver*: "undo restores every touched resource (panel/dashboard/dataSource/dataType/
     pipeline/pipelineStep, update+create+delete edits) to its pre-apply state" — this commits to a
     test asserting `delete`-edit-undo *restores* a dashboard/dataSource/dataType/pipeline, which
     the design's own reused matrix says is `unrecoverable` by construction. Tasks contradicts
     design here, not just an omission.
   - **Required revision:** design.md needs an explicit decision (mirroring D4b's "pick one and
     document it" rigor) for structurally-unrecoverable delete-edit-undo: most likely, Phase 1
     should detect any journaled `delete` edit whose kind is in
     {dashboard, dataSource, dataType, pipeline} and refuse the whole undo up front (consistent
     with the "refuse-with-error, never partial" philosophy D4b already establishes for
     conflicts) — but this must be stated, and tasks.md 5.3 corrected to test that outcome instead
     of claiming those four kinds' delete-undo "restores... to its pre-apply state."
   - This same gap also leaves **Phase 2 runtime-failure handling entirely unspecified** even for
     the panel/pipelineStep recreate case and for update-edit restoration: if a Phase-2 service call
     fails for a reason Phase 1's conflict check couldn't have caught (a genuine validation error, a
     missing parent resource for a delete-edit's recreate — e.g. the panel's dashboard, or the
     pipelineStep's pipeline, having been independently deleted since — which Phase 1 explicitly
     skips checking for delete-edit undo since "no live resource to conflict-check against"), does
     that abort/compensate everything already restored in that same call, or silently degrade to a
     mixed outcome exactly like #1's spec/mechanism gap above? Design.md needs to say.

3. **The in-app Undo toast's default 4-second auto-dismiss, combined with an immediate
   `navigate("/")`, makes the affordance impractical to use as specified.**
   `PatchSetReviewPage.tsx:79-80` calls `navigate("/")` immediately after `apply` resolves; the
   ticket's plan is to dispatch the "Applied. Undo" toast just before that call
   (design.md D6). `Toast`'s `duration` defaults to 4000ms unless the dispatcher explicitly passes
   `duration: 0` or a longer value (`toastsSlice.ts:14`, `Toast.tsx:46-54`) — design.md/tasks.md
   (task 3.2) don't mention overriding it. A user who has just clicked Accept, is mid-navigation to
   a different route, has roughly 4 seconds to notice and click "Undo" before the only surfaced
   affordance for undo vanishes — materially undercutting the "safety net" the ticket's own
   Description names as the point of this work. **Required revision:** design.md D6 / tasks.md 3.2
   should specify `duration: 0` (or an explicit, materially longer value) for this toast.

### Non-blocking notes

- Retention floor of 20 (D3) is a reasonable, well-hedged default and the pruned-id-404s-like-
  nonexistent behavior is clean — but given this codebase's own documented agent-driven usage
  pattern (propose/apply looped per-panel across many resources in one session, per project memory
  on the delivery-analytics dashboard build), 20 could plausibly be exhausted within a single
  agent session before a user acts on an early `applicationId`. Not a correctness bug (it's handled
  gracefully), just worth a one-line acknowledgment in design.md's Risks section rather than leaving
  it fully implicit.
- Design.md's D1 citation of "the same ... pattern as `V77__authoring_conversations.sql`/
  `V78__refinement_conversations.sql`" is slightly imprecise — `V78` only `ALTER TABLE ADD COLUMN`s
  onto the table `V77` created and RLS-enabled; `V77` alone is the actual RLS-establishing
  precedent. Cosmetic, not blocking.
- Worth double-checking during implementation (not a design blocker, since the existing
  `PipelineStepConfigCodec` path is a full-replace decode, not a patch/merge decode, so the
  Panel-specific omitted-Option-field bug class D5 calls out does not appear to apply to
  `fullPipelineStepInverse`/pipeline step configs) — confirmed by reading
  `PipelineStepConfigCodec.scala` and `PipelineService.scala:549-560`, no action needed here.
