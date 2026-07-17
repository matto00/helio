# HEL-305 — Creation-modal chart-type selector is a no-op — every chart starts as line

**Type:** bug | **Priority:** Medium | **Project:** Helio v1.5 — Panel System v2

## Context

Found during HEL-248 review (pre-existing, not introduced by HEL-248). The chart-type
selector in the panel-creation modal has no effect: `buildCreatePanelBody` in
`frontend/src/features/panels/utils/panelPayloads.ts` never reads `typeConfig.chartType`,
so every new chart panel is created as `line` regardless of what the user picks. The type
can only be changed afterward in the edit pane.

Also fix in the same change: stale helper copy in `TypeSelectStep.tsx` still says charts
support "line, bar, or pie" (scatter shipped in HEL-248).

## Repro-widening note

Check the other `typeConfig` fields flowing through `buildCreatePanelBody` for the same
dropped-field pattern — if the chart type is ignored, sibling creation-time options may be
too.

## Acceptance criteria

- [ ] Selecting bar/pie/scatter in the creation modal produces a panel of that chart type on first render
- [ ] Test asserting `buildCreatePanelBody` carries `chartType` (and any other audited `typeConfig` fields) into the create payload
- [ ] `TypeSelectStep.tsx` copy lists all four chart types

## Session notes (from user briefing — verify, don't trust)

- main includes all of v1.5 (PRs #230–235). Chart panels now persist per-type
  `chartOptions` (migration V56) — check whether creation-time chartType interacts with
  that config shape.
- Iron Laws apply: probe-confirm the root cause before fixing.
- Mobile-verification standard applies where UI is touched (390×844, ≥44px for any new
  controls), though this ticket is primarily a payload fix.
- Operational hygiene: Playwright screenshots to session scratchpad or gitignored tmp —
  never the repo root. Never bulk-delete by glob.
