## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**1. Case classes named in design.md exist with the fields described (all read directly
from backend source, not taken on the orchestrator's word):**
- `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceProtocol.scala:29-127` —
  `DataSourceResponse` sealed trait with exactly the 7 named subtypes
  (`CsvSourceResponse`/`RestSourceResponse`/`SqlSourceResponse`/`StaticSourceResponse`/
  `TextSourceResponse`/`PdfSourceResponse`/`ImageSourceResponse`), each carrying
  `inferredSchema: Vector[InferredFieldResponse]`; `StaticSourceResponse` correctly has no
  `config` field (design.md's parenthetical is accurate). `InferredFieldResponse` at line 219
  is exactly `{name, displayName, dataType, nullable}` as tasks.md 1.2 states.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/NodeCapabilitiesProtocol.scala:15-23`
  — `NodeCapabilitiesResponse(stepId: Option[String], columns: Vector[PanelCapabilityColumnResponse],
  capabilities: Map[String, PanelCapabilityResponse])` exactly as described.
- `backend/src/main/scala/com/helio/api/protocols/panels/PanelCapabilityProtocol.scala:17-49` —
  `PanelCapabilityColumnResponse(name, dataType, nullable)` and
  `PanelCapabilityResponse(bindable, requiredSlots, optionalSlots, eligibleColumns, reason,
  message)` match tasks.md 1.3 field-for-field, including the `Map`-type-alias detail.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineShapeProtocol.scala:66-93` —
  `ShapeStepExpansionResponse(clientId, kind, config: JsObject, parentStepId: Option[String])`
  and `ExpandPipelineShapeResponse(steps: Vector[ShapeStepExpansionResponse], outputs:
  Option[JsArray] = None)` match design.md/tasks.md exactly.
- Route wiring confirmed: `PipelineRoutes.scala:64-67` → `PipelineService.capabilitiesAtNode`
  returns `NodeCapabilitiesResponse`; `PipelineShapeRoutes.scala:32-37` →
  `ExpandPipelineShapeResponse.fromDomain`.

**2. Spot-checked "already shipped" claims:**
- **Output `config.format` round-trip (item 3):** `OutputResponse.config` is carried as opaque
  `JsValue` (`OutputProtocol.scala:34`), merged one level deep by `OutputService.mergeConfig`
  (`OutputService.scala:274`) — the backend never validates `format`'s shape. `MetricFormat`
  exists only as a frontend TS type (`frontend/src/features/pipelines/ui/outputEditor/
  outputConfigTypes.ts:109`, `"number"|"integer"|"currency"|"percent"`), consumed by
  `MetricOutputConfig.format`/`CollectionOutputConfig.format`. `schemas/outputs/output.schema.json`
  already documents `config` as a generic `{"type": "object"}` — exactly what Decision 3 cites as
  precedent. The claim holds: the literal AC (round-trip) is satisfied by the existing opaque-config
  merge path, and no schema change is warranted.
- **Decision-15 default layout scoped to Output-kind panels only (item 2):** confirmed at
  `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md:164` verbatim — "Content
  panels (text, markdown, image, divider) are a row at the bottom" (not decision-15). Backend
  implementation confirmed live in `PanelPacker.scala`/`PanelService.scala:211`.
  `schemas/panels/panel.schema.json` already documents the decision-15 `layout` field.
- **Inline pipeline source subsumed by HEL-913 `roots[]` (item 5):** `PipelineProtocol.scala:52-69`
  — `CreatePipelineRootRequest` supports `sourceId` **or** an inline spec (`type`/`sqlConfig`/
  `restConfig`/`staticConfig`), exactly as the ticket's addendum wanted.
  `openspec/specs/pipeline-create-api/spec.md:9` already documents this ("each element names an
  existing caller-owned DataSource by sourceId or supplies an inline source spec").

**3. Design's approach vs. repo conventions:**
- `scripts/check-schema-drift.mjs:99-112` confirms the `"Panel"` SKIP-list precedent cited in
  Decision 1 is real (`"Panel", // response composed across PanelResponse and union variants`).
  The drift checker (lines 122-156) compares `schema.properties` keys against case-class field
  names — it does **not** consult `required`, so Decision 4's "`outputs` present in `properties`
  but absent from `required`" is safe under this checker.
- Confirmed none of the three target schema files currently exist (`schemas/sources/`,
  `schemas/pipelines/` directory listings), and `npm run check:schemas` / `node
  scripts/check-schema-drift.mjs` currently exit 0 on the unmodified tree (baseline green, as
  design.md assumes). `openspec validate remaining-output-pipeline-schemas --type change` also
  currently passes.
- All three response shapes are backend-test-covered today: `DataSourceProtocolSpec.scala`,
  `DataSourceRoutesSpec.scala` (inferredSchema); `PipelineCapabilitiesRoutesSpec.scala`
  (NodeCapabilitiesResponse); `PipelineShapeRoutesSpec.scala`/`PipelineShapeServiceSpec.scala`
  (ExpandPipelineShapeResponse) — corroborates proposal.md's "already implemented, tested, and
  correct on the wire" framing.
- Checked the two other capability specs proposal.md names as unmodified:
  `data-source-persistence/spec.md:154-163` already documents `inferredSchema` at the domain
  level; `pipeline-shape-registry/spec.md:581-655` is **exhaustively** wire-shape-documented for
  the exact `{steps, outputs?}` envelope, including the same "omitted key, never null" nuance
  Decision 4 states — no update needed there, confirmed. `pipeline-capabilities-api/spec.md`
  (48 lines) is behavior-level only and never names `stepId`/`columns`/`capabilities`/
  `eligibleColumns` as literal JSON keys — see Non-blocking notes below.

### Verdict: CONFIRM

Every case-class/field/route claim in design.md and every "already shipped" premise-validation
claim I spot-checked (config.format, decision-15 scope, inline pipeline source) is independently
verifiable against the current backend source and existing openspec specs — none of it is taken
on the orchestrator's or ticket's word. The chosen schema-authoring approach (SKIP-list + hand-
authored `oneOf`, inlining nested types, `skip_specs: true`) is technically sound and matches real
`check-schema-drift.mjs` mechanics. `tasks.md` is complete and ordered correctly to deliver
design.md's three decisions plus verification.

### Non-blocking notes

1. Decision 1's trade-offs section says the 7-variant `oneOf` "matches the existing Panel
   precedent" — this overstates it. The real `schemas/panels/panel.schema.json` uses a single
   flat base object (common required fields) with `oneOf` narrowing only the `type`+`config`
   combination, not 7 fully independent, fully-required top-level object schemas. The chosen
   7-variant approach is still valid JSON Schema and arguably a *stronger* drift-catcher (it was
   explicitly chosen over the weaker loose-base-object alternative for that reason), so this is a
   documentation-accuracy nit, not a technical defect — but the executor/evaluator should not
   expect the two schemas to look structurally similar side-by-side.
2. Task 2.2 cites the diff-scope check target as `openspec/changes/output-routes-api-contracts/`;
   the actual path is `openspec/changes/archive/2026-09-01-output-routes-api-contracts/` (already
   archived). Trivial to correct at execution time, does not change the check's intent.
3. The revised AC's "any capability spec whose documented contract is silent on these
   already-shipped fields is updated" is genuinely ambiguous when applied to
   `pipeline-capabilities-api`: unlike `pipeline-shape-registry` (which documents its response
   envelope down to individual JSON keys), `pipeline-capabilities-api/spec.md` never names
   `stepId`/`columns`/`capabilities`/`eligibleColumns` as literal wire fields — only behavior
   ("the response describes the Output kinds bindable at that node"). Design.md's decision to
   leave it unmodified is defensible (matches this repo's general practice of keeping JSON field
   names in `schemas/`, not spec prose) and I did not find it to be a wrong call, but it is a
   closer judgment call than proposal.md's "(none — no spec-level requirement changes)" framing
   suggests, given the sibling `pipeline-shape-registry` precedent documents comparably-shaped
   wire detail in prose. Flagging so the evaluator/skeptic-final gate double-checks this if
   `openspec validate` or a human reviewer later expects more.
