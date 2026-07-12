## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Current-state claims in design.md/proposal.md vs. actual code** — read
  `frontend/src/features/panels/ui/editors/BindingEditor.tsx` in full. Confirmed:
  - Metric renders `PANEL_SLOTS.metric` (value/label/unit) as a generic field-mapping
    loop (lines 276-299) followed by a separate "Aggregation" section (lines 301-345)
    exactly as design.md's Context section describes.
  - `panelSlots.ts` confirms `PANEL_SLOTS.metric = [value, label, unit]`.
  - `usePanelData.ts` (lines 157-180): the `data` memo builds `mapped` from
    `fieldMapping` first, then unconditionally overwrites `mapped.value` when
    `metricAggregation` is present (lines 168-171) — confirms design.md's claim that
    "aggregation silently overrides fieldMapping.value" (override runs after the
    fieldMapping loop). The plan to initialize `MetricValueEditor`'s mode from
    `aggregation` first, falling back to `fieldMapping.value` (task 2.3), is therefore
    correctly aligned with actual runtime resolution — opening the editor won't flip
    rendered behavior for panels with both keys set (a real pre-existing state per
    `aggregationDirty`'s cycle-3 fix comment at BindingEditor.tsx:116-130).
  - `MetricPanel.scala:12-17,58-67` (`MetricPanelConfig`, `Patch`) already carries
    `label`/`unit` with full absent/null/value `Patch` semantics — confirms
    "no backend changes" and "no schema changes" claims are accurate.
  - `panelPayloads.ts` `buildBindingPatch` (lines 108-121) already follows the
    undefined/null/value convention for `aggregation`; extending it with `label`/`unit`
    per Decision 3 is a mechanical, low-risk change — confirmed via
    `panelThunks.ts:156-186` and `panelService.ts:94-107`, which already thread
    `aggregation` through the same call chain design.md targets.
  - `panelNarrowing.ts` `getMetricLiteral` (lines 120-134) and `MetricRenderer.tsx`
    (lines 21-51, "No data" keyed on `hasValue`, not label presence) confirm HEL-293's
    literal-wins precedence and HEL-295's no-false-"No data" guard are both
    independent of the config-UI reorganization this ticket proposes — neither file
    is touched per design.md's stated impact list, and neither needs to be.
- **`openspec validate`**: ran `npx openspec validate metric-panel-config-redesign
  --strict` → `Change 'metric-panel-config-redesign' is valid` (structural pass, as
  the prompt already noted).
- **Semantic soundness of MODIFIED requirements vs. what's NOT changing** — read the
  live specs `openspec/specs/panel-datatype-binding/spec.md` and
  `openspec/specs/panel-viz-aggregation/spec.md` in full, and diffed them against the
  change's delta files. Found a real gap (see Change Request 1).
- **Generalizability of the reusable pattern** — read `panel.ts`'s `PanelKind` union
  and `TextPanelConfig`/`MarkdownPanelConfig` (lines 108-114): today Text/Markdown
  panels have **no** `dataTypeId`/`fieldMapping` at all (`content: string` is a pure
  literal, not part of the "bound trio" per `panel.ts:61-62`'s own comment). Found a
  wording issue (see Change Request 2).
- **DESIGN.md compliance**: read §5 (Buttons) and §6 (Shared components). Decision 2's
  plan to build the mode toggle from existing ghost/secondary button recipes (not a
  new button style) and Planner Notes' explicit judgment call on `BoundOrLiteralField`'s
  location (panels feature vs. `shared/ui/`, promote later when a second consumer
  lands) both cite and comply with the actual DESIGN.md sections, not just
  paraphrase them.
- **Scope discipline**: confirmed frontend-only — no `backend/src` changes required
  per `MetricPanel.scala` already carrying `label`/`unit`, and no `schemas/*.json`
  change needed (not independently re-verified against the schema file text, but the
  claim is consistent with `MetricPanel.scala`'s existing wire shape).

### Verdict: REFUTE

### Change Requests

1. **Stale/contradictory requirement left unmodified in `panel-datatype-binding`.**
   The live spec `openspec/specs/panel-datatype-binding/spec.md` has a requirement
   "Binding editor exposes aggregation controls for metric and chart panels" (lines
   156-171) that states: "for metric and chart panel types, show an Aggregation
   sub-section **alongside field mapping**: metric panels get a field selector plus
   an agg-function selector... chart panels get a group-by field selector, an
   agg-function selector, and a value-field selector," with a scenario "Metric panel
   Data section shows aggregation controls... an Aggregation sub-section is shown."
   This is the **old** metric UI shape this ticket is replacing (per design.md
   Decision 1: metric no longer has a separate Aggregation sub-section at all — it's
   merged into the single Value control). The change's
   `specs/panel-datatype-binding/spec.md` delta only MODIFIES "Field mapping slots
   are appropriate to the panel type" — it does not touch "Binding editor exposes
   aggregation controls for metric and chart panels." Once archived, the merged spec
   would contain two directly contradictory descriptions of metric's Data-section UI
   (one saying "unified Value control, no field-mapping row" via the
   already-modified requirement; the other still saying "separate Aggregation
   sub-section with its own field + agg-function selectors alongside field mapping").
   **Required fix**: add a MODIFIED delta for "Binding editor exposes aggregation
   controls for metric and chart panels" that narrows the requirement/scenario to
   chart-only (chart keeps the field selector + agg-function selector + value-field
   selector sub-section, unaffected), and removes or redirects the metric-specific
   scenario to point at the new unified Value control (already covered by the
   `panel-viz-aggregation` delta and the `panel-config-field-or-literal-pattern`
   capability).

2. **Overstated present-tense generalizability claim for Text/Markdown.** The new
   capability spec (`specs/panel-config-field-or-literal-pattern/spec.md`, Requirement
   "The field-or-literal pattern is documented as reusable...") asserts HEL-244/245/247
   "each of which has at least one slot that is either a DataType field binding or
   literal content" (present tense). Verified against `panel.ts`: Text/Markdown
   `PanelConfig`s (lines 108-114) have no `dataTypeId`/`fieldMapping` today — `content`
   is unconditionally literal; these types aren't part of `isBoundCapablePanel`
   (`panelNarrowing.ts:40-41`). So the "either bind or literal" choice does not exist
   yet for Text/Markdown; HEL-244/245 will first need to extend those panel configs
   with DataType-binding capability before `BoundOrLiteralField` can be wired to their
   `content` slot. Given this ticket's explicit charter is to let HEL-244/245/247
   "mirror it without re-deriving the approach," leaving this premise inaccurate
   risks those tickets under-scoping (assuming the binding plumbing already exists).
   **Required fix**: reword design.md Decision 4 / the spec requirement to state
   explicitly that Text/Markdown currently have no DataType-binding infrastructure for
   `content`, and that HEL-244/245 must add it (their own `dataTypeId`/`fieldMapping`
   or equivalent) before reusing `BoundOrLiteralField` — i.e. this ticket ships the
   *control* pattern, not evidence that the *binding* prerequisite is already met for
   those panel types.

### Non-blocking notes

- `MetricRenderer.tsx:31-36`'s in-code comment still references "the sibling
  config-depth ticket under HEL-291" for literal-text overrides, which reads as
  pre-HEL-293 stale documentation (HEL-293 already shipped `config.label`/`unit`).
  Not this ticket's fault to fix, but worth a follow-up cleanup note since HEL-243's
  own new code will sit right next to it.
