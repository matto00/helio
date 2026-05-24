# HEL-258 — Rework dashboard chrome layout: panel count, create, zoom controls

## Description

The current arrangement of panel-count indicator, create-panel button, and zoom controls feels cluttered.

## Proposed layout

* **Zoom controls** → bottom-right (floating, similar to a map zoom widget)
* **Create-panel button** → next to the panel-count indicator (right of the count)
* Reduce visual weight of the count indicator if needed

## Explore (use this ticket as a UI nit bucket)

* Spacing between panel-grid edge and chrome
* Whether the panel count should be a chip/pill or just text
* Whether zoom buttons should auto-hide on inactivity
* Any other layout nits noticed during execution

## Definition of done

* New layout shipped and feels cleaner in side-by-side comparison
* Mobile / narrow viewport handling reasonable (zoom controls don't overlap content)
* Any additional UI nits surfaced during work are either resolved here or filed as follow-ups

## Context

This ticket is part of the v1.3.1 UI-polish batch. Prior batch changes already on the branch:
- HEL-128: Sidebar sizing, icon consistency, panel drag handle sizing
- HEL-284: PanelCard extracted into PanelCard.tsx, panel drag re-render perf fix (memoized PanelCardBody)

Build on those changes; do not revert them.
