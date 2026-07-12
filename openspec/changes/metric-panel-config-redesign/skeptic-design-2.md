## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- **Change Request 1 (round 1) resolved.** Read the change's live delta for
  `openspec/specs/panel-datatype-binding/spec.md`: it now includes a MODIFIED
  requirement "Binding editor exposes aggregation controls for metric and chart
  panels" (lines 21-36) that narrows metric's aggregation exposure to "through the
  unified Value control ... rather than a separate Aggregation sub-section — metric
  no longer has an Aggregation sub-section at all," while leaving chart's
  group-by/agg-function/value-field sub-section untouched. This directly replaces
  the stale requirement flagged in round 1. Confirmed against the live spec
  (`openspec/specs/panel-datatype-binding/spec.md:156-171`, unmodified base text) that
  the delta's "### Requirement:" header text-matches exactly, so `openspec` will
  apply it as a genuine modification, not a duplicate/orphan section.

- **Change Request 2 (round 1) resolved.** `design.md` Decision 4 (lines 91-100) now
  reads: "Prerequisite HEL-244/245 must complete first, before reusing pattern 1" and
  explicitly states `TextPanelConfig`/`MarkdownPanelConfig` (`panel.ts:108-114`) have
  no `dataTypeId`/`fieldMapping` today, `content` is unconditionally literal, and
  HEL-244/245 must add DataType-binding infrastructure before wiring
  `BoundOrLiteralField` to `content`. The new capability spec's requirement (spec.md
  lines 39-52) was reworded to "once that panel type's DataType-binding
  infrastructure exists" (future-conditional, not present-tense) and gained a new
  scenario "Design doc documents the binding-infrastructure prerequisite for
  Text/Markdown" (lines 48-52) making the prerequisite explicit and discoverable by a
  follow-on ticket. Re-verified against `panelNarrowing.ts:40` — `isBoundCapablePanel`
  still only covers Metric/Chart/Table — confirming the claim is still accurate.

- **No new contradiction introduced by the fixes.** Read all three MODIFIED/ADDED
  requirement sets together as they will merge:
  - `panel-datatype-binding`'s "Field mapping slots are appropriate to the panel
    type" delta (metric: no generic dropdown list, uses Value control + Label/Unit
    bind-or-literal controls) and its "Binding editor exposes aggregation controls"
    delta (metric: no separate Aggregation section, exposed via the same Value
    control) describe the same end state from two angles and do not conflict —
    both agree metric's Data section collapses field-mapping-list + Aggregation into
    one Value control plus two Label/Unit controls; chart is explicitly carved out
    unchanged in both.
  - `panel-viz-aggregation`'s MODIFIED requirement ("Metric panel supports a
    viz-level aggregation spec") adds the same unified-Value-control description
    plus the mutual-exclusivity mechanics (Reduce="None" writes fieldMapping.value
    and clears aggregation; any other reduce clears fieldMapping.value and writes
    aggregation) — consistent with, and a superset of, the other two deltas' framing.
  - `panel-config-field-or-literal-pattern`'s ADDED requirements (Label/Unit
    bind-or-literal controls, editable post-creation) are additive and don't
    restate or contradict the above; the prerequisite language for Text/Markdown is
    scoped to a separate requirement and doesn't leak into the Metric-specific
    requirements.
  No orphaned reference to the old "separate Aggregation section for metric" shape
  remains anywhere across the three delta files.

- **`openspec validate --strict`**: ran `npx openspec validate
  metric-panel-config-redesign --strict` → `Change 'metric-panel-config-redesign' is
  valid`.

- **Re-verified round-1 code-accuracy claims fresh (not trusted from the prior
  report):**
  - `BindingEditor.tsx:276-345` (current, pre-change code) still shows the generic
    per-slot field-mapping loop followed by the separate metric/chart "Aggregation"
    `data-section` block exactly as design.md's Context describes — confirms the
    "today" baseline design.md is reasoning from is still accurate.
  - `usePanelData.ts`'s `data` memo (lines ~157-178) still overwrites `mapped.value`
    from `metricAggregation` after the fieldMapping loop runs, and still applies
    `metricLiteral.label`/`unit` after that — confirms design.md's claimed
    override-precedence (aggregation wins over fieldMapping.value; literal wins over
    fieldMapping-resolved label/unit) is accurate to current runtime behavior.
  - `MetricPanel.scala:12-17` (`MetricPanelConfig` case class) and its `Patch`
    (lines 58-67) still carry `aggregation: Option[JsObject]`, `label: Option[String]`,
    `unit: Option[String]` with full absent/null/value semantics — confirms "no
    backend changes" claim.
  - `panelPayloads.ts`'s `buildBindingPatch` (~line 108) still accepts only
    `aggregation` (not yet `label`/`unit`) following the absent/null/value
    convention — confirms Decision 3's plan to extend it is a real, not-yet-done
    gap, i.e. the ticket is doing real work here, not restating existing behavior.
  - `schemas/panel.schema.json:55-62` already documents `aggregation`, `label`, and
    `unit` on the Metric panel schema — confirms "no schema changes" claim.
  - `panelSlots.ts` confirms `PANEL_SLOTS.metric = [value, label, unit]` unchanged
    (Decision 1's claim that `PANEL_SLOTS` itself doesn't change, only
    `BindingEditor`'s per-type branching).

- **DESIGN.md compliance (re-checked, not just re-cited):** §5 (Buttons, lines
  156-171) and §6 (Shared components, lines 172-184) read in full. Decision 2's
  reuse of the ghost/secondary button recipe for the mode toggle and the Planner
  Notes' explicit judgment call on `BoundOrLiteralField`'s placement (panels feature,
  not `shared/ui/`, until a second consumer lands) are both consistent with these
  sections' actual text, not paraphrases that drift from it.

- **Scope discipline:** `tasks.md` tasks 1.1-4.4 map 1:1 onto design.md's four
  Decisions with no additional scope; non-goals in proposal.md (no chart/table
  change, no backend/schema change, no HEL-244/245/247 implementation) are upheld
  throughout design.md and tasks.md — no drift found.

### Verdict: CONFIRM

### Non-blocking notes

- (Carried from round 1, still applicable) `MetricRenderer.tsx:31-36`'s in-code
  comment still references "the sibling config-depth ticket under HEL-291" —
  pre-HEL-293 stale documentation adjacent to where this ticket's new code will
  land. Not blocking; worth a follow-up cleanup note during execution.
