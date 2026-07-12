# HEL-244: Text panel config redesign — DataType integration

Parent epic: HEL-239 (v1.5 Panel System v2)

## Description

Apply the same DataType-integration pattern from the Metric panel redesign
(HEL-243) to Text panels. Text panels should be able to render a single text
value derived from a DataType (via filter or smart pipeline), not just static
authored copy.

## Acceptance criteria

- Text panel config has a "Source" mode: bind to a DataType + select a single
  string field
- Text panel config has a "Static" mode: author copy directly (current
  behavior)
- The two modes are exposed cleanly in the config UI

## Definition of done

- Text panels can render dynamic text from a DataType
- Static authoring still works for non-bound panels
- Config UI matches the pattern from Metric panel redesign

## Orchestrator-supplied context (from the human operator)

This is scoped as "same pattern as Metric" (HEL-243, merged to main at
bc8d2ac6). Mirror HEL-243's pattern:

- Archived design: `openspec/changes/archive/2026-07-12-metric-panel-config-redesign/design.md`
  — this explicitly documents the reusable "field-or-literal" (pattern 1) and
  "value + optional reduce" (pattern 2) shapes for HEL-244/245/247 to copy, and
  its own Decision 4 / Planner Notes call out that **Text/Markdown need their
  own DataType-binding infrastructure added first**, since neither has a
  `dataTypeId`/`fieldMapping` today — `content` is unconditionally literal, and
  neither type is part of the "bound trio" (`isBoundCapablePanel`,
  `panelNarrowing.ts`).
- Reusable component: `BoundOrLiteralField`
  (`frontend/src/features/panels/ui/editors/BoundOrLiteralField.tsx`) + its
  companion state-lifting shape (see `MetricValueEditor` for the pattern,
  colocated in `BindingEditor.tsx`/`panels/ui/editors/`). Reuse directly rather
  than re-deriving the interaction model.
- `DataTypePicker` — reuse the existing component for DataType selection.

### CRITICAL PREREQUISITE — this is a vertical slice, not a cosmetic reskin

Text panels currently store only `content` — see:

- Backend: `TextPanelConfig` in
  `backend/src/main/scala/com/helio/domain/panels/TextPanel.scala`
- Frontend: `TextPanelConfig` type (`frontend/src/features/panels/state/panel.ts`,
  roughly lines 108-114 per the archived design's reference — confirm current
  location)

Integrating a DataType means **adding binding fields** (a `dataTypeId` + a
field/content mapping) to the Text panel config end-to-end:

- Backend `TextPanelConfig` + codec/patch/decode
- Flyway migration — next free version. Main is at bc8d2ac6; HEL-253 used
  V53. Confirm the next free version against the migration directory before
  writing it (expected V54, but re-check — do not assume, another change
  could have landed).
- `schemas/panel.schema.json`
- Frontend config editor (apply `BoundOrLiteralField` to the `content` slot
  once the binding exists — per Decision 4 of the archived Metric design)
- How `TextRenderer` / `usePanelData` resolve bound vs. literal content

### Escalation discipline

If, during discovery/planning, this DataType-binding infrastructure for Text
is found to be large enough that it should be its own separable ticket
(rather than bundled into the config-redesign), **escalate that boundary
question to the human before building** — same discipline that served
HEL-252/HEL-253. Otherwise proceed with the full slice.

### Standing constraints

- Bind to `DESIGN.md` for all frontend work.
- No regression to existing Text panels that only use literal `content`.
- Backend: keep Pekko protocols explicit; keep schema updates in the same
  change as related client/server code (per root CLAUDE.md).

### Delivery protocol (human-imposed, orchestrator-level — not implementation scope)

- Repo auto-merge is disabled; the human handles merges. The orchestrator
  presents the PR and pauses at delivery — it does not merge.
- If a rebase needs a force-push, the orchestrator pauses and asks the human
  directly — never relayed through this ticket's approvals.
