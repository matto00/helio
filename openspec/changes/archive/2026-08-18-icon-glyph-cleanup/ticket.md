# HEL-740: Icon glyph cleanup: distinct sidebar icons + icon-button styling for Customize Dashboard / Refine with AI

## Description

Three small, low-risk icon/styling fixes from live user feedback on the shell chrome, bundled together since they're all isolated icon/class changes in adjacent files:

1. **Sidebar icon-rail glyph collision** (`frontend/src/shared/chrome/sections.ts`): the Data Types icon (`BookOpen`) and the Assistant icon (`MessageSquare`) both render as a horizontal rounded-rectangle-with-small-notch at 16px and read as duplicate "book" icons in the collapsed rail. Swap `MessageSquare` (Assistant, `sections.ts:103`) for a more distinct glyph (e.g. `Bot` or `MessageCircle`). Since both `Sidebar.tsx` and `BottomNav.tsx` derive their icon set from this single registry, one edit fixes both surfaces. Optionally also reconsider `Gauge` (Metrics) — read by the user as a clock/history icon rather than "metrics"; `ChartNoAxesColumn` or `TrendingUp` would signal metrics more directly. Distinct from HEL-726 (icon-rail *collapse mechanism*, not glyph choice) and HEL-443 (cross-*library* lucide/FontAwesome consistency).
2. **"Customize dashboard" → icon button** (`frontend/src/features/dashboards/ui/DashboardAppearanceEditor.tsx:271-282`): currently a bespoke text-pill (`dashboard-appearance-editor__trigger`), the only text button among the icon-only cluster in `CommandBar.tsx`'s right-hand toolbar. Move it onto the shared `cmd-btn cmd-btn--icon` recipe (`App.css:163`) already used by its neighbors, with an appropriate icon (e.g. `faSliders`), keeping the existing `aria-label="Customize dashboard appearance"` and adding a `title` tooltip. Reference HEL-718 (IconButton primitive) if that's landed by the time this is picked up — don't invent a fourth hand-rolled variant if the shared primitive already exists.
3. **"Refine with AI" → sparkle icon** (`CommandBar.tsx:208-218`): swap the current `faCommentDots` icon for a sparkle glyph (`faWandMagicSparkles` or equivalent), per explicit user request. Also a functional improvement, not just cosmetic: today this button's icon sits directly beside the "Open assistant" quick-launcher's icon (`faComments`) and the two read as near-duplicate chat bubbles despite being different features (dashboard-scoped refinement vs. the global assistant) — see HEL-717 for the deeper unification of the two underlying chat implementations, which this does NOT replace or close, only visually mitigates.

Filed 2026-08-17 from live UI feedback (screenshots of the collapsed sidebar rail and the dashboard toolbar).

## Acceptance Criteria

- Assistant sidebar icon (`sections.ts:103`, currently `MessageSquare`) is swapped for a visually distinct glyph (e.g. `Bot` or `MessageCircle`) so it no longer reads as a duplicate of the Data Types (`BookOpen`) icon at 16px in the collapsed rail. Change flows through both `Sidebar.tsx` and `BottomNav.tsx` since both derive from the shared registry in `sections.ts`.
- (Optional, included if low-risk) Metrics icon (currently `Gauge`) reconsidered for a glyph that reads clearly as "metrics" (e.g. `ChartNoAxesColumn` or `TrendingUp`).
- "Customize dashboard" trigger in `DashboardAppearanceEditor.tsx` is restyled onto the shared `cmd-btn cmd-btn--icon` recipe used by its `CommandBar.tsx` toolbar neighbors, using an appropriate icon (e.g. `faSliders`). Existing `aria-label="Customize dashboard appearance"` is preserved and a `title` tooltip is added. If the HEL-718 `IconButton` primitive has landed, use it rather than hand-rolling a fourth variant.
- "Refine with AI" button in `CommandBar.tsx` swaps its `faCommentDots` icon for a sparkle glyph (`faWandMagicSparkles` or equivalent) so it's visually distinct from the "Open assistant" quick-launcher's `faComments` icon.
- No behavioral/functional regressions — these are icon/class/styling-only changes; existing click handlers, aria-labels (except where explicitly noted above), and layout remain intact.

## Related Issues (context only, not in scope)

- HEL-726 — sidebar collapse-to-icon-rail mechanism (distinct from glyph choice here)
- HEL-443 — cross-library (lucide/FontAwesome) iconography consistency pass
- HEL-718 — IconButton primitive (reference/reuse if landed)
- HEL-717 — unifying the two chat surfaces (not replaced or closed by this ticket)
