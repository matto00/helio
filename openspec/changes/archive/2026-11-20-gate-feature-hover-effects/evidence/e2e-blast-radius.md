# e2e blast radius (D7), grep on main 894a72c56 plus red commits

Method: every class token of every gated selector in inventory-main.txt (181 tokens) grepped across e2e/**/*.ts: 80 files mention at least one. Of those, files that also read hover or computed paint (`.hover(`, `:hover`, `getComputedStyle`, `toHaveCSS`, `backgroundColor`): 39:

- e2e/focus-presence-guard.spec.ts
- e2e/hel1003-actions-menu-keyboard-reach.spec.ts
- e2e/hel1007-multi-root-reorder.spec.ts
- e2e/hel1311-heatmap-histogram-charts.spec.ts
- e2e/hel1398-chart-narrow-footnotes.spec.ts
- e2e/hel1444-footnoted-chart-canvas.spec.ts
- e2e/hel1510-output-editor-table-overflow.spec.ts
- e2e/hel1572-appearance-preferences.spec.ts
- e2e/hel1573-motion-grid-chart.spec.ts
- e2e/hel1573-motion-primitives.spec.ts
- e2e/hel1575-dashboard-tabs.spec.ts
- e2e/hel1582-mobile-pipeline.spec.ts
- e2e/hel1584-motion-perf.spec.ts
- e2e/hel1584-motion-surfaces.spec.ts
- e2e/hel1608-spine-count-overlap.spec.ts
- e2e/hel1668-phone-sheet.spec.ts
- e2e/hel1668-schema-panel-copy.spec.ts
- e2e/hel1675-shared-hover.spec.ts
- e2e/hel1681-refresh-control.spec.ts
- e2e/hel1735-feature-hover.spec.ts
- e2e/hel1744-insight-panel.spec.ts
- e2e/hel1746-ask-ui.spec.ts
- e2e/hel1750-actions-menu-viewport-fit.spec.ts
- e2e/hel1752-output-editor-footer-fit.spec.ts
- e2e/hel1762-popover-clears-bottom-nav.spec.ts
- e2e/hel1773-viewer-grantee-dashboard.spec.ts
- e2e/hel1782-viewer-shell.spec.ts
- e2e/hel1790-hover-probe.spec.ts
- e2e/hel510-keyboard-shortcuts.spec.ts
- e2e/hel520-focus-presence-guard.regression.spec.ts
- e2e/hel773-top-anchored-mobile-nav-sheet.spec.ts
- e2e/hel813-mobile-touch-target-floor.spec.ts
- e2e/state-surface-contrast-guard.spec.ts
- e2e/support/accentAudit.ts
- e2e/support/focusPresenceProbe.ts
- e2e/support/hel1583-glass-nav.ts
- e2e/support/modalScrollExtent.ts
- e2e/support/pipelineSpine.ts
- e2e/support/touchTargetProbe.ts

Run set (task 2.5): every file in that list with a hover read (hover-count > 0 in the per-file tally), plus hel1675-shared-hover and every hel1790Rest user (hel1675-shared-hover, hel1790-hover-probe, hel1735-feature-hover). HEL-1789's split specs (hel1582-mobile-pipeline, hel1573-motion-primitives, hel1575-dashboard-tabs, state-surface-contrast-guard) are RUN, never edited. Files that only read computed paint with no hover/tap of a gated control are listed but not re-run: gating changes no paint on a (hover: hover) desktop, and D5(a)/D5(b) prove that.
