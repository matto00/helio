## Context

Panel rendering and editing already run through selected-dashboard context and backend-backed fetch flows, but panel creation is still missing from the frontend. `HEL-10` adds create behavior while keeping concerns separated: services handle API I/O, slice thunks coordinate async flow, and `PanelList` owns inline creation UI.

## Goals / Non-Goals

**Goals:**
- Enable panel creation from the frontend via backend API.
- Keep create interactions inline in the panel list for fast workflow.
- Refresh selected dashboard panels after successful creation.
- Keep async logic centralized in the panels slice.
- Keep feedback simple and explicit (inline loading/error).

**Non-Goals:**
- Panel creation modal or multi-step workflows.
- Rich panel metadata configuration in create flow.
- Changes to backend panel creation contract.
- Global loading/toast system changes.

## Decisions

### Place create controls in `PanelList`
Panel creation starts from a `+` icon in the panel list header and opens an inline title field with `Create panel`.

Alternative considered:
- Creating from panel grid cards was rejected because new panel creation is list-level context, not per-card context.

### Add `createPanel` thunk in panels slice
The thunk calls create API and then refreshes selected dashboard panels.

Alternative considered:
- Calling service directly from component and then manually mutating local state was rejected to keep async orchestration testable and centralized.

### Refresh panels after create instead of local append-only state mutation
After successful create, re-fetch selected dashboard panels for source-of-truth consistency with backend ordering/normalization.

Alternative considered:
- Appending created panel locally without refresh was rejected because it could diverge from backend-backed ordering/normalization behavior.

## Risks / Trade-offs

- [Create + refresh introduces an extra request] -> Accept for now to preserve correctness and align with acceptance criteria.
- [User can trigger create without selected dashboard] -> Disable create controls when no dashboard is selected.
- [Inline create can crowd header] -> Keep controls compact and only render input while create mode is active.
