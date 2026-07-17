## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Root-cause claim (proposal.md / design.md Context).** `seedCreateConfig` in
  `frontend/src/features/panels/state/panelPayloads.ts` — read in full — confirms the
  `metric`/`chart`/`table` arm only seeds `dataTypeId`, never `chartType`/`valueLabel`/`unit`; the
  `image` arm does seed `imageUrl`. Matches the ticket's description and the proposal's audit.
- **`PanelAppearance`/`ChartAppearance` location.** `frontend/src/features/panels/types/panel.ts:37-47`
  confirms `chartType` lives on `ChartAppearance.chartType` (optional `"bar"|"line"|"pie"|"scatter"`),
  not on any `TypeConfig` variant (`panel.ts:405-409`). `frontend/src/utils/chartAppearance.ts:27`
  confirms the `?? "line"` render fallback.
- **Backend hardcodes default appearance at create.** `backend/src/main/scala/com/helio/services/PanelService.scala:128`
  is exactly `appearance = PanelAppearance.Default` — matches the design's citation precisely.
  `CreatePanelRequest` (`PanelProtocol.scala:47-52`) has exactly 4 fields (`dashboardId`, `title`,
  `type`, `config`) — no `appearance` field, confirming D1's premise.
- **Metric label/unit backend support already exists.** `MetricPanelConfig.decode`
  (`backend/src/main/scala/com/helio/domain/panels/MetricPanel.scala`) already parses `label`/`unit`
  tolerantly, and `decodeCreate = decode`, so D2's "no backend change needed" is correct.
  `MetricCreatorFields.tsx` confirms the modal already collects `valueLabel`/`unit` with
  `|| undefined` (empty→omitted) semantics, matching the spec's "empty values omitted" scenario.
- **Schema state.** `schemas/create-panel-request.schema.json` confirms `additionalProperties: false`,
  no `appearance` property today, and `type` enum `["metric","chart","text","table","markdown","image","divider"]`
  — `"collection"` is indeed absent, matching proposal.md's Non-goals note as pre-existing and correctly
  out-of-scope.
- **Copy bug.** `TypeSelectStep.tsx:38` is literally `"Visualize trends with line, bar, or pie"` —
  confirms the stale-copy claim.
- **Shared default appearance.** `frontend/src/theme/appearance.ts` already exports
  `defaultPanelAppearance`; `PanelDetailModal.tsx:39` has a module-private `DEFAULT_CHART_APPEARANCE` —
  confirms D3's move is real and behavior-preserving in shape.
- **The one substantive gap — chartType validation is NOT currently reused from a PATCH path.**
  Design.md D1 states the create path will be "validated with the same path PATCH uses, incl.
  `RequestValidation.validateChartType`" and the Risks section claims "it reuses the existing
  validated PATCH appearance shape and codec; no new shape is invented." I grepped the entire
  backend for `validateChartType` and traced every call site:
  - `backend/src/main/scala/com/helio/api/RequestValidation.scala:83` — the function definition.
  - `backend/src/main/scala/com/helio/services/DashboardProposalService.scala:80` — **the only
    caller**, in the AI-apply-proposal flow.
  I then read the actual `PATCH /api/panels/:id` appearance path end to end —
  `PanelServiceHelpers.resolvePatch` (lines 21-44) builds `PanelAppearance` straight from
  `PanelAppearancePayload` via `RequestValidation.normalizePanelBackground/normalizePanelColor/normalizeTransparency`
  and `chart = p.chart` — **no call to `validateChartType` anywhere in this path** — and
  `PanelPatchApplier.applyAppearance` (lines 37-44) just persists it. I also checked for a DB-level
  constraint (`grep -rn "chart_type" backend/src/main/resources/db/migration`) — none exists (V56 adds
  only a `chart_options JSONB` column, no check constraint). **Today, `PATCH /api/panels/:id` with
  `appearance.chart.chartType: "donut"` is accepted and persisted with no validation.** The premise
  that create's chartType validation is "the same path PATCH uses" / "existing validated" is false —
  it is new validation logic that has never before been wired into ordinary panel CRUD (it exists only
  in the separate `DashboardProposalService` flow).

### Verdict: REFUTE

### Change Requests

1. **Correct the false "reuses the existing validated PATCH path" premise in `design.md` (D1
   narrative and the "Risks / Trade-offs" first bullet) and `tasks.md` (1.2).** State plainly that
   `PanelServiceHelpers.resolvePatch` / `PanelPatchApplier` — the actual code that
   `PATCH /api/panels/:id` runs today — never calls `RequestValidation.validateChartType`; the only
   existing caller is `DashboardProposalService` (a different, AI-facing flow). Task 1.2's literal
   instruction to call `RequestValidation.validateChartType` in `PanelService.create` is still the
   right implementation move and should stay — but it must be documented as **newly wiring chartType
   validation into ordinary panel CRUD for the first time**, not as reusing something PATCH already
   does.
2. **Make an explicit, recorded decision about the resulting create/patch asymmetry.** After this
   change ships, `POST /api/panels` will 400 on an invalid `chart.chartType`, while
   `PATCH /api/panels/:id` will continue to silently accept and persist one (pre-existing gap,
   reproduced above). The design must explicitly decide one of:
   - (a) add the same `RequestValidation.validateChartType` call to
     `PanelServiceHelpers.resolvePatch` in this change, for parity (small, low-risk addition, and in
     the spirit of the ticket's own repro-widening instruction), with a corresponding task and test; or
   - (b) explicitly declare the PATCH-path gap a known pre-existing issue that is intentionally out of
     scope for this bug fix (e.g. as an added Non-Goal, optionally with a spinoff-ticket note, mirroring
     how the `collection` schema-enum gap is already handled).
   Currently the design silently assumes a symmetry that does not exist and makes no decision either
   way — this must be resolved in the design artifacts before implementation, not left for the
   executor to improvise.

### Non-blocking notes

- Ticket cites `utils/panelPayloads.ts`; design.md correctly notes the real path is
  `state/panelPayloads.ts` — good catch, no action needed.
- `ChartAppearance.Default.chartType = Some("line")` (backend) vs. the frontend's
  `DEFAULT_CHART_APPEARANCE` (no `chartType` key at all) is a pre-existing minor drift the design
  correctly calls out as unchanged by this ticket; fine to leave as noted.
