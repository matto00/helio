## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **No premature implementation.** `git status --short` shows only the new
   `openspec/changes/bound-caption-annotation-fields/` directory; `workflow-state.md` confirms
   `PHASE: Planning (design gate)`, `CYCLE: 0`. This is a clean plan-only review.

2. **Core claim — `fieldMapping` is free-form, no allowlist, no schema change needed:**
   - `backend/src/main/scala/com/helio/domain/Panel.scala:135-139` —
     `selectedFieldsFromMapping` collects **all** `JsString` values from the mapping object,
     keyed by nothing in particular; no slot allowlist exists.
   - `backend/src/main/scala/com/helio/domain/panels/ChartPanel.scala` —
     `ChartPanelConfig.decodeInternal`/`Patch.decode` accept `fieldMapping` as an arbitrary
     `JsObject` (`case Some(o: JsObject) => o` / `Some(Some(o))`), with zero per-key validation.
     `buildQuery` (line 302-308) calls `Panel.selectedFieldsFromMapping(fieldMapping)` directly.
   - `backend/src/main/scala/com/helio/api/RequestValidation.scala` — only validates
     `chartType` enum values; no `fieldMapping` key validation exists anywhere in the file.
   - `schemas/panel.schema.json:93` — chart's `fieldMapping` is typed `{ "type": "object" }`
     with no `additionalProperties: false` or enum restriction.
   - **Verdict: the "near-zero backend change" claim is accurate.** A PATCH setting
     `fieldMapping.annotation` will round-trip today with no code change required.

3. **Frontend data-resolution claim — `usePanelData` already resolves arbitrary
   `fieldMapping` slots against the first row:**
   - `frontend/src/features/panels/hooks/usePanelData.ts:164-187` — the `data` memo iterates
     `Object.entries(fieldMapping)` generically (not chart-specific, not slot-specific) and
     maps every slot to `String(firstRow[field])`. `MappedPanelData` is `Record<string,string>`
     (`frontend/src/features/panels/types/panel.ts:464`). Adding an `annotation` key to
     `fieldMapping` will surface as `data.annotation` with zero changes to this hook.
   - Confirms D2's `config.annotation ?? data?.annotation ?? null` resolution is directly
     supported by existing plumbing.

4. **Editor reuse claim — `BoundOrLiteralField` + `useBoundOrLiteralState` pattern is real
   and already used exactly this way for Metric label/unit:**
   - `frontend/src/features/panels/ui/editors/BoundOrLiteralField.tsx` and
     `useBoundOrLiteralState.ts` exist with the mode-toggle / literal-vs-field contract the
     design describes verbatim (`defaultBoundOrLiteralMode`, `patchValue`/`fieldMappingValue`
     clear-the-other-side semantics).
   - `BindingEditor.tsx:95-138` wires `labelState`/`unitState` via this exact hook for Metric;
     `ChartDisplayFields.tsx:96-108` currently renders the annotation as a **plain `TextField`**
     bound to a bare `annotation: string` prop — confirming D3's premise that today's chart
     annotation control needs to be swapped for `BoundOrLiteralField`.
   - One nuance I looked for and confirmed is *not* a blocker: `BindingEditor.tsx:214-223`
     currently derives the outgoing `fieldMapping` for chart panels as the raw `fieldMapping`
     state object (built by `FieldMappingSlots`/`setFieldMapping`), not a per-slot merge like
     Metric's `label`/`unit`. Wiring the new `annotationState.fieldMappingValue` into that
     object (mirroring the Metric merge at lines 218-221) is an implementation detail that
     falls out naturally from reading this file — tasks 2.2/2.3 and the Impact section already
     name `BindingEditor`/`useChartDisplayState` as touched files, so this isn't unaddressed,
     just not spelled out at the line level. Non-blocking.

5. **AC3 (image-caption deferral) — genuinely justified, not a cop-out:**
   - `backend/src/main/scala/com/helio/domain/panels/ImagePanel.scala:14,105-106,110` —
     `ImagePanelConfig` has no `dataTypeId`/`fieldMapping` fields at all; `ImagePanel.dataTypeId`
     is hardcoded `None`, `fieldMapping` hardcoded `None`, `buildQuery` hardcoded `None`. Image
     panels are unconditionally unbound at the domain-model level — this is a real, verifiable
     structural gap, not a hand-wave.
   - By contrast, chart panels already carry `dataTypeId`/`fieldMapping` and a real
     `buildQuery`, so the asymmetry the design cites (chart tractable, image not) is accurate.
   - One inaccuracy in the framing (non-blocking): design.md/the `image-panel-type` spec delta
     both say deferring image binding is "the same...prerequisite already documented for
     Text/Markdown." I checked `backend/src/main/scala/com/helio/domain/panels/TextPanel.scala`
     — Text panels **already have** `dataTypeId`/`fieldMapping` (HEL-244 shipped this), so that
     baseline-spec sentence in `panel-config-field-or-literal-pattern` (line 51-55) is now
     stale documentation, not a currently-true parallel. The core justification for deferring
     Image (verified in the bullet above) stands on its own regardless of this stale citation.

6. **Spec deltas checked against baselines for conflicts/completeness:**
   - `openspec/specs/echarts-chart-panel/spec.md:175-188` (baseline "editor exposes a text
     control for annotation") is correctly targeted by the MODIFIED requirement in the delta —
     no orphaned/contradicting baseline text.
   - `openspec/specs/image-panel-type/spec.md` has an existing "static caption" requirement
     (HEL-318) that the new ADDED "binding is out of scope" requirement complements without
     contradiction.
   - `openspec/specs/panel-config-field-or-literal-pattern/spec.md` has no existing "chart is a
     consumer" requirement, so the new ADDED requirement is a clean, non-duplicating addition.
   - `helio-mcp/src/tools/write.ts:238,276` — verified the two doc strings task 1.3 targets are
     real (chart annotation doc at create_panel; fieldMapping-by-type doc at bind_panel) and
     both currently omit any mention of a bound annotation slot — task is concrete and scoped.

7. **AC-to-task traceability:** AC1 → tasks 2.1-2.4 + spec scenarios in echarts-chart-panel.
   AC2 → D2 literal-wins + task 3.1 test. AC3 → D4 + image-panel-type spec delta. AC4 → task
   3.3 (backend round-trip test) + task 3.4 (full gate suite). All four covered by name.

8. **No placeholders/TODOs/hand-waving:** `grep -rniE "TODO|TBD|figure out|to be decided|
   placeholder"` across all planning `.md` files returned nothing.

### Verdict: CONFIRM

The design is sound: every load-bearing technical claim (no backend/schema/migration change,
`selectedFieldsFromMapping`'s lack of an allowlist, `usePanelData`'s generic slot resolution,
the `BoundOrLiteralField` reuse contract, and Image's genuine lack of binding infrastructure)
checks out against the actual code, not just narrative. The AC3 deferral is a legitimate,
verifiably-grounded scope cut, not an excuse. All four acceptance criteria are traceable to
specific tasks and spec scenarios.

### Non-blocking notes

1. The design's framing that Image's deferral mirrors "the same...prerequisite already
   documented for Text/Markdown" cites a now-stale baseline-spec sentence (Text/Markdown have
   since gained `dataTypeId`/`fieldMapping` via HEL-244/245). This doesn't weaken the Image
   argument itself (independently verified true), but the executor should not lean on this
   specific analogy as if Text/Markdown were still unbound — consider dropping or updating the
   cross-reference when touching `panel-config-field-or-literal-pattern`'s baseline spec later.
2. Task 2.2/2.3 don't spell out that chart's `outgoingFieldMapping` in `BindingEditor.tsx` is
   currently built from the raw `fieldMapping` state (`FieldMappingSlots`), not a per-slot
   merge like Metric's label/unit — the executor will need to merge
   `annotationState.fieldMappingValue` into that raw object (mirroring the Metric pattern at
   `BindingEditor.tsx:218-221`). This is discoverable by reading the file and is already an
   implied touch-point, but flagging it here so the executor doesn't miss the merge on first
   pass.
