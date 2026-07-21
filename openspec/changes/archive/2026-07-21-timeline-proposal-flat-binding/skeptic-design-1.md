## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **Scope correctness — is the diagnosed gap real, and is the scope right-sized?**
   - `backend/src/main/scala/com/helio/services/DashboardProposalService.scala:342` —
     `DataPanelKinds: Set[String] = Set("metric", "chart", "table", "collection", "timeline")`.
     Confirms `timeline` is already a recognized data-panel kind (HEL-317's stretch scope), so a
     flat `dataTypeId` + `fieldMapping` binding already applies today — the plan's premise holds.
   - `schemas/dashboard-proposal.schema.json` `$defs.ProposalPanel.properties.type.enum` already
     includes `"timeline"`.
   - `helio-mcp/src/tools/proposal.ts`: `DATA_PANEL_TYPES` (line 22) and `PANEL_TYPES` (line 34)
     already include `"timeline"`; the `propose_dashboard` description (lines 131-133) already
     documents timeline binding — but tells the agent to reach `sort` only via
     `config.timelineOptions.sort`, never as a flat field. `helio-mcp/src/types.ts` `ProposalPanel`
     interface (lines 226-243) has no `sort` field.
   - `buildDataConfig` (`DashboardProposalService.scala:239-250`) derives `dataTypeId`/`fieldMapping`/
     `aggregation` for all `DataPanelKinds`, and `label`/`unit` only for `metric` — there is no
     per-type branch for `timeline`'s `sort` today. This is the one genuine remaining gap.
   - Conclusion: the claim is accurate — the only real gap is the flat `sort` field, and the scope
     (add `sort` end-to-end, nothing else) is correctly sized to it, not over- or under-scoped. The
     design's explicit non-goals (no `create_panel`/`bind_panel` changes, no frontend UI/renderer
     work) are consistent with what I verified is already in place.

2. **Derivation approach — nesting into `timelineOptions`, not a flat key.**
   - `backend/src/main/scala/com/helio/domain/panels/TimelinePanel.scala`:
     `TimelinePanelConfig.decodeInternal` reads `sort` exclusively via
     `timelineOptionsField(fields, strict)` → `fields.get("timelineOptions")` (lines 57-61), which in
     turn reads `sort` from *that* nested object's fields (line 47-55, `sortField`). There is no
     top-level `sort` key read anywhere in the decoder. A flat `sort -> JsString(...)` on the
     top-level derived config would be silently ignored by `decodeCreate`.
   - The design's D1 (`buildDataConfig` emits `"timelineOptions" -> JsObject("sort" -> ...)`, NOT a
     flat key) is therefore the only correct approach — confirmed against the actual decoder, not
     assumed.
   - `TimelineOptions.ValidSorts = Set("asc", "desc")`, default `"asc"` (`TimelineOptions.scala:18-19`)
     — matches the design's/spec's stated values exactly.

3. **Schema-drift safety.**
   - `scripts/check-schema-drift.mjs` lines 111-126: for every `*.schema.json` file, `schemaProps`
     (schema `properties` keys) is diffed against `classFields` (case-class param names parsed from
     `DashboardProposalProtocol.scala` etc.) and any asymmetry (`missingInClass` / `missingInSchema`)
     is a hard error. This directly confirms the design's claim that `sort` must be added to BOTH
     `ProposalPanel` (case class) and `dashboard-proposal.schema.json` to stay green — verified
     against the actual script logic, not asserted.
   - `DashboardProposalProtocol.scala` shows the exact read/write pattern an optional string field
     like `sort` must follow (e.g. `orientation`/`chartType`, lines 61-62/83-84) — task 1.1 correctly
     targets this file and pattern.

4. **Backward-compat / `mergeConfig` interaction.**
   - `mergeConfig` (`DashboardProposalService.scala:222-237`) does a shallow `JsObject(d.fields ++
     c.fields)` merge, so an explicit `config.timelineOptions` passthrough object fully replaces the
     derived `timelineOptions` key (whole-key overwrite, not deep-merge) — this is the same mechanism
     already governing every other derived/passthrough interaction (e.g. metric `label`/`unit` vs.
     `config`), so D3 ("explicit config still wins... no change to mergeConfig") is verified true by
     the existing code, not a new invariant needing new code.
   - Frontend: `frontend/src/features/dashboards/ui/ProposalReview.tsx` state (`panels`) is a plain
     JS array of the exact proposal-JSON panel objects (`useState<ProposalPanel[]>(proposal.panels)`,
     `updateTitle` spreads `{ ...p, title }`). Even though `frontend/.../types/proposal.ts`
     `ProposalPanel` interface doesn't declare `sort` (or even `config`/`aggregation` — a pre-existing
     gap, not introduced by this change), the runtime objects retain any extra JSON fields through
     the spread, so a flat `sort` would round-trip through Accept unedited. This substantiates the
     design's non-goal ("no Proposal Review UI field work... UI round-trips proposal JSON unchanged")
     rather than leaving it as an unverified assumption.

5. **Spec delta correctness.**
   - `openspec/specs/mcp-panel-composition-tools/spec.md` (base) has no existing requirement about
     timeline flat-binding parity (checked full requirement list) — so the delta's `## ADDED
     Requirements` framing is correct (not a `MODIFIED` case masquerading as `ADDED`, nor duplicating
     an existing requirement).
   - `openspec/specs/timeline-panel-type/spec.md` documents the config/persistence contract
     (`sort`, `ValidSorts`, PATCH absent-vs-null) and does not conflict with or duplicate the new
     proposal-flow requirement.
   - The delta's 5 scenarios (flat-only binding, flat `sort`, invalid `sort` → 400, config-wins
     override, MCP/schema advertise `sort`) are each independently testable and map 1:1 onto
     `tasks.md` §3's test list (3.1–3.5) and the ticket's 3 ACs. No scenario is untestable or
     ambiguous.
   - `PanelConfigCodec.scala` exists at the referenced path, substantiating the design doc's claim
     that derived config is "decoded by the same panel-create path (`PanelConfigCodec`)".

### Verdict: CONFIRM

No placeholders, no internal contradictions between ticket/proposal/design/tasks, no scope drift
(non-goals are honest and verified against the actual code — the frontend and `create_panel`/
`bind_panel` genuinely need no changes), and no AC left uncovered by a task. The one implementation
detail the design leaves implicit — `RequestValidation.scala` currently has no import of
`com.helio.domain.panels.TimelineOptions`, so `validateTimelineSort` will need to add that import —
is a trivial, obvious-at-implementation-time detail, not a design flaw; not blocking.

### Non-blocking notes
- Design doc references `RequestValidation.validateChartType`/`validateDividerOrientation` as the
  precedent for `validateTimelineSort`; worth the executor double-checking the import path for
  `TimelineOptions.ValidSorts` into `RequestValidation.scala` (currently has no cross-package domain
  imports) when implementing task 1.2 — not a design gap, just a heads-up for smooth execution.
