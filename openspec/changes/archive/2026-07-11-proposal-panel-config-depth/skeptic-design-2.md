## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- **Round-1 item 1 (chart-appearance validation-timing contradiction) — resolved for real, not just
  reworded.** Read `design.md` Decisions 2 and 6 and `tasks.md` 3.1/3.3/3.5. Decision 6 now states all
  rejection happens in `validateStructure` (pre-creation); Decision 2 now explicitly says
  `applyAppearance` "performs NO validation and has NO failure-to-reject path" because by the time it
  runs, `chartType` was already checked. Confirmed against the real code:
  `backend/src/main/scala/com/helio/services/DashboardProposalService.scala:37-48` — `validateStructure`
  runs entirely before `preValidateBindings`/`createAll` (the `apply` method's match on
  `validateStructure(proposal)` short-circuits to a 400 before any dashboard exists). Also confirmed
  `PanelServiceHelpers.resolvePatch` (`backend/.../services/PanelServiceHelpers.scala:33`) passes
  `p.chart` through with **no validation** — exactly the "manual PATCH path stays unvalidated, closing
  it is out of scope" claim in the design's Non-Goals, and exactly why `applyAppearance`'s call into
  `panelService.update` is safe only because `validateStructure` already gated the value upstream. The
  chart-type allow-list (`bar|line|pie|scatter`) matches the real frontend list at
  `frontend/src/features/panels/ui/editors/ChartAppearanceEditor.tsx:182-185`. The spec delta
  (`specs/echarts-chart-panel/spec.md` scenario "An invalid chartType is rejected before anything is
  created") and task 6.2 ("assert an invalid chartType/orientation 400s and creates nothing") now match
  Decision 6 exactly. No remaining contradiction.

- **Round-1 item 2 (divider orientation) — same resolution, verified the same way.** Confirmed
  `RequestValidation.validateDividerOrientation` already exists (`backend/src/main/scala/com/helio/api/
  RequestValidation.scala:74-79`) and `DividerPanelConfig.decodeCreate` (`DividerPanel.scala:41`) is
  still an unvalidated passthrough to `decode` — matching the design's claim that create-time has no
  validation today and `validateStructure` is the only place invalid orientation can be caught.
  `specs/divider-panel-type/spec.md`'s "An invalid orientation is rejected before anything is created"
  scenario is consistent.

- **Round-1 item 3 (task 3.3/3.4 ambiguous "data panel" wording) — fixed.** Current `tasks.md` 3.4 reads
  "thread the metric panel's `label`/`unit` into the metric config JSON (chart/table configs don't have
  these fields — this only applies to metric panels)" — unambiguous, matches `MetricPanelConfig`'s
  actual fields (verified in `backend/src/main/scala/com/helio/domain/panels/MetricPanel.scala:11-15`,
  currently `jsonFormat3`, consistent with task 2.1's claimed bump to `jsonFormat5`).

- **Fresh full pass beyond the 3 prior items:**
  - `MetricPanelConfig`'s current shape (`dataTypeId`, `fieldMapping`, `aggregation`, `jsonFormat3`)
    matches design Decision 3/task 2.1 exactly.
  - `PanelRepository.replace`'s explicit column tuple (`PanelRepository.scala:205-206`) is real and does
    NOT include a slot for the new columns yet — confirms task 2.4's claimed whitelist gotcha is a real,
    present gap this design correctly calls out (mirroring the HEL-292 `aggregation` precedent).
  - `ChartAppearance` case class exists in `model.scala:98-104` but has no companion `object
    ChartAppearance { val Default = ... }` yet — confirms task 3.2's "new `ChartAppearance.Default`"
    claim is accurate (not already present, not a duplicate addition).
  - `dashboard-proposal.schema.json` and `panel.schema.json`'s `MetricConfig`
    (`additionalProperties: false`) confirm the schema extension work in tasks 1.1/1.2 is required (a
    bare passthrough would 400 on unknown fields without the schema change).
  - `helio-mcp/src/types.ts`'s current `ProposalPanel` interface (`title/type/dataTypeId/fieldMapping/
    aggregation/layout`) matches the design's stated MCP impact area — tasks 5.1/5.2 are correctly
    scoped, nothing missing.
  - `panel-datatype-binding` and `panel-type-rendering` spec deltas are consistent with Decision 3/4 and
    correctly distinguish the literal `label`/`unit` from `fieldMapping.label`/`fieldMapping.unit`,
    including the "no value binding still shows No data" precedence scenario matching Decision 4's
    `hasValue` guard note.
  - Task ordering (1 → 2 → 3 → 4 → 5 → 6) is a coherent backend-schema → backend-domain →
    backend-service → frontend → MCP → tests sequence with no forward references.
  - Non-goals in proposal.md and design.md are internally consistent (no `BindingEditor` UI, no
    `fieldMapping`-slot changes, no widening of the manual-PATCH validation gap) and none of them
    contradict an acceptance criterion — all 3 ACs in `ticket.md` are traceable to a task: markdown
    content → tasks 1.1/1.3/3.4; bar chart with axes → tasks 3.1/3.2/3.3/3.5; "no post-apply manual
    editing" → the combination of 3.4/3.5 for the Netflix-overview scenario.

### Verdict: CONFIRM

### Non-blocking notes
- `specs/markdown-panel/spec.md`'s second scenario title ("Proposal chart/markdown panel with no
  content") mentions "chart" even though chart panels don't have a `content` field — likely a copy-paste
  artifact from a shared scenario template. Harmless (the scenario body only exercises `markdown`), but
  worth a one-word fix for clarity when touched next.
- Design.md doesn't spell out the flat-to-nested mapping from proposal's `xAxisLabel`/`yAxisLabel` onto
  `ChartAppearance.axisLabels.x.label`/`.y.label` (the `show` sub-field presumably stays at the
  `Default`'s `true`). This is inferable from the existing `ChartAppearance` shape and is a reasonable
  implementation detail to leave to the executor, not a design-soundness gap.
