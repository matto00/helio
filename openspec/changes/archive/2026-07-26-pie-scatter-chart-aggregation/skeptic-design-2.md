## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `skeptic-design-1.md` in full (both Change Requests) and the revised `design.md`, `tasks.md`,
  `proposal.md`, `ticket.md`, and both spec deltas.

**Round-1 Change Request 1 (apply-proposal coverage gap) — fix verified structurally sound, but incomplete (see new finding below):**
- Confirmed `ProposalPanel` (`backend/src/main/scala/com/helio/api/protocols/DashboardProposalProtocol.scala:15-42`)
  really does carry `chartType: Option[String]` and `aggregation: Option[JsObject]` as flat sibling fields —
  the design's "same-object check, no merge logic needed" claim is accurate for the ProposalPanel struct itself.
- Confirmed `ProposalPanelSupport.validatePanel` (`ProposalPanelSupport.scala:29-45`) is the function that
  already validates `chartType` enum validity, and is the natural place named in the revision.
- Confirmed `DashboardProposalService.apply` calls `validateStructure` (which loops
  `ProposalPanelSupport.validatePanel` per panel) at `DashboardProposalService.scala:54`, strictly *before*
  `dashboardService.create` is ever invoked (`createAll`, line 78) — a zero-write pre-pass, as claimed.
- Confirmed `DashboardContentsService.replaceContents` calls `validatePanels` (same
  `ProposalPanelSupport.validatePanel` loop, `DashboardContentsService.scala:56-61`) at line 40, strictly
  before `buildAndReplace`/`dashboardRepo.replaceContents` — also a genuine zero-write pre-pass.
- Both call sites are confirmed real, so extending `validatePanel` per the revision would genuinely close
  the specific gap round 1 identified (flat `chartType`/`aggregation` combination) for both apply-proposal
  and replace-contents in one edit, exactly as design.md now claims.

**Round-1 Change Request 2 (missing type-narrowing guard) — fix verified sound:**
- Confirmed `ChartPanel` is a concrete `final case class` with `object ChartPanel { val Kind: String = "chart"
  ... }` (`ChartPanel.scala:283-327`), and `PanelAppearance.chart: Option[ChartAppearance]` is a field on the
  shared `PanelAppearance` used by every panel kind (`domain/model.scala:130`) — so `existing match { case cp:
  ChartPanel => ...; case _ => Right(()) }` is valid, unambiguous Scala and correctly scoped. Design.md now
  states this guard explicitly as the "FIRST step" of `validateScatterAggregationConflict`, and tasks.md 1.4
  states it explicitly too. Confirmed `ResolvedPanelPatch.appearance: Option[PanelAppearance]` /
  `configPatch: Option[JsValue]` (`PanelService.scala:22-30`) match the fields design.md's formula references
  (`spec.appearance`, `spec.configPatch`). This Change Request is resolved.

**New finding — the apply-proposal/replace-contents fix checks the wrong representation and has a live
bypass via the existing HEL-316 generic `config` passthrough:**
- `ProposalPanelSupport.buildDataConfig` only folds `aggregation` into the derived config from the *flat*
  `panel.aggregation` field (`ProposalPanelSupport.scala:130-135`). `buildCreateRequest`'s `mergeConfig`
  then merges the caller-supplied generic `panel.config` passthrough **over** that derived config, with the
  passthrough winning on key conflict (`JsObject(d.fields ++ c.fields)`, `ProposalPanelSupport.scala:113-128`).
  `ChartPanelConfig.decodeCreate` reads `aggregation` straight off the top-level `config` JSON
  (`ChartPanel.scala:200-204`) — the same key the passthrough can set directly.
- This means a proposal panel can supply `{"title": "...", "type": "chart", "chartType": "scatter",
  "dataTypeId": "...", "config": {"aggregation": {"groupBy": "region", "agg": "sum", "yField": "sales"}}}`
  — i.e. `chartType: "scatter"` in the flat field (the only way to express chart type in a proposal) plus
  `aggregation` supplied via the generic `config` passthrough instead of the flat `aggregation` field.
- The new `ProposalPanelSupport.validatePanel` check (as specified: `panel.type == "chart" &&
  panel.chartType.contains("scatter") && panel.aggregation.isDefined`) inspects only the flat
  `panel.aggregation` field, which is `None` in this case — the check does not fire.
- I confirmed this passthrough mechanism is not hypothetical — an existing, passing test
  (`DashboardApplyProposalConfigSpec.scala:45-65`, "persist chart chartOptions from proposal config
  (HEL-316)") submits `"config":{"chartOptions":{"line":{"smooth":true}}}}` on a chart panel via
  apply-proposal and asserts it lands verbatim in the created panel's config — `"aggregation"` is exactly
  the same kind of top-level `ChartPanelConfig` key and would land identically.
- Net effect: the exact silent-ignoring failure mode Change Request 1 (round 1) described — a proposal's
  scatter+aggregation panel is created successfully with a default (non-scatter) appearance while
  `config.aggregation` is retained, and the follow-up `applyAppearance` PATCH that *would* 400 on this via
  the update-path check has its failure swallowed (`DashboardProposalService`'s
  `case Left(_) => acc :+ created`) — still reaches production via this one specific, real, already-exercised
  code path (`config` passthrough), on both apply-proposal and replace-contents, despite the round-1 fix.
- This is a genuinely new gap: round 1's report never considered the `config` passthrough vector at all (it
  focused solely on the flat-field combination), and the round-2 fix's chosen enforcement point (checking
  `ProposalPanel`'s flat fields, before `buildCreateRequest`'s merge) is structurally unable to see a
  passthrough-supplied `aggregation`. It directly reopens the ticket's "silent ignoring is the one outcome
  to rule out" requirement on the two write paths the ticket explicitly names.

**Sanity-check of unrelated areas (round 1 already traced these independently; confirming nothing broke):**
- D1 (pie data shape), D3 (backward compatibility), D4 (UI hiding), D5 (schema/MCP discoverability), and the
  ticket's HEL-365/`PanelBindingSpec` non-interaction claim are unchanged in substance from round 1 and were
  independently verified there against real code; nothing in this revision touches those files or claims.
  Re-skimmed them for internal consistency with the revised D2 — no contradictions found.

### Verdict: REFUTE

### Change Requests

1. **Close the `config`-passthrough bypass on the apply-proposal / replace-contents scatter+aggregation
   check.** `ProposalPanelSupport.validatePanel`'s new rule must not check only the flat
   `panel.aggregation` field — it must also treat a caller-supplied `panel.config` object's top-level
   `"aggregation"` key (the same key the generic HEL-316 passthrough can set, and the same key
   `ChartPanelConfig.decodeCreate` reads) as "aggregation present" for this check. Concretely, the
   aggregation-presence predicate should be something like: `panel.aggregation.isDefined ||
   panel.config.exists(_.fields.get("aggregation").exists { case o: JsObject => o.fields.nonEmpty; case
   JsNull => false; case _ => true })` (adjust semantics to match whatever "present, non-null" means
   elsewhere in this design) — or, more robustly, restructure the check to run *after*
   `ProposalPanelSupport.buildCreateRequest`'s config merge (on the actually-resolved `CreatePanelRequest`
   / merged `config` JSON) rather than on the pre-merge flat `ProposalPanel` fields, so it inherently can't
   diverge from what actually gets persisted. Update design.md's D2 ProposalPanel-paths bullet and tasks.md
   1.3a to state this explicitly, and add a test case to 5.6 covering a proposal/replace-contents panel that
   supplies `chartType: "scatter"` (flat) + `aggregation` via `config` passthrough (not the flat field) —
   this must also 400 the entire call with zero writes, mirroring the flat-field test case already planned.

### Non-blocking notes

- The round-1 fixes themselves (extending `ProposalPanelSupport.validatePanel` for the flat-field case, and
  the explicit `ChartPanel` type-narrowing guard for the update/batch-update path) are both correctly
  specified and verified against the real code — no further changes needed to those two items.
- Once Change Request 1 above is addressed, consider whether the same "check the actually-resolved value,
  not a pre-merge intermediate representation" principle should be called out as a general design note,
  since it's the root cause of both the round-1 finding and this round-2 finding (both stem from validating
  before `buildCreateRequest`'s config merge rather than after it).
