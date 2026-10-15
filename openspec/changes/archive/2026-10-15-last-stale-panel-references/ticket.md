# HEL-1614: After HEL-1598: last stale panel references (echarts spec typeId, usePanelPolling typeId param, write-path-audit rows, CLAUDE.md panels endpoint note, dead CollectionRenderer.metricOptions)

## Description

Origin: HEL-1598 (PR matto00/helio#1038, 67c434c6b), lane-reported. Deferred there; see its archive evidence.md section D (`openspec/changes/archive/2026-10-15-restate-remaining-stale-panel-specs/evidence.md`).

* `openspec/specs/echarts-chart-panel/spec.md:20` still mentions `typeId`. It was skipped because parked HEL-1572 has an open delta on that spec; its skeptic verified that delta touches a different requirement.
* `usePanelPolling.ts` still names its parameter and doc comment `typeId`. This is a code rename.
* `write-path-audit` spec: more stale rows (row 8 "panel type chart", Source Locations, call-volume, the "data binding updates" scenario).
* CLAUDE.md says `GET /api/dashboards/:id/panels` is public/shared-only, but `panelService.fetchPanels` calls it from the authenticated app. Verify which is true, and correct the doc or the code. If the code is wrong, file that separately; it would be an API-surface question.
* `CollectionRenderer.metricOptions` has no non-test caller, and `.panel-detail-modal__segmented*` CSS is referenced only by a CSS-lock test. If they're truly dead, remove them, and update the lock test honestly.

Spec changes go through OpenSpec deltas where possible, with a verification command per claim. Re-derive every item first. Coordinate with HEL-1572 before touching the echarts spec.

## Acceptance Criteria

1. The echarts-chart-panel spec no longer mentions `typeId` and its first requirement describes the current binding model (a chart Output rendered in an `output` panel), via an OpenSpec MODIFIED delta on "Chart panel renders a live ECharts instance" only. HEL-1572's delta (requirement "Hover emphasis is subtle and respects reduced motion") stays disjoint.
2. `usePanelPolling`'s third parameter and doc comment are renamed off `typeId` with identical behaviour (existing polling tests pass unchanged in assertions).
3. The write-path-audit spec's stale rows (payload detail 8, Source Locations PanelDetailModal row, call-volume "Panel data binding saves" row, the "data binding updates" scenario) match the current code, each with a verification command.
4. The CLAUDE.md `GET /api/dashboards/:id/panels` line is verified against the route tree AND a live probe of a running backend. If the doc is wrong, only that line is corrected. If the code is wrong, nothing is changed and the run escalates.
5. `CollectionRenderer.metricOptions` and the `.panel-detail-modal__segmented*` CSS are removed only if proven dead (grep plus a successful build), the CSS-lock test is updated honestly, and no rendered output changes.

## Run context (driver brief, 2026-10-15)

Overnight, non-UI, no visible change. Escalate and stop on budget exhaustion, a classifier denial, or a hard-to-reverse call. A driver-relayed decision is not an owner answer. Concurrent lanes HEL-1601 (CI workflow, jest reporter) and HEL-1613 (e2e); parked HEL-1610, 1575, 1576, 1578, 1579, 1572, 1583 — do not touch their files.
