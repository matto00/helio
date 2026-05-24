## Context

`appearance.ts` contains all blend and alpha constants for dashboard and panel backgrounds.
Three constants are in scope: dashboard tint strength (0.22), panel tint strength (0.24), and
grid background alpha (0.94 dark / 0.97 light). The dot-grid overlay in `App.css` uses
`--app-bg-accent` (accent color at 6% opacity) which may be invisible when the dashboard
background override is a dark opaque color that absorbs the low-contrast dots.

## Goals / Non-Goals

**Goals:**

- Tune `resolveDashboardGridBackground` alpha values to ensure the grid surface is subtly
  distinguishable from the full-bleed background in both themes.
- Tune dot-grid CSS so it remains visible even when `--dashboard-background-override` is set
  to a dark solid color.
- Add locked unit test assertions for the tuned output values.

**Non-Goals:**

- Exposing tint strength as a runtime user control.
- Changing the transparency slider's 0–100 range mapping (range is intentional).

## Decisions

**Dot-grid visibility via opacity bump (not color change):** The dot uses `--app-bg-accent`
(accent color at 6% opacity). Under a dark background override the contrast is too low.
Increasing the dot opacity via a CSS override on `.app-shell` (e.g. bump `background-size`
or add an explicit opacity to the `::before` pseudo-element) is the minimal change. Adding a
dedicated `--dot-grid-opacity` CSS custom property set per-theme makes the behavior explicit
without coupling it to the accent token system.

**Alpha tuning stays in `appearance.ts` constants (not CSS):** The `resolveDashboardGridBackground`
alpha parameters are TypeScript constants tested by Jest. Keeping them in TS keeps the test
coverage chain intact. The final values are chosen by comparing rendered luminance across the
four combinations (dark theme + dark bg, dark theme + light bg, light theme + dark bg,
light theme + light bg).

**Test assertions lock in concrete outputs:** The existing appearance test suite verifies
relative behavior (dark ≠ light). Adding concrete `toContain("rgba(...)` assertions for a known
background hex locks down the tuned constants so future refactors don't silently drift them.

## Risks / Trade-offs

- Tuning constants changes visual output for all users with saved background colors — the
  delta is intentionally small (±2–3 alpha points) so existing dashboards should not look broken.
  → Risk is low; constants remain within the "glass" aesthetic range.

## Planner Notes

- No API, schema, or backend changes required. Pure frontend CSS and TS constants.
- No new npm dependencies.
- Self-approved; no escalation needed.
