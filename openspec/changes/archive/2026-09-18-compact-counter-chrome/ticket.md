# HEL-1088: Input/counter configuration: compact single-field chrome

## Description

A form with one field renders in a compact chrome suited to a small panel: the value, `+`/`−` affordances, and a configurable step size. Same panel kind, same submit path.

**AC:** increment and decrement are operable by keyboard; the control exposes its current value and step to assistive technology.

---

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627)

## Additional context (orchestrator brief, verified against the tree before Planning)

- This is a **configuration of the existing `form` panel kind**, not a new panel kind and not a new route. Every increment must go through the existing `POST /api/panels/:id/submit` and append a `delta` row exactly as HEL-1087/HEL-1089 already wired. If the design requires a new endpoint or PanelKind, that contradicts the epic's decision and must be escalated, not built.
- HEL-1089 (merged `9f26b0d5`) added `case "counter"` to `frontend/src/features/panels/ui/form/FormFieldControl.tsx`: a plain numeric `TextField`, `aria-required="true"`, explicit comment deferring the compact `+`/`-`/step chrome to this ticket. That is the starting point — replace the placeholder, do not build a new field type.
- Counter field semantics per HEL-1089 (verify directly, do not trust restated): a counter field's submitted value is a **numeric `delta`**; `occurred_at` is always server-assigned (client values ignored); `value` is a non-authoritative snapshot; the running total is derived by pipeline aggregate over `delta`, never stored server-side.
- "Exposes current value and step to assistive technology" is a **computed ARIA** requirement — `aria-valuenow`/`aria-valuetext`/`aria-valuemin`/`aria-valuemax` or full spinbutton role semantics, whichever is actually correct for this control. Presence-only assertions in jsdom are insufficient (see `MISTAKES.md` C8 — HEL-1084 shipped an unannounced `role="alert"` with no `id` and passed two evaluator cycles on a presence check).
- "A form with one field" is a condition needing explicit boundary handling: zero fields, one non-counter field, one counter field, two fields where one is a counter. A silent fallthrough that renders nothing is a known prior defect shape (HEL-1089's evaluator caught exactly this for a different control).
- `PanelPacker` currently clamps `PanelKind.Form -> ClampBounds(minW=3, minH=5, maxH=24)` (HEL-1085). Compact chrome may warrant different bounds for the single-counter-field case; any change must ship with its own spec/test case.
- Standing write-path caution: increments append real rows. Any executor/evaluator verification of a rejected/failed increment must confirm it writes nothing (row counts before/after), and that rows land only on the bound `dataSourceId`.
