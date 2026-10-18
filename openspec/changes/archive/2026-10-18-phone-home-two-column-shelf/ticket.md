# HEL-1642: Home on phones: one-column shelf pushes the run timeline ~1.3–1.5 viewports down

## Description

origin_kind: followup
origin_ticket: HEL-1583 (risk handed over from HEL-1578). Parent epic: HEL-1570.

Measured by HEL-1583's lane on main (after HEL-1578's Home merged, d777803c1). At 375px, Home's four dashboard-shelf cards stack in one column, so "Pipeline runs" starts at about 1071px and the 24h timeline at about 1153px. That's about **1.34 viewports** down, and about **1.46 viewports** at 430px. Home's gutters already meet the 12px phone rule, so the cause is the one-column shelf, not spacing.

This is a redesign gap: HANDOFF.md says Home's purpose is "see what ran and when, next to the dashboards it feeds", and on a phone the timeline is effectively off-screen.

**Options for design (owner call if it's not obvious):** a 2-column compact shelf on phones, or a horizontally scrolling shelf row (mirroring the dashboard chips HEL-1583 added), or reordering so the timeline comes first on phones.

## Acceptance Criteria

- At 375 and 430 the timeline's top is within the first viewport (or a measured, owner-agreed bound).
- Both themes.
- No horizontal page scroll.
- e2e pins the position.

## Evidence

Screenshots `home-375-*` and `home-430-*` and measurements `home-375-light.json` etc. under `.concertino/runs/HEL-1583/evidence/` (main checkout).
