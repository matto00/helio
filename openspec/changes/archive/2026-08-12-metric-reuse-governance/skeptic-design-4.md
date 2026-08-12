## Skeptic Report — design gate (round 4, skeptic-design-4.md)

This is an explicitly human-approved over-budget round (`SKEPTIC_DESIGN_ROUNDS` = 3, exhausted at
round 3 — see `workflow-state.md` and `design.md` Planner Notes). Scope per the orchestrator: (1)
verify the round-4 relocation fix is syntactically valid at the claimed location and does not affect
`create-panel-request.schema.json`, and (2) do a final fresh sweep of the whole change before
confirming.

### What I verified (with evidence)

**1. Round-4 fix location, read fresh from source (not from any prior report's narrative):**

- Read `schemas/panel.schema.json` (357 lines) and `schemas/create-panel-request.schema.json` (71
  lines) in full, current on-disk state (fix not yet applied — this is the design gate, pre-execution).
  Confirmed `panel.schema.json`'s top-level `oneOf` (lines 37-69) currently has bare `"config": {"$ref":
  "#/$defs/MetricConfig"}` (and Chart/Table) for the `metric`/`chart`/`table` branches, and
  `create-panel-request.schema.json` lines 29-40 `$ref`s the same `#/$defs/MetricConfig`/`ChartConfig`/
  `TableConfig` via its own `allOf`/`if`/`then` for request validation — exactly as round 3 described.
- Read `design.md` D6 (lines 70-98) and `tasks.md` 2.3 (lines 28-48): both now specify the relocation
  precisely — `metricDeprecated: boolean` added to each `$def`'s `properties` with **no** `required`
  change at the `$def` level, and the conditional `if`/`then` moved into `panel.schema.json`'s own
  top-level `oneOf` branches via an `allOf` combining the existing `$ref` with `{"if": {"required":
  ["metricId"]}, "then": {"required": ["metricDeprecated"]}}`. This textually matches round 3's Change
  Request 1 verbatim.

**2. Empirical validation — not just inspection.** I built the exact proposed schema change
(programmatically, from the plan's own JSON snippet) in a scratch copy of `panel.schema.json` and ran
it through `ajv` 8.20 (2020-12 dialect, available in `frontend/node_modules/ajv/dist/2020`) against 9
constructed instances, covering both the response schema (`panel.schema.json`) and the untouched
`create-panel-request.schema.json`:

| # | Case | Expected | Result |
|---|------|----------|--------|
| 1 | Response: metric panel, `metricId` set, no `metricDeprecated` | **invalid** (this is the bug the fix closes) | invalid ✓ |
| 2 | Response: metric panel, `metricId` + `metricDeprecated` set | valid | valid ✓ |
| 3 | Response: metric panel, no `metricId` (raw fields only) | valid (majority case, no requirement triggered) | valid ✓ |
| 4 | Response: chart panel, `metricId` set, no `metricDeprecated` | invalid | invalid ✓ |
| 5 | Response: table panel, `metricId` set, no `metricDeprecated` | invalid | invalid ✓ |
| 6 | **CREATE** metric panel, `config: {metricId: "m1"}` only | **valid** (the exact regression round 3 found) | valid ✓ |
| 7 | CREATE chart panel, `metricId` only | valid | valid ✓ |
| 8 | CREATE table panel, `metricId` only | valid | valid ✓ |
| 9 | CREATE metric panel with a (hypothetical) client-sent `metricDeprecated` | valid (now a declared, non-required property, so `additionalProperties:false` doesn't reject it) | valid ✓ |

All 9/9 matched expectation. Case 6 is the direct, empirical refutation-check of round 3's finding: a
legitimate `POST /api/panels {dashboardId, type: "metric", config: {metricId: "m1"}}` — which is real,
currently-supported behavior per `PanelService.scala:215`'s `rejectUnresolvableMetric` — now validates
successfully against `create-panel-request.schema.json` under the round-4 fix, while the response side
(cases 1/4/5) still correctly rejects a `metricId`-present/`metricDeprecated`-absent response, proving
the requirement is enforced where it should be and nowhere else. The `if`/`then`'s `"required":
["metricId"]` is nested *inside* the `config` property's own schema (via `allOf`), so it correctly
inspects `config.metricId`, not the panel's own top-level properties — confirmed by cases 1-3 behaving
correctly, which wouldn't be possible if the nesting were wrong.

**3. Verified no other file silently regresses.** Grepped the live `schemas/` tree (not the OpenSpec
archive, which is historical) for every `$ref`/inline reference to
`MetricConfig`/`ChartConfig`/`TableConfig`/`panel.schema.json`:
- Only `create-panel-request.schema.json` and `panel.schema.json` itself reference the `$defs`
  directly — confirmed by `grep -l` across `schemas/*.json`.
- `bound-panel-response.schema.json`, `create-panels-batch-response.schema.json`, and
  `update-panels-batch-response.schema.json` all `$ref` the **whole** `panel.schema.json` document (no
  fragment) for their `panel`/`panels[]` fields — response-only usage, so they correctly inherit the
  fixed top-level `oneOf` (design.md's claim that `bound-panel-response.schema.json` "inherits the fix
  for free" is accurate, and the same reasoning extends to the two batch-response schemas, an even
  broader confirmation than design.md itself claims).
- `create-panels-batch-request.schema.json` and `update-panels-batch-request.schema.json` (the two
  other create/update paths) both use a bare `"config": {"type": "object"}` for their panel entries —
  they never `$ref` the discriminated `$defs` at all, so they are unaffected by this change regardless
  of scope (confirmed by reading both files in full).

**4. Fresh sweep of the rest of the change (not just the schema fix).**
- Ticket ACs (`ticket.md`) traced individually against `design.md`/`tasks.md`/`specs/`: usage query
  (D1 → tasks 1.1-1.3 → `metric-usage-governance/spec.md`), rename safety (D8 → task 8.4 →
  `panel-datatype-binding/spec.md` "A renamed metric requires no re-binding"), deprecated exclusion
  from grounding + picker (D4/D5 → tasks 3.x/5.x → `mcp-metric-tools/spec.md` +
  `panel-datatype-binding/spec.md`), delete communicates impact (D1-D3 → tasks 1.4/7.x →
  `metric-crud-api/spec.md` + `metric-authoring-ui/spec.md`), `sbt test`/no-FQN (tasks 1.5/8.8). All
  five ACs have a traceable path to a task and a spec scenario — no gap found.
- `grep -rniE "TODO|TBD|figure out|unclear|placeholder"` across `design.md`, `tasks.md`, `proposal.md`,
  `specs/`, `ticket.md`: one hit, `specs/metric-authoring-ui/spec.md:37` ("replacing any generic
  placeholder copy") — this is prose describing the *current* UI copy being replaced, not a design
  placeholder. No actual placeholders/deferred decisions found.
- Spot-checked several file:line citations fresh (not trusting prior rounds' text): `MetricRoutes.scala`
  read in full — DELETE handler at lines 65-67 is exactly `delete { ServiceResponse.runNoContent(...) }`
  as design.md D2 describes (bare `204` today). `helio-mcp/src/context.ts` lines 949-964 (doc-comment)
  and 1114-1123 (the actual `.map` with no filter) read fresh — confirmed the doc-comment literally
  states "A `deprecated: true` entry is still included, not filtered out" and the map has no filter
  applied, exactly matching D4/task 3.1's diagnosis and fix point. `DataTypeRepository.scala` and
  `PanelRepository.scala` read at the cited join/owner-scoping regions — the `for {panel <- table if
  ...; dash <- dashTable if dash.id === panel.dashboardId}` join shape D1 cites as the pattern to mirror
  is present and matches. All cited frontend files
  (`useMetricBindingState.ts`/`MetricPicker.tsx`/`MetricListTable.tsx`/`MetricDetailPage.tsx`) exist at
  the exact claimed paths.
- No internal contradictions found between `proposal.md`/`design.md`/`tasks.md`/`specs/*` on a second,
  independent pass — Non-Goals in `design.md` (no usage-list UI page, no dashboard-grid badge, no MCP
  `delete_metric` changes, no `list_metrics` filtering) match `proposal.md`'s "Impact" non-goals and are
  not contradicted by any task or spec scenario.

### Verdict: CONFIRM

### Non-blocking notes

- The round-4 fix is now proven correct by construction (ajv validation against the literal proposed
  JSON, not just visual inspection) — this closes out the three-round schema-scope saga (missing entirely
  → unconditional `required` → conditional in the wrong shared scope → conditional in the correct
  response-only scope).
- Everything else in the design (D1-D5, D7, D8, the spec deltas, AC traceability) was independently
  re-derived from source this round and found sound; no new defects surfaced in the broader sweep beyond
  what rounds 1-3 already caught and this round confirms is now fixed.
