# HEL-127 — Fix popover clipping: render all popovers via portal

**Priority:** High
**Project:** Helio v1.3.1 — Polish & Hardening

## Description

ActionsMenu and DashboardAppearanceEditor popovers were clipped by parent overflow/stacking contexts. Both were fixed by rendering via `createPortal` to `document.body` with position calculated from `getBoundingClientRect()`. This ticket tracks any remaining popovers that haven't been ported yet, and establishes a shared `usePortalPopover` hook to avoid duplicating the logic in each component.

## Acceptance Criteria ("done" looks like)

- Audit all popover usages in the codebase
- Extract portal + positioning logic into a shared hook or component
- All popovers are viewport-aware (never clip off-screen)

## Context

The pattern already in use (from existing fixes):
- Render popover content via `ReactDOM.createPortal(content, document.body)`
- Anchor position calculated with `getBoundingClientRect()` on the trigger element
- Position tracked in local state, updated on open and optionally on scroll/resize

Any remaining popovers that use CSS-relative positioning (e.g. `position: absolute` within a parent container) are susceptible to clipping and must be ported to the portal pattern.

The shared hook (`usePortalPopover`) should encapsulate:
- Ref for the trigger element
- Open/close state
- Position state (top, left, or similar)
- A function to recalculate position from `getBoundingClientRect()`
- Returns everything needed to wire up trigger and portal content

## Linear URL

https://linear.app/helioapp/issue/HEL-127/fix-popover-clipping-render-all-popovers-via-portal
