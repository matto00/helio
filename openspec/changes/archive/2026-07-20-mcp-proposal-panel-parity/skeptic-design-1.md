## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/mcp-panel-composition-tools/spec.md`, `.openspec.yaml`, `workflow-state.md`. Confirmed
  `workflow-state.md` records `SCOPE_DECISION: Option B (full parity — backend + schema + MCP),
  approved by human`, matching the brief.

- **Ground truth on current (pre-change) backend state** —
  `backend/src/main/scala/com/helio/api/protocols/DashboardProposalProtocol.scala` and
  `backend/src/main/scala/com/helio/services/DashboardProposalService.scala`: confirmed `ProposalPanel`
  has no `config` field today, and `buildCreateRequest`/`buildDataConfig`/`buildNonDataConfig` build
  only the flat-field-derived config exactly as `design.md`'s Context section describes. This grounds
  the proposal's core premise.

- **`PanelConfigCodec.decodeCreateConfig`**
  (`backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala:53-67`): confirmed
  `decode(None)` yields the subtype's `Empty`/default config (`payload = json.getOrElse(JsObject.empty)`),
  supporting D3's "tolerates absent fields" claim, and that all seven live subtypes (including
  `CollectionPanel.Kind`) route through the same dispatcher — supports D1's "reuses the create decoder
  verbatim" claim.

- **D2 / V41 binding-safety claim** — read `PanelService.create`
  (`backend/src/main/scala/com/helio/services/PanelService.scala:105-143`): confirmed
  `rejectCompanionBinding(dataTypeIdFromCreateConfig(createConfig), user)` runs unconditionally on the
  *decoded* config at create time, independent of `DashboardProposalService.preValidateBindings`. This
  means the V41 pipeline-only-binding guarantee is enforced by a **second, independent layer** even if
  the proposal-layer merge/re-apply logic in D2 were imperfectly implemented — the design's safety
  claim is sound and, if anything, under-sells its own robustness (worth noting as a strength, not a
  flaw).

- **D4 divider-tolerance claim** — read `PanelType.fromString`
  (`backend/src/main/scala/com/helio/domain/model.scala:71-81`, still accepts `"divider"`) and confirmed
  `RequestValidation.validateDividerOrientation`/`validateChartType` still exist
  (`backend/src/main/scala/com/helio/api/RequestValidation.scala:74,83`) and the `buildNonDataConfig`
  `"divider"` branch is untouched. D4's backward-compatibility claim checks out.

- **`schemas/dashboard-proposal.schema.json`**: confirmed `ProposalPanel` currently has
  `"additionalProperties": false` and no `config` property — task 2.1/2.2 are correctly scoped as
  additive changes to this file. Confirmed `divider` is currently in the `type` enum (task 2.2 target).

- **MCP client ground truth** — `helio-mcp/src/tools/proposal.ts`: confirmed `PANEL_TYPES` currently
  includes `"divider"` (needs removal, task 3.2 correct) but **already includes `"collection"`**
  (line 23-32) and `DATA_PANEL_TYPES` already includes `"collection"` (line 22) — contrary to the
  ticket's claim that `proposal.ts` "omits collection." This is a ticket/context staleness, not a design
  defect: `design.md`/`spec.md`'s scenario "Collection is proposable" is already satisfied by the
  current code and the design correctly scopes only the `divider` removal + `config` passthrough as new
  work. Non-blocking.

- **Precedent for D1's `config` passthrough pattern** — `helio-mcp/src/tools/write.ts:255` (`create_panel`
  already has `config: z.record(z.unknown()).optional()`) and
  `backend/src/main/scala/com/helio/api/protocols/PanelProtocol.scala:53-58` (`CreatePanelRequest.config:
  Option[JsValue]`) confirm D1 genuinely mirrors an existing, working pattern rather than inventing a new
  one.

- **Frontend backward-compatibility claim** — `frontend/src/features/dashboards/types/proposal.ts`:
  confirmed the in-app Proposal Review UI's own `ProposalPanel` TypeScript type has no `config` field and
  is not touched by this change (matches `proposal.md`'s Impact section: "verified, not modified").
  Since the new backend field is optional/additive, the frontend continues to post payloads that produce
  byte-for-byte identical `buildCreateRequest` output — backward-compatibility claim is grounded.

- **Chart/table v1.5 surfaces referenced by the design are real** — `ChartPanel.scala` (`chartOptions:
  Option[ChartOptions]`, lines 181-216) and `TablePanel.scala` (`density`, `columnOrder`, lines 15-20)
  confirm the config surfaces D1-D3 claim to unlock via passthrough actually exist and are decoded by
  `decodeCreate`.

### Internal contradiction found — D3's illustrative examples are structurally impossible

`design.md` D3 states: *"for a non-data panel that supplies only `config` (e.g. a **collection created
without a flat binding**, or a chart with `chartOptions`) — the base may be empty and `config` alone
forms the payload."*

This is contradicted by the design's own retained validation logic:

- `DashboardProposalService.DataPanelKinds = Set("metric", "chart", "table", "collection")` (line 271),
  and `validatePanel` (lines 76-77) rejects **any** proposal panel of type `collection` (or metric/
  chart/table) whose **flat** `dataTypeId` is absent, *before* `buildCreateRequest` ever runs — this
  design does not propose changing that. So "a collection created without a flat binding" can never
  reach the merge step; it is rejected at structural validation. It cannot be an example of `config`
  alone forming the payload.
- Both `spec.md`'s own scenario ("Collection base type and layout via proposal config") and
  `CollectionPanelConfig` confirm collection panels need a `dataTypeId` — the spec scenario correctly
  requires "a valid `dataTypeId`" alongside `config`, directly contradicting D3's prose example.
- Similarly, "a chart with `chartOptions`" is not an empty-base case either: chart is a `DataPanelKinds`
  member, so its derived base always contains at least `dataTypeId` (+ `fieldMapping: {}`) — never
  empty.

The *genuine* empty-derived-base case (a `text`/`markdown`/`image` panel that supplies `content`/`url`
only via `config`, omitting the flat field) is real and reachable, but D3 never names it — it names two
examples that are impossible under the design's own retained rules.

This matters operationally because **Task 1.4** ("Ensure `config`-only panels (empty derived base) still
build a valid `CreatePanelRequest` for both data and non-data kinds (D3)") inherits the ambiguity: taken
at face value it implies a genuine "data kind + config-only + empty base" case exists and must be
handled/tested, which it does not under the current (retained) `validatePanel` rules. An implementer
following D3 literally risks either (a) writing a nonsensical/untestable assertion, or worse (b)
"fixing" the perceived gap by loosening `validatePanel`'s `DataPanelKinds` dataTypeId requirement for
collection — which is out of scope and would weaken an existing structural invariant this design does
not intend to touch.

### Verdict: REFUTE

### Change Requests

1. **Fix `design.md` Decision D3's illustrative examples**, and align `tasks.md` Task 1.4's wording with
   it. Replace the "collection created without a flat binding" and "chart with `chartOptions`" examples
   (both structurally unreachable given the retained `validatePanel`/`DataPanelKinds` rule) with the
   actually-reachable empty-base case: a `text`/`markdown`/`image` panel that supplies `content`/`url`
   only via `config` (flat field omitted). Explicitly state that for `DataPanelKinds` members
   (metric/chart/table/collection) the derived base is **never** empty — it always carries at least the
   validated flat `dataTypeId` — so Task 1.4's "for both data and non-data kinds" language should be
   reworded to avoid implying an empty-base scenario exists for data kinds; instead it should describe
   confirming a *non-empty* base plus a `config` overlay works correctly for data kinds, and a
   genuinely-empty base plus `config` works for the three non-data kinds that lack a required flat
   field. This is a documentation/task-wording fix only — no code or spec.md scenario change is
   required, since spec.md's own scenarios are already accurate.

### Non-blocking notes

- The ticket's premise ("`proposal.ts` ... omits `collection`") is stale — `PANEL_TYPES` and
  `DATA_PANEL_TYPES` in `helio-mcp/src/tools/proposal.ts` already include `"collection"`. The design
  correctly scopes only the `divider` removal as new MCP-side type-list work; no action needed, just
  noting for the record so the executor doesn't waste time hunting for a "missing collection" bug that
  doesn't exist.
- D2's "re-apply flat `dataTypeId` after merge" is good defense-in-depth but is not the sole guarantee
  of the V41 rule — `PanelService.create`'s `rejectCompanionBinding` independently re-validates whatever
  `dataTypeId` ends up in the decoded config. Worth keeping test 4.3 regardless, since it protects
  proposal-review fidelity (what was reviewed = what gets created), not just the security invariant.
