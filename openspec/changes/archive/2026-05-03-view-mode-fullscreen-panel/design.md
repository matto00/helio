## Context

`PanelDetailModal` (540 × 680px) currently opens directly into the Appearance tab. The modal renders edit controls immediately regardless of user intent. HEL-174 inserts a **view mode** as the default opening state — a clean, read-only render of the panel's content that fills the modal body. Existing edit functionality becomes a secondary state reached via an "Edit" button.

The key existing component is `PanelDetailModal.tsx` + `PanelDetailModal.css`. Panel rendering already exists in `PanelContent.tsx` which is used in the grid — this same component can be reused inside the modal for view mode.

## Goals / Non-Goals

**Goals:**
- Modal opens in view mode by default (a `modalMode` state: `"view" | "edit"`)
- View mode hides the tab bar and footer actions, maximising content area
- View mode shows the panel title and a close button in the header, plus an "Edit" button (pencil icon or label) for users with write intent
- Clicking "Edit" transitions to edit mode (the current tab UI)
- No backend changes; no new Redux state beyond the local `modalMode`

**Non-Goals:**
- Permission enforcement (edit button is visible to all for now; back-end ACL is a separate ticket)
- Data-live rendering (panel content in view mode may still show placeholder content for data-connected panels)
- Redesigning the existing edit-mode tab layout

## Decisions

**Decision: Local `modalMode` state, not Redux**
The modal is a short-lived overlay; its internal open/edit state doesn't need to survive re-renders or be shared. `useState<"view" | "edit">("view")` inside `PanelDetailModal` is the right scope. Rationale: consistent with existing tab state (`activeTab`), keeps Redux clean.

**Decision: Reuse `PanelContent` for view mode body**
`PanelContent.tsx` already renders the panel correctly inside the grid. Importing it into the modal gives consistent rendering without duplication. The modal will supply a fixed container `className` that sizes the content area to fill the available height (flex: 1).

**Decision: "Edit" button in header (not a tab)**
A tab labelled "Edit" would conflict with the existing Appearance/Data/Content tabs. An icon-button or text button in the header row ("Edit" or pencil icon) is cleaner and matches the modal-as-viewer pattern.

**Decision: Discard warning still applies in edit mode**
View mode is clean — no warning needed on close from view mode. The warning only fires if the user entered edit mode and made changes. This is already handled by `isAnyDirtyRef`; view-mode close bypasses the check entirely.

**Decision: Modal size stays the same**
`min(540px, 96vw)` × `min(680px, 90vh)`. View mode fills the content area (flex: 1) within the existing dialog size. No resize needed — the panel content will scale inside its container.

## Risks / Trade-offs

- `PanelContent` in a modal context may behave differently than in the grid (no container query triggers). Mitigation: the executor should test rendering for at least one panel type (metric, markdown) and confirm the content area sizes correctly.
- Tests currently assert `Appearance tab is active by default` — these will need updating to assert view mode is the default. Mitigation: test file update is straightforward; executor updates `PanelDetailModal.test.tsx`.

## Planner Notes

Self-approved: purely frontend, no API or schema changes, additive behaviour. No new external deps. Change is well-scoped and low-risk.
