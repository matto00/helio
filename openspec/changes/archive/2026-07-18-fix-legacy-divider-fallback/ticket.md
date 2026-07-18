# HEL-298 — Legacy divider panels render invisible — fallback references removed `--color-border` theme var

**Type:** Bug | **Priority:** Low | **Project:** Helio v1.5 — Panel System v2
**URL:** https://linear.app/helioapp/issue/HEL-298/legacy-divider-panels-render-invisible-fallback-references-removed

## Problem

`frontend/src/features/panels/ui/DividerPanel.tsx` falls back to the CSS custom property `--color-border` when a divider panel has no explicit color set. That variable **no longer exists** in the current theme system, so the fallback resolves to nothing and the divider renders as an **invisible line**.

Surfaced during HEL-249 (remove Divider from the creation surface). HEL-249 deliberately kept existing divider panels rendering/editable (hide-from-creation only), so this affects any legacy dashboard that already contains a divider with no explicit color.

**Pre-existing** — confirmed reproducible on `origin/main` independent of HEL-249; HEL-249 did not introduce or touch this fallback.

## Fix

Point the fallback at a color that exists in the current theme token system (e.g. the current border/subtle-line token per DESIGN.md), so a colorless legacy divider renders a visible line again. Verify in both light and dark themes.

## Acceptance criteria

- A divider panel with no explicit color renders a visible line in both light and dark mode.
- No regression for divider panels that DO set an explicit color.
- Bound to DESIGN.md tokens (no reintroduction of a non-existent variable).

## Session directives (binding, from the human operator)

- **Iron Laws — probe-confirm:** render a legacy divider without explicit color, verify invisibility first, then verify the fix in both themes.
- **Repro-widening:** grep the frontend for OTHER references to removed/renamed theme variables — the same failure class may hide elsewhere. Fix extra finds if trivially in the same class; otherwise report as spinoff candidates.
- Mobile verification standard (390×844, both themes) applies if panel rendering is touched.
- Playwright screenshots go to the session scratchpad or gitignored tmp — NEVER the repo root. Never bulk-delete by glob. Stay inside this worktree and ports 5471/8378 (a parallel HEL-305 cleanup may briefly run).
