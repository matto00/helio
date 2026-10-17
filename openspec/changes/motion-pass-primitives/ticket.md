# HEL-1584: Motion pass: apply motion primitives across dashboards, modals, palette, lists, assistant

## Description

The motion foundation (HEL-1573) delivers the tokens and primitives. This ticket puts them where they make Helio feel alive and not half-baked, ordered by payoff. Screens being rebuilt elsewhere in the epic (rail, tabs, pipeline spine, glass nav) own their own motion. This covers everything else.

1. **Panel grid:** panels slide to their new spots when added, removed or resized. Drag gets lift (shadow plus scale ~1.01) and a soft settle on drop. Staggered entrance when a dashboard loads.
2. **Data refresh:** metric values tween and the chart line morphs on refresh instead of a full redraw.
3. **Loading:** skeleton → content crossfade in place. Crossfade on the route-loading (Suspense) fallback.
4. **Panel → detail modal:** the card expands into the modal, and the modal backdrop fades with it (closes or supersedes HEL-1035).
5. **Command palette:** backdrop fade, the panel drops ~6px with gentle overshoot, results stagger ~30ms.
6. **Assistant:** proposal items build in progressively, and applying a proposal animates new panels into the grid.
7. **Feedback:** a subtle check on layout save, and a failed run nudges its status icon once.
8. **Mobile:** sheets follow the finger and dismiss by swipe (HEL-565), and pull-to-refresh on dashboards.

The interactive "Motion study" and "Motion II" boards on the epic's canvas set the feel (`.concertino/design/HEL-1570/`, HANDOFF.md takes precedence; "motion with a little give", not decoration).

## Acceptance criteria

- [ ] Items 1–5 are implemented with the shared primitives and tokens only (no new literal durations, checked by the token guard)
- [ ] With the Motion setting "Off", or OS reduced motion, none of the above animate transform or position (real-browser e2e spot checks on grid, modal and palette)
- [ ] No layout shift or extra re-render regressions: dashboard load and panel drag keep current performance (React profiler/trace numbers in the PR)
- [ ] Items 6–8 are implemented or split into follow-ups with owner agreement

## Driver brief (claims, verified in premise-validation.md)

- Hard invariants: HEL-1575's dashboard-id key on the skeleton grid and PanelGrid stays; no render may change both layouts and breakpoint (react-grid-layout 2.2.4 loop). Any PanelGrid/DesktopPanelGrid logic change needs design-gate sign-off and before/after profiler numbers. The dashboard tab strip's indicator is HEL-1575's, not a motion consumer.
- Stay off the pipeline page (HEL-1579/1631; HEL-1628 running) and the phone nav / chips / mobile dashboard layout (HEL-1583 running).
- Item 6 (assistant on owner hold) and item 8 (overlaps HEL-1583) proposed for split, escalated to the owner.
