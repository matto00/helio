# HEL-1735: Gate hover effects behind (hover: hover) in feature stylesheets outside shared/ and the pipeline page

## Description

origin_kind: followup
origin_ticket: HEL-1675

HEL-1668 gated the pipeline page's own `:hover` rules behind `@media (hover: hover)`. HEL-1675 does the same for every
stylesheet under `frontend/src/shared/`, adds the DESIGN.md rule and a guard that walks `shared/**/*.css`.

Feature stylesheets elsewhere (app shell, panels, dashboards, sources, home, …) still have ungated `:hover` fills, so a
touch tap can leave them stuck.

## Acceptance Criteria

- Every `:hover` rule in feature stylesheets is gated or named as a reveal in a guard allowlist.
- The guard covers them.
- Desktop hover is unchanged.

## Driver context (claims to verify, not facts)

- Reuse HEL-1675's archived change (DESIGN.md rule, guard, reveal vs fill classification) and HEL-1668's pipeline-page
  gating; do not invent a new classification. Enumerate rules from the tree with a script and commit the inventory to
  evidence.
- Grep e2e/ for every selector whose hover is gated. Desktop-hover e2e specs (hel1675-shared-hover,
  `e2e/support/hel1790Rest.ts`, any other that reads hover paint) stay green and unchanged. Prove desktop hover
  unchanged with a computed-style comparison before and after under a hover-capable context.
- A reveal must stay reachable on touch; escalate if a reveal has no touch path today.
- Do not edit e2e specs HEL-1789 is splitting (hel1582-sweep-375, state-surface-contrast-guard, hel1582-mobile-pipeline,
  hel1684-draft-structural, hel1573-motion-primitives, hel1575-dashboard-tabs) without telling the driver first.
- Frontend CSS plus a guard test; no migration. No live model call (lane backend with ANTHROPIC_API_KEY empty).
