## Context

`PanelCreationModal.tsx` (HEL-211) already has a DataType picker step (`datatype-select`) that
computes `registryDataTypes` — the intersection of all DataTypes with those referenced by at least
one pipeline `outputDataTypeId`. When `registryDataTypes.length === 0`, an empty `<div>` is
rendered with static explanatory text but no navigational CTA. The user has no path forward.

The Pipelines page lives at `/pipelines` (React Router route in `App.tsx`). `CreatePipelineModal`
is a standalone component accepting only `onClose`.

## Goals / Non-Goals

**Goals:**
- Add an actionable link inside the existing empty state `div` that navigates the user to the
  Pipelines page, allowing them to create a pipeline and register a DataType.
- Improve empty state copy to be friendlier and more directive.
- Ensure the Next button remains disabled (it already is since `selectedDataTypeId` is null).

**Non-Goals:**
- Opening `CreatePipelineModal` inline inside the panel creation modal (adds layout complexity,
  not necessary).
- Any backend change.
- Changing the empty state for cases where pipelines exist but produce no DataTypes (same UI applies,
  and the copy is accurate).

## Decisions

### Use React Router `<Link>` to `/pipelines`, not an inline modal

The simplest correct approach is a `<Link to="/pipelines">` inside the empty state. Navigation
closes the panel creation modal implicitly (route change unmounts it) and lands the user on the
Pipelines page where they can create a pipeline. Opening `CreatePipelineModal` inside the panel
modal would require additional state management and the UX is confusing (two modal layers).

### Keep the empty state inside `PanelCreationModal`, not extracted to a separate component

The empty state is a single `div` with two lines of text and a link. Extracting it to a standalone
component would be premature. If other empty states follow the same pattern, extraction can be
revisited then.

### Loading state: show spinner/placeholder while pipelines are loading

Currently the component fetches pipelines on mount. While `pipelines.status === "loading"` or
`dataTypes.status === "loading"`, the DataType list is empty, which could falsely trigger the
empty state. The existing code already handles this because the empty state div renders regardless;
the fix should guard it: only show the empty state when both slices have finished loading
(`status === "succeeded"`), otherwise show a loading indicator or nothing.

### CSS: add a link style under the existing `.panel-creation-modal__datatype-empty` block

A `__link` BEM modifier on an `<a>` or `<Link>` inside the empty state container, styled as a
muted inline link matching the modal's secondary button pattern.

## Risks / Trade-offs

- [Risk] Navigating away from the panel creation modal loses draft state (type selection,
  template choice). → Acceptable: the user explicitly clicked a link to leave; the modal will
  re-open fresh when they return. The discard confirmation prompt is NOT needed here since clicking
  a link is an intentional navigation action (not the same as clicking the close button).
- [Risk] Empty state shown transiently during loading → Mitigation: guard on `succeeded` status.

## Planner Notes

- Self-approved: frontend-only, no API changes, no breaking changes, clear solution.
- The `Link` import from `react-router-dom` is already available in the file (or can be added).
