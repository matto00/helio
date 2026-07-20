## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Ticket vs. plan scope.** Read `ticket.md` (ACs), `proposal.md`, `design.md`, `tasks.md`, and all
  three spec deltas. The four required ACs (image caption renders/hides, chart annotation renders/hides,
  scales/truncates, round-trips create/update/read + config UI) map to tasks 1.x/2.1/3.x/5.x. Stretch
  (MCP) is correctly de-scoped from required ACs (task 4.1, gated last). Good.

- **Decision 1 (dedicated nullable TEXT columns) is sound and precedented.** `PanelRepository.PanelRow` /
  `PanelTable` (backend/.../infrastructure/PanelRepository.scala:284-349) already store scalar config as
  dedicated columns (`image_url`, `image_fit`, `divider_color`, `metric_label`, `metric_unit`). Two new
  `TEXT NULL` columns fit that idiom exactly. Migration numbering is correct: latest on disk is
  `V58__panel_timeline_options.sql`, so `V59` is the next slot.

- **Decision 2 (static text, no DataType binding) is sound and well-justified.** Confirmed `ImagePanel`
  carries no binding infra: `dataTypeId: Option[DataTypeId] = None`, `fieldMapping = None`,
  `buildQuery = None` (ImagePanel.scala:79-84). Wiring `BoundOrLiteralField` into image panels would be
  real new infrastructure, well beyond this ticket. The ticket phrases bound sourcing as a "may". The
  additive-later argument (field stays a string; a future binding is additive) holds.

- **Decision 3 (wire names `caption`/`annotation`) is reasonable** and matches ticket vocabulary and the
  distinct rendering roles.

- **Frontend/schema targets exist (plan is not hallucinated).** Verified `ImagePanel.tsx`,
  `renderers/ImageRenderer.tsx`, `renderers/ChartRenderer.tsx`, `ui/PanelContent.tsx`,
  `editors/ImageEditor.tsx`, `editors/ChartDisplayFields.tsx`, `state/panelPayloads.ts` all exist at the
  referenced paths, and `schemas/panel.schema.json` has named `ImageConfig` (line 142) and `ChartConfig`
  (line 88) defs, both with `additionalProperties: false` — so task 2.1 (add the property to each) is
  necessary and correctly scoped.

- **Wire-shape ground truth (this is where the plan breaks).** The panel response is a discriminated,
  **per-subtype nested `config`** (`PanelResponse.config: JsValue`, PanelProtocol.scala:31-41,84-107;
  `PanelConfigCodec.encodeConfig` emits each subtype's own `*Config.toJson`). The class comment is
  explicit: *"Per-subtype flat nullable fields at the response root are gone."* And Option config fields
  are **omitted, not null**, on the wire under `DefaultJsonProtocol` — documented in-repo in the sibling
  `openspec/specs/collection-panel-type/spec.md`: *"spray-json omits `None` — fields are absent, not
  null"* and, for clearing, *"the response **omits** `itemOptions`"* (lines 33, 66); the `ChartOptions`
  comment repeats it (ChartPanel.scala:66-67).

### Verdict: REFUTE

The three self-approved architecture decisions are sound. The blocker is that the **spec deltas specify a
response contract that contradicts (a) the design's own chosen mechanism, (b) the documented house
convention, and (c) the actual per-subtype wire shape.** Left as written, these deltas are the acceptance
contract the executor builds to and the evaluator traces against — they will drive architecturally wrong
work or an unsatisfiable spec-trace at the final gate. Cheaper to fix the artifacts now.

### Change Requests

1. **Fix the response-contract requirement in `specs/image-panel-type/spec.md`.** The requirement "Image
   panel caption round-trips…" states: *"Every image panel response SHALL include a `caption` field
   (string or null), and non-image panels SHALL report `caption: null`."* Both halves are false under the
   codebase:
   - Image panels: with `caption: Option[String]` via `jsonFormatN` (the design's own approach),
     an unset caption is **omitted** from `config`, not emitted as `null`. Reword to match the
     collection-panel precedent: response `config` includes `caption` when set and **omits** it when
     unset (spray-json None-omission).
   - Non-image panels: their `config` is a different subtype with **no `caption` field at all** — there
     is no root-level `caption` since CS2c-3c removed the flat wire shape. The "non-image panels report
     `caption: null`" clause is architecturally impossible; delete it.

2. **Fix the corresponding clear/absent scenarios in `specs/image-panel-type/spec.md`.**
   - Scenario "PATCH with null caption clears it → the response includes `caption: null`" — change the
     THEN to "the response `config` **omits** `caption`" (mirroring collection's "response omits
     `itemOptions`").
   - Scenario "Non-image panel response has a null caption" — remove it (or reframe as "a non-image
     panel's `config` carries no `caption` field").

3. **Apply the identical fixes to `specs/echarts-chart-panel/spec.md`** for `annotation`: the "Every
   chart panel response SHALL include an `annotation` field (string or null), and non-chart panels SHALL
   report `annotation: null`" requirement, the "PATCH with null annotation → includes `annotation: null`"
   scenario, and the "Non-chart panel response has a null annotation" scenario all have the same defect
   and need the same omit-not-null / no-field-on-other-subtypes correction.

4. **Resolve the Option-vs-String modeling ambiguity between `tasks.md` 1.3/1.4 and `design.md`
   Decision 3.** Task 1.3 says add `caption: Option[String]` / `annotation: Option[String]`, but
   Decision 3 says "mirroring the established `imageUrl` Patch semantics" — and `imageUrl` is a
   **non-Option** `String` (Patch type `Option[String]`, `JsNull ⇒ Some("")`, ImagePanel.scala:38-63).
   An `Option[String]` config field needs a **two-level** Patch (`Option[Option[String]]`: absent=`None`,
   clear=`Some(None)`, set=`Some(Some(v))`) like `ChartPanelConfig.Patch.dataTypeId`/`aggregation`
   (ChartPanel.scala:218-262) — not the single-level `imageUrl` pattern. State one model explicitly. The
   recommended model (Option field + two-level Patch + column `NULL` when `None` + omitted on wire) is
   the one consistent with the collection/chart precedent and with Change Requests 1-3.

### Non-blocking notes

- **Make the PATCH-persistence path explicit in task 1.2.** The `PATCH` write path (`PanelRepository.
  replace`, line 201) writes back **only** the columns enumerated in `configColumnsOf` /
  `configColumnValuesOf` — the HEL-296 "single source of truth" (PanelRepository.scala:242-282). The two
  new columns must be added there in addition to the `PanelRow`/`PanelTable`/`*`-projection changes, or
  PATCH will silently fail to persist caption/annotation. Task 1.2's "SQL select/insert/update
  projections" arguably covers it, but given how load-bearing this is, name `configColumnsOf` /
  `configColumnValuesOf` explicitly.

- Empty/whitespace handling: Decision 3 says blank ⇒ rendered hidden and null/empty ⇒ cleared. When you
  finalize the model (CR 4), normalize empty/whitespace to `None` at the decode boundary so a cleared
  caption round-trips as omitted (not as a stored `""`), keeping read-back and the response wire shape
  consistent with CRs 1-3.
