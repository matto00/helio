## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

1. **Round-2 finding 1 (spec.md/design.md contradiction) — fixed.** Re-read
   `specs/combined-proposal-apply/spec.md` in full. Requirement 2 ("Output-ref sentinel
   resolves before dashboard creation") now reads: "...the panel's flat `dataTypeId` if it
   holds the sentinel; otherwise, only when the panel's type is outside
   `DashboardProposalService.DataPanelKinds` (`metric`, `chart`, `table`, `collection`,
   `timeline`) AND the flat `dataTypeId` is absent, `config.dataTypeId`..." Requirement 3
   ("A dangling output ref creates nothing") now reads: "...appears anywhere in that panel's
   JSON representation other than the ONE position described in the [prior requirement]
   above for that panel's specific kind and flat-field state — a sentinel in
   `config.dataTypeId` on a `DataPanelKinds` panel, or on a panel whose flat `dataTypeId` is
   already set to something else, is dangling..." Both now state the kind-aware,
   absence-conditioned precedence, not the unconditional "either slot" framing round 1
   refuted and round 2 caught surviving into spec.md. Two new scenarios were added
   ("A sentinel in config.dataTypeId on a data panel kind is dangling" and "A sentinel in
   config.dataTypeId is dangling when the flat dataTypeId is already set") that mirror the
   kind-mismatch and shadowed-config cases exactly. design.md D2/D3 and tasks.md 4.2/4.3 all
   now use identical wording ("the flat `dataTypeId` is the blessed slot if it holds the
   sentinel; `config.dataTypeId` is the blessed slot ONLY when `panel.type` is outside
   `DataPanelKinds` AND the flat `dataTypeId` is absent (`isEmpty`)"). No remaining
   inconsistency across proposal.md/design.md/tasks.md/spec.md — all four now describe the
   same precedence in the same terms.

2. **Round-2 finding 2 (`orElse`-fidelity gap) — fixed, and independently re-derived against
   the real code, not just the design doc's restatement.** Re-read
   `ProposalPanelSupport.scala` fresh: `bindingCandidate(panel) = panel.dataTypeId.orElse
   (nonFlatConfigDataTypeId(panel))` (line 150-151), and `nonFlatConfigDataTypeId` (line
   153-158) returns `None` outright when `DashboardProposalService.DataPanelKinds.contains
   (panel.type)` — confirmed `DataPanelKinds = Set("metric", "chart", "table", "collection",
   "timeline")` at `DashboardProposalService.scala:200`. `Option.orElse`'s actual semantics
   (Scala stdlib): the alternative is evaluated **iff** the receiver is `None` — never
   because the receiver holds a non-matching value. design.md D2's revised text now branches
   on `panel.dataTypeId.isEmpty` (a real `Option.isEmpty` check, which is `true` iff `None`)
   before ever considering `config.dataTypeId`, and explicitly calls out that `Some("")` is
   still "present" (not absent) per this semantics — matching real `orElse` short-circuiting
   exactly (it evaluates on receiver-is-`None`, regardless of the value's content when
   defined). tasks.md 4.2/4.3 mirror the same `panel.dataTypeId.isEmpty` branch. Traced the
   exact round-2 counter-example (non-`DataPanelKinds` panel with a real, non-sentinel flat
   `dataTypeId` plus a dangling sentinel in `config.dataTypeId`) through the corrected
   algorithm: flat `!= sentinel` → first branch skipped; flat `.isEmpty` is `false` (it's
   `Some("real-id")`) → second branch's `AND` condition is false → `config.dataTypeId` is
   never cleared → the re-serialized cleared panel still contains the sentinel in
   `config.dataTypeId` → correctly rejected with `400`. This is precisely the new task 7.4c
   test scenario, and it now matches the corrected spec.md scenario "A sentinel in
   config.dataTypeId is dangling when the flat dataTypeId is already set."

3. **Re-traced every other case I could construct against the real `bindingCandidate`/
   `nonFlatConfigDataTypeId` implementation** (not just the two round-1/round-2 findings), to
   check for anything a further round might surface:
   - Flat `dataTypeId = Some(sentinel)` on a `DataPanelKinds` panel (the primary intended use
     case) — `clearBlessedSlot`'s first branch (`flat == sentinel`) fires unconditionally
     regardless of kind, clearing the flat field — matches real `bindingCandidate`, which
     never even evaluates `config` when the flat field is `Some(anything)` (any kind, since
     the flat field is legitimately blessed for every panel type per this design, matching
     `proposalPanelFormat`'s "flat field first" wire shape).
   - Flat `= Some(sentinel)` **and** `config.dataTypeId` also literally holds the sentinel
     (redundant duplicate) — the if/else structure only clears the flat field (never falls
     into the `config` branch once the first branch fires), so the leftover
     `config.dataTypeId` sentinel survives the rescan and is correctly flagged as a dangling
     duplicate — exercises the same "second occurrence" protection round-1 finding 2 already
     validated, in a new configuration.
   - `panel.config = None` entirely (no config object at all) on a non-`DataPanelKinds` panel
     with flat absent — `nonFlatConfigDataTypeId` short-circuits to `None` via
     `panel.config.flatMap(...)`, and `clearBlessedSlot`'s config-clear step is a no-op
     (nothing to clear); the panel has no sentinel anywhere, passes cleanly. No gap.
   - A `DataPanelKinds` panel with flat absent and `config.dataTypeId` unset but the sentinel
     present in some unrelated `config` key, or in `fieldMapping`/`content`/`url`/etc. — none
     of these is ever treated as blessed for any kind by `clearBlessedSlot`, so the rescan
     always finds it and rejects. Confirmed `ProposalPanel`'s full field list (`title`,
     `type`, `dataTypeId`, `metricId`, `fieldMapping`, `aggregation`, `content`, `url`,
     `orientation`, `chartType`, `xAxisLabel`, `yAxisLabel`, `seriesColors`, `label`, `unit`,
     `sort`, `layout`, `config`) at `DashboardProposalProtocol.scala:15-47` — the "does the
     sentinel appear anywhere in the cleared panel's serialized JSON" scan (task 4.2) is a
     full-object substring scan via the hand-written `proposalPanelFormat.write`
     (`DashboardProposalProtocol.scala:65-87`), which serializes every one of those fields
     verbatim, so nothing in this shape is structurally exempt from the scan.
   - Confirmed `resolveOutputRefs` (4.3) explicitly states it reuses "the SAME precedence as
     4.2," so no drift is possible between the validation pass and the substitution pass —
     traced both descriptions side by side in tasks.md and they are textually identical on
     the branching condition.

4. **D4/D5/D6/D7 spot-checked again for continued soundness (unchanged from round 1/2, but
   re-verified fresh against the actual code, not trusted from the prior report).**
   - `PipelineProposalApplyResponse(source: Option[DataSourceResponse], pipeline:
     PipelineSummaryResponse, outputDataTypeId: String, run: RunResultResponse)`
     (`PipelineProposalProtocol.scala:45-50`) — `source` is `Some` iff the call's own `apply`
     created it inline (confirmed: `resolveExistingSource` sets `responseForClient = None,
     createdByThisCall = false`; every inline branch sets both `Some(...)`/`true` together,
     `PipelineProposalService.scala:168`, `210`, `232`) — so D4's `response.source.isDefined`
     proxy for "this call created the source inline" is sound.
   - `DuplicateDashboardResponse(dashboard: DashboardResponse, panels: Vector[PanelResponse])`
     confirmed unchanged at `DashboardProtocol.scala:35`; `PanelResponse.fromDomain(panel:
     Panel, dataAsOf: Option[String] = None)`'s defaulted second param confirmed at
     `PanelProtocol.scala:112`, and every existing call site (`DashboardRoutes.scala:62`,
     `DashboardProposalRoutes.scala:36`) does use the explicit `p => PanelResponse.fromDomain
     (p)` lambda tasks.md 4.4 calls for — not a bare method reference.
   - Route-mount check: grepped every `pathPrefix("...")` across
     `backend/src/main/scala/com/helio/api/routes/*.scala` and `ApiRoutes.scala` — no existing
     top-level `"proposals"` prefix; D6's brand-new prefix genuinely introduces zero
     collision risk, and mirrors `PipelineProposalRoutes`'s exact `pathPrefix(...) { path(...)
     { post { entity(as[...]) {...} } } }` structure (`PipelineProposalRoutes.scala:34-44`).
   - `schemas/pipeline-proposal.schema.json` and `schemas/dashboard-proposal.schema.json`
     both exist and are `$ref`-able as task 1.1 requires.
   - MCP: `panelSchema` confirmed exported from `helio-mcp/src/tools/proposal.ts:64`, and
     `write.ts:21` merely re-imports it (`import { panelSchema } from "./proposal.js"`) —
     task 6.4's attribution is accurate.

5. **Acceptance criteria traced against tasks.md.** All six `ticket.md` ACs map to concrete
   tasks: atomic create (4.4, 7.2), dashboard-phase rollback (3.1, 4.4, 7.5), service reuse
   with RLS/V41 enforced via the composed sub-services (4.1, context section), dangling-ref
   400 (4.2, 7.4/7.4a/7.4b/7.4c), MCP tool + green test suites (6.x, 7.9, 7.10), and
   standalone-path backward compatibility (7.7). No AC left uncovered; no task scope beyond
   the ACs.

### Verdict: CONFIRM

Both round-2 change requests are correctly and completely fixed, verified independently
against the real `ProposalPanelSupport.scala`/`DashboardProposalService.scala` code rather
than the design doc's own restatement. I traced the corrected `clearBlessedSlot`/
`resolveOutputRefs` algorithm against every case I could construct — the original
round-1/round-2 scenarios, several new configurations (redundant-duplicate-with-blessed-flat,
`config = None`, sentinel-in-arbitrary-other-field) — and found no further precedence-fidelity
gap. spec.md, design.md, and tasks.md now describe the identical kind-aware, absence-
conditioned precedence with no internal contradiction. The other design decisions (D4-D7:
rollback method, response shape, route mount, MCP wiring) hold up against the actual code
they reference (route prefixes, response type shapes, existing lambda-wrapping precedent,
schema files, exported MCP schema).

### Non-blocking notes

- The sentinel-anywhere-in-JSON check (task 4.2: `clearBlessedSlot(panel).toJson.toString
  .contains(OutputRefSentinel)`) is a substring match, not a token-boundary match. A panel
  whose legitimate free-text field (e.g. a `text`/`markdown` panel's `content`) happens to
  contain the literal substring `"$pipelineOutput"` as part of unrelated prose would be
  false-positively rejected as dangling. This is an inherent, pre-existing property of the
  "scan for the sentinel anywhere" strategy established since round 1 (intentionally
  over-inclusive, to catch stray duplicates) — not something round 2 or round 3 introduced —
  and the risk surface is narrow (an agent/human would have to type the exact reserved
  sentinel string inside ordinary content). Not blocking; worth a one-line design.md
  acknowledgment if the executor wants to preempt a future bug report, but not a required
  revision.
- `helio-mcp/src/tools/pipelineProposal.ts`'s `pipelineProposalInputSchema` (the object task
  6.4 says to reuse for the combined tool's `pipeline` field) is currently a module-local
  `const`, not `export`ed. Trivial for the executor to export (or reconstruct field-for-field,
  since the fields are simple), and does not affect the soundness of the design — flagging
  only so the executor doesn't have to rediscover it.

### Change Requests

None.
