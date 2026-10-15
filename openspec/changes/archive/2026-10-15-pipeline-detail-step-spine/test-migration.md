# Test migration ledger (HEL-1579, constraint C1, design D10)

Nothing was deleted without a named replacement. Every legacy page-level unit test keeps all of its assertions
(before == after in the table below); the desktop layout gets its own tests; the e2e specs that drove the old
river, tabs and footer were re-pointed.

## 1. Recorded commands

```
$ grep -rl "/pipelines/\|pipeline-detail-page" e2e/ | sort            # task 5.2, 51 files
e2e/auth-cookie-migration.spec.ts
e2e/focus-presence-guard.spec.ts
e2e/hel1007-multi-root-reorder.spec.ts
e2e/hel1023-breakpoint-layout-derivation.spec.ts
e2e/hel1065-pin-toggle-css-fixes.spec.ts
e2e/hel1094-sse-fan-out-panel-refresh.spec.ts
e2e/hel1096-run-to-update-affordance.spec.ts
e2e/hel1189-output-panel-controls-live.spec.ts
e2e/hel1230-drag-then-create-persists.spec.ts
e2e/hel1275-metric-delta-sparkline.spec.ts
e2e/hel1277-output-history-scrubber.spec.ts
e2e/hel1304-output-charttype-render.spec.ts
e2e/hel1305-chart-time-axis.spec.ts
e2e/hel1306-chart-reference-lines.spec.ts
e2e/hel1307-conditional-formatting.spec.ts
e2e/hel1311-heatmap-histogram-charts.spec.ts
e2e/hel1331-history-payloads-toggle.spec.ts
e2e/hel1345-rootid-step-placement.spec.ts
e2e/hel1350-chart-compare-picker.spec.ts
e2e/hel1351-aggregated-chart-overlay.spec.ts
e2e/hel1390-chart-tail-aggregate-live.spec.ts
e2e/hel1392-remount-request-burst.spec.ts
e2e/hel1392-remount-staleness.spec.ts
e2e/hel1398-chart-narrow-footnotes.spec.ts
e2e/hel1444-footnoted-chart-canvas.spec.ts
e2e/hel1508-chart-time-axis-followups.spec.ts
e2e/hel1510-output-editor-table-overflow.spec.ts
e2e/hel1512-category-axis-labels.spec.ts
e2e/hel1521-lane-picker-dependents.spec.ts
e2e/hel1562-landing-page.spec.ts
e2e/hel1579-pipeline-spine-layout.spec.ts
e2e/hel503-palette-global-resource-search.spec.ts
e2e/hel516-palette-quick-create.spec.ts
e2e/hel519-recent-navigation.spec.ts
e2e/hel520-focus-presence-guard.regression.spec.ts
e2e/hel572-chart-click-drilldown.spec.ts
e2e/hel588-cross-filter-panels.spec.ts
e2e/hel666-single-assistant-entry.spec.ts
e2e/hel908-full-flow.spec.ts
e2e/hel908-step-card-split.spec.ts
e2e/hel908-tail-attach.spec.ts
e2e/hel908-trunk-reorder-drag.spec.ts
e2e/hel908-trunk-reorder-order.spec.ts
e2e/hel909-output-picker-panel-sheet.spec.ts
e2e/hel910-pipeline-to-dashboard-flow.spec.ts
e2e/hel912-lanes-rejoin.spec.ts
e2e/hel958-join-step-editor.spec.ts
e2e/hel968-multi-root-editor-flow.spec.ts
e2e/state-surface-contrast-guard.spec.ts
e2e/support/accentAudit.ts
e2e/support/remountBurstSeed.ts
```

Unit before/after counts: `git show cd64409ad:<file>` (the review base) against the working tree, counting
`it(`/`test(` (an `it.each` counts once) and `expect(` per file; the script is the one in this change's
history (`ledger_counts.py`, regexes `^\s*(?:it|test)(?:\.each\(...\))?\s*\(` and `\bexpect(?:\.soft)?\s*\(`).

## 2. Unit tests (it/test count / expect( count)

| File | before | after |
|---|---|---|
| `backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala` | 100 / 342 | 101 / 347 |
| `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAclSpec.scala` | 23 / 48 | 25 / 55 |
| `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunRoutesSpec.scala` | 52 / 179 | 54 / 190 |
| `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunStepRowCountsRlsSpec.scala` | new | 6 / 22 |
| `backend/src/test/scala/com/helio/services/pipelines/FireTimeRunConfigGateSpec.scala` | 10 / 46 | 10 / 46 |
| `frontend/src/app/App.test.tsx` | 35 / 75 | 35 / 76 |
| `frontend/src/app/CommandBar.test.tsx` | 7 / 13 | 8 / 15 |
| `frontend/src/app/hidesBreadcrumbItemName.test.ts` | new | 3 / 7 |
| `frontend/src/features/pipelines/hooks/useStepSelection.test.tsx` | new | 9 / 15 |
| `frontend/src/features/pipelines/state/inFlightDedupe.test.ts` | new | 6 / 12 |
| `frontend/src/features/pipelines/state/summarizeStepConfig.test.ts` | new | 14 / 28 |
| `frontend/src/features/pipelines/ui/PipelineDetailPage.createPlacement.test.tsx` | 9 / 41 | 9 / 41 |
| `frontend/src/features/pipelines/ui/PipelineDetailPage.creatingStep.test.tsx` | 4 / 15 | 4 / 15 |
| `frontend/src/features/pipelines/ui/PipelineDetailPage.draftCreate.test.tsx` | 12 / 41 | 12 / 41 |
| `frontend/src/features/pipelines/ui/PipelineDetailPage.reorderGuard.test.tsx` | 1 / 7 | 1 / 7 |
| `frontend/src/features/pipelines/ui/PipelineDetailPage.shapeReparent.test.tsx` | 3 / 14 | 3 / 14 |
| `frontend/src/features/pipelines/ui/PipelineDetailPage.spine.test.tsx` | new | 40 / 116 |
| `frontend/src/features/pipelines/ui/PipelineDetailPage.spineEditing.test.tsx` | new | 36 / 89 |
| `frontend/src/features/pipelines/ui/PipelineDetailPage.stepsError.test.tsx` | 7 / 27 | 7 / 27 |
| `frontend/src/features/pipelines/ui/PipelineDetailPage.switch.test.tsx` | 16 / 70 | 16 / 70 |
| `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` | 132 / 310 | 132 / 310 |
| `frontend/src/shared/chrome/ActionsMenu.test.tsx` | 11 / 18 | 12 / 19 |
| `frontend/src/shared/ui/DataGrid.test.tsx` | 118 / 234 | 119 / 237 |
| `frontend/src/theme/elevationTokenGuard.css.test.ts` | 5 / 7 | 5 / 7 |
| `frontend/src/theme/motionTokenGuard.css.test.ts` | 5 / 8 | 5 / 8 |
| `frontend/src/features/pipelines/ui/spine/SpineStatusStrip.test.tsx` | new | 6 / 13 |

Reading the table:

- **Unchanged files** (`PipelineDetailPage.test.tsx`, `.draftCreate`, `.creatingStep`, `.createPlacement`, `.shapeReparent`,
  `.stepsError`, `.switch`, `.reorderGuard`): the only edit is a `beforeEach`/`afterEach` that stubs `window.matchMedia` so the
  page renders its PHONE layout (`installPhoneShell` in `pipelineDetailPageTestUtils.ts`). jsdom has no `matchMedia`, so before
  this change they rendered the only layout; now that desktop is the spine they keep asserting the phone river view, cards, tabs
  and footer (which the phone still renders, C4) and the layout-independent page logic they reach through the card DOM.
  Counts are identical, so no assertion was removed or weakened.
- **Phone-path coverage** (D10): `PipelineDetailPage.spine.test.tsx` "still renders the river view with its tabs and footer at the
  phone breakpoint, not the spine"; the legacy page tests above all run on the phone path.
- **`App.test.tsx`** (+1 expect): the one assertion changed on purpose. "the command-bar breadcrumb shows the pipeline name after
  navigating" is the behaviour the owner ruling `header-owns-name` removes on the rail shell. It is replaced by the sr-only `<h1>`
  reading "Data Pipelines: Revenue ETL" (route change proven) plus an assertion that the breadcrumb does NOT repeat the name
  (`App.test.tsx`, "phone section sheet on /pipelines navigates ...") and `CommandBar.test.tsx` "HEL-1579 pipeline detail breadcrumb".
- **Token guards** (`elevationTokenGuard`, `motionTokenGuard`): the pinned CSS-file count 135 -> 141 (six new tokens-only
  stylesheets); a merge-conflict hotspot with the sibling lanes, noted in the PR.

### Desktop replacements for assertions that used to target the footer, tabs, river or cards

Each row names where the same behaviour is now asserted on the desktop spine (file:test).

| Legacy assertion (file: test) | Desktop replacement |
|---|---|
| `PipelineDetailPage.test.tsx`: "Steps/Outputs tabs wire a complete ARIA tabs pattern (CR6)" | `PipelineDetailPage.spine.test.tsx`: "has no tabs, no footer and no river on desktop"; the OUTPUTS region tests (`outputs section`) |
| "meta bar shows row count / does not crash when lastRunRowCount is undefined" | `spine.test`: "shows rows written and the relative last-run time ...", "does not crash and omits rows written when the persisted row count is missing" (this one found a real defect: a missing wire field read as `undefined`) |
| "StatusBadge running and queued states (HEL-199)" | `spine.test`: "shows the in-session run status queued / running as a status chip and disables Run and Dry run", "shows a dry run's preview row count ..." |
| "schedule bar (HEL-416): No schedule set / toggling enabled sends PUT unchanged" | `spine.test` (`schedule chip and menu`): "offers 'Add schedule' ...", "shows the expression and a Paused marker ... Resume", "Pause sends the unchanged kind/expression/timezone" |
| "source chip shows the bound source name / renders the root's own name when unresolved" | `spine.test` (`lanes and sources`): source cards, "renders a source that is not resolvable ... by name only" |
| "header actions menu (Edit source / Set schedule / Run history / Share)" | `spine.test`: "keeps every former header action reachable ...", "omits Share for a non-owner and the singular Edit source ..." |
| "adding / removing a step", "failed step delete restores ... one toast" | `spineEditing.test.tsx`: `:151`, `:365`, `:383` |
| "insert-at-position (HEL-410)": before first / between / append / failure keeps temp | `PipelineDetailPage.spineEditing.test.tsx`: before first `:193`, middle `:223`, last trunk row appends (D5 routing to `handleAddStep`, no position, new step selected and last) `:252`, append via "+ Add transformation step" `:151`; Insert items only on root 0 trunk rows `:277` |
| "reorder (HEL-407)": optimistic + persisted ids only, failed reorder reverts | `spineEditing.test.tsx`: `:321` (optimistic, persisted ids), `:352` (revert + toast), disabled Move at the ends |
| "disable/enable + duplicate (HEL-412)": toggle, failed toggle, duplicate resync, rejected duplicate | `spineEditing.test.tsx`: `:397`, `:418`, `:431`, `:457` |
| "step preview": Preview data button, loading, error, hide | `spineEditing` (`preview freshness and ordering`): preview table fetch, loading skeleton, "shows the preview error in place and the named reason", "'No rows to preview.'", "column data types in the header"; the per-card Preview button no longer exists on desktop |
| "re-enabling a step with its preview open debounces the refetch" | `useStepPreviewFetch` is the same code for the phone tray (the legacy test still runs) and the table; desktop: "Disable ... the table says the rows pass through unchanged" |
| "rename / select step config round trip" | `spineEditing` (`step config editors through the focused editor`): hydrate, PATCH after debounce, clearing removes the key, restores a select step's fields |
| "a reorder / toggle / insert changes stepsFingerprint and re-dispatches analyze" | `spineEditing`: "a reorder, an enable toggle and an insert each change the steps fingerprint and re-dispatch analyze" |
| "step card is not expandable while its create is in flight (HEL-1294)" | `spineEditing`: "shows a step still being created as a draft row with a disabled editor and no preview request" |
| "root removal (HEL-968): named refusal / removed counts" | page logic in `usePipelineRootAndToggleActions` is layout-independent and still asserted by the legacy test; desktop: `spine.test` "lists every source with its own menu ... Remove from pipeline" (item present, enabled/disabled) |
| "steps fetch failure (HEL-1501): error + Retry, not the empty editor" | `spineEditing`: "shows the steps error with Retry (not the empty editor) ... then recovers" |
| `PipelineDetailFooter.denial.test.tsx` / `.stepConfigInvalid.test.tsx` (footer component) | `spine/SpineStatusStrip.test.tsx` (same cases and the same committed backend fixture) |
| Gallery tab assertions (`OutputsGalleryTab.test.tsx`) | the component stays for the phone tab; desktop: `spine.test` (`outputs section`) |

New desktop-only assertions with no legacy counterpart: selection and `?step=` (`spine.test` "structure"), lane labels and
selection, per-step row counts (persisted vs in-session vs "—", "off", Partial), the no-Delete ruling, the live-output slot,
the single `<main>`, one step-preview GET on open (also StrictMode), no per-Output placements GET, flush-on-selection-change
(4 tests incl. re-select-shows-saved-value, `spineEditing.test.tsx:508`, each shown red by mutation or against the old code), the preview waiting for the pending save, temp-id-swap selection continuity.

## 3. e2e triage (task 5.2): every hit of the recorded command

"migrated" = selectors re-pointed, assertions unchanged (a counted assertion was never removed: see section 4);
"verified unchanged" = ran green without edits against this worktree's servers (ports 7011/9918).

| Spec | Outcome | What / why |
|---|---|---|
| `e2e/auth-cookie-migration.spec.ts` | unaffected | grep hit is an `/api/pipelines` URL; the spec never opens the pipeline page |
| `e2e/focus-presence-guard.spec.ts` | verified, one CSS fix | its `pipeline-detail` cell measures every focusable element on the new page; it caught the header crumb/name focus ring being clipped by `overflow: hidden` (fixed in `PipelineSpineHeader.css`), then passed in both themes |
| `e2e/hel1007-multi-root-reorder.spec.ts` | migrated | root lanes are `.spine-root` blocks; Move items are row-menu items (`Move step up in <source>`), keyboard path = Enter on the row-menu trigger then Enter on the focused item; focus follows the moved row |
| `e2e/hel1023-breakpoint-layout-derivation.spec.ts` | unaffected | dashboard layout spec; `/api/pipelines` seeding URLs only |
| `e2e/hel1065-pin-toggle-css-fixes.spec.ts` | unaffected | dashboard table pin CSS; API seeding only |
| `e2e/hel1094-sse-fan-out-panel-refresh.spec.ts` | unaffected | drives `/home`; pipelines are seeded and run over the API |
| `e2e/hel1096-run-to-update-affordance.spec.ts` | unaffected | drives `/home` (the dashboard panel's Run to update); the pipeline page is not opened. Its page-level counterpart is `SpineStatusStrip.test.tsx` |
| `e2e/hel1189-output-panel-controls-live.spec.ts` | unaffected | dashboard panel controls; API seeding only |
| `e2e/hel1230-drag-then-create-persists.spec.ts` | unaffected | dashboard layout drag; API seeding only |
| `e2e/hel1275-metric-delta-sparkline.spec.ts` | migrated | Outputs tab click -> `showOutputs(page)` (a tab on the phone, the spine's OUTPUTS section on desktop) |
| `e2e/hel1277-output-history-scrubber.spec.ts` | migrated | `showOutputs` + `openOutputHistory` (direct button on the phone, the OUTPUTS card menu on desktop). It also resizes to 375px mid-test, which found that dialogs inside a layout are unmounted when the breakpoint is crossed: the dialogs are now siblings of the layout (`PipelineDetailDialogs`) |
| `e2e/hel1304-output-charttype-render.spec.ts` | unaffected | grep hit is `/api/pipelines` seeding URLs; no pipeline page UI |
| `e2e/hel1305-chart-time-axis.spec.ts` | verified unchanged | passes without edits (`goto` on the pipeline page only reads the Output sheet by deep link) |
| `e2e/hel1306-chart-reference-lines.spec.ts` | migrated | Outputs tab click -> `showOutputs` |
| `e2e/hel1307-conditional-formatting.spec.ts` | unaffected | dashboard panel rendering; API seeding only |
| `e2e/hel1311-heatmap-histogram-charts.spec.ts` | migrated | Outputs tab click -> `showOutputs` |
| `e2e/hel1331-history-payloads-toggle.spec.ts` | migrated | Outputs tab click -> `showOutputs` |
| `e2e/hel1345-rootid-step-placement.spec.ts` | migrated | titles read from `.spine-row__title`; the bottom append is unchanged (`+ Add transformation step`); the gap insert is the first row's `Insert step after` menu item; the in-flight toggle wait is the focused editor's fieldset becoming enabled |
| `e2e/hel1350-chart-compare-picker.spec.ts` | migrated | Outputs tab click -> `showOutputs` |
| `e2e/hel1351-aggregated-chart-overlay.spec.ts` | unaffected | grep hit is `/api/pipelines` seeding URLs; no pipeline page UI |
| `e2e/hel1390-chart-tail-aggregate-live.spec.ts` | migrated | the rail's `Add output` button is the step row menu's `Add output` item; the Output name is read from the OUTPUTS card (`.spine-output-card .spine-card__name`) |
| `e2e/hel1392-remount-request-burst.spec.ts` | unaffected | dashboard remount request counting; the pipeline is seeded over the API (`remountBurstSeed.ts`) |
| `e2e/hel1392-remount-staleness.spec.ts` | migrated | Outputs tab click -> `showOutputs` (it runs at phone and desktop widths, so the helper branches) |
| `e2e/hel1398-chart-narrow-footnotes.spec.ts` | verified unchanged | passes without edits |
| `e2e/hel1444-footnoted-chart-canvas.spec.ts` | verified unchanged | passes without edits |
| `e2e/hel1508-chart-time-axis-followups.spec.ts` | verified unchanged | passes without edits |
| `e2e/hel1510-output-editor-table-overflow.spec.ts` | migrated | Outputs tab click -> `showOutputs` |
| `e2e/hel1512-category-axis-labels.spec.ts` | unaffected | grep hit is `/api/pipelines` seeding URLs; no pipeline page UI |
| `e2e/hel1521-lane-picker-dependents.spec.ts` | migrated | the union step is opened by selecting its spine row (`Step <n>: Union / append rows`) instead of expanding a card |
| `e2e/hel1562-landing-page.spec.ts` | unaffected | landing page; the hit is a link target string |
| `e2e/hel1579-pipeline-spine-layout.spec.ts` | new | this change's spec (task 5.4) |
| `e2e/hel503-palette-global-resource-search.spec.ts` | unaffected | command palette; the hit is a navigation target URL |
| `e2e/hel516-palette-quick-create.spec.ts` | verified unchanged | passes without edits |
| `e2e/hel519-recent-navigation.spec.ts` | verified unchanged | passes without edits |
| `e2e/hel520-focus-presence-guard.regression.spec.ts` | not run by design | `*.regression.spec.ts` is excluded by `playwright.config.ts` (mutation harness, HEL-813 design D1); no selector of the old page in it |
| `e2e/hel572-chart-click-drilldown.spec.ts` | unaffected | dashboard chart drilldown; API seeding only |
| `e2e/hel588-cross-filter-panels.spec.ts` | unaffected | dashboard cross filter; API seeding only |
| `e2e/hel666-single-assistant-entry.spec.ts` | not run (quarantined) | `testIgnore` quarantine HEL-960 (`/chat`); no pipeline page UI |
| `e2e/hel908-full-flow.spec.ts` | not run (quarantined) | `testIgnore` quarantine HEL-964 (flaky); drives the old river/tabs/footer. Selectors it would need on the spine: `+ Add transformation step`, row menu, `showOutputs`, header Run. Left unedited: it cannot be verified while quarantined, and un-quarantining is HEL-964's |
| `e2e/hel908-step-card-split.spec.ts` | migrated | Duplicate/Disable act on the selected step in the focused editor; Move up is the row-menu item |
| `e2e/hel908-tail-attach.spec.ts` | not run (quarantined) | `testIgnore` quarantine HEL-962; already stale before this change (it looks for an `Add tail step` button the river no longer has) |
| `e2e/hel908-trunk-reorder-drag.spec.ts` | migrated | trunk rows are the top-level lane's rows, the tail is a nested `.spine-lane--sub`; the drag still dispatches the real `dragstart`/`dragover`/`drop` sequence, on the row grip and row |
| `e2e/hel908-trunk-reorder-order.spec.ts` | migrated | titles from `.spine-row__title`; Move up through the row menu |
| `e2e/hel909-output-picker-panel-sheet.spec.ts` | not run (quarantined) | `testIgnore` quarantine HEL-963; drives `/home` |
| `e2e/hel910-pipeline-to-dashboard-flow.spec.ts` | migrated | Outputs tab click -> `showOutputs`; Output cards are `.output-gallery-card, .spine-output-card` |
| `e2e/hel912-lanes-rejoin.spec.ts` | not run (quarantined) | `testIgnore` quarantine HEL-992; drives the old river's lanes. On the spine: `Branch from here`, `.spine-lane--sub` |
| `e2e/hel958-join-step-editor.spec.ts` | migrated | a created step is selected, so its editor is already open: the card expand click became waiting for the focused editor to be enabled |
| `e2e/hel968-multi-root-editor-flow.spec.ts` | not run (quarantined) | `testIgnore` quarantine HEL-991; already stale before this change (it looks for `+ Add root`, renamed `Add source` by HEL-1022). On the spine: `Add source`, `showOutputs`, `.spine-output-card` |
| `e2e/state-surface-contrast-guard.spec.ts` | migrated + CSS fixes | the card-expand step became asserting the selected row and focused editor; the guard then caught real hover-rung defects on the new page (header controls and menu triggers on the canvas, card controls, preview rows, selected-row controls), fixed in CSS; both themes pass |
| `e2e/support/accentAudit.ts` | new | this change's accent audit helper |
| `e2e/support/remountBurstSeed.ts` | unaffected | API-only seeding helper for hel1392-remount-request-burst |

Final recorded e2e run (workers 2): section 6.

## 4. e2e assertion counts (it/test count / expect( count; `expect.soft` counted)

| File | before | after |
|---|---|---|
| `e2e/hel1579-pipeline-spine-layout.spec.ts` | new | 8 / 34 |
| `e2e/hel1007-multi-root-reorder.spec.ts` | 1 / 21 | 1 / 22 |
| `e2e/hel1275-metric-delta-sparkline.spec.ts` | 1 / 33 | 1 / 33 |
| `e2e/hel1277-output-history-scrubber.spec.ts` | 2 / 30 | 2 / 30 |
| `e2e/hel1306-chart-reference-lines.spec.ts` | 2 / 33 | 2 / 33 |
| `e2e/hel1311-heatmap-histogram-charts.spec.ts` | 2 / 27 | 2 / 27 |
| `e2e/hel1331-history-payloads-toggle.spec.ts` | 2 / 24 | 2 / 24 |
| `e2e/hel1345-rootid-step-placement.spec.ts` | 1 / 18 | 1 / 18 |
| `e2e/hel1350-chart-compare-picker.spec.ts` | 1 / 17 | 1 / 17 |
| `e2e/hel1392-remount-staleness.spec.ts` | 1 / 17 | 1 / 17 |
| `e2e/hel1510-output-editor-table-overflow.spec.ts` | 1 / 9 | 1 / 9 |
| `e2e/hel1521-lane-picker-dependents.spec.ts` | 1 / 7 | 1 / 7 |
| `e2e/hel908-step-card-split.spec.ts` | 1 / 13 | 1 / 13 |
| `e2e/hel908-trunk-reorder-drag.spec.ts` | 1 / 23 | 1 / 23 |
| `e2e/hel908-trunk-reorder-order.spec.ts` | 1 / 16 | 1 / 16 |
| `e2e/hel910-pipeline-to-dashboard-flow.spec.ts` | 2 / 19 | 2 / 19 |
| `e2e/hel958-join-step-editor.spec.ts` | 1 / 11 | 1 / 13 |

The counts only grew: `hel1007` (+1, the new soft assertion that the row menu names its lane) and `hel958` (+2, the explicit wait
for the focused editor). No assertion was removed.

## 5. Spec reconciliation (task 1.1)

`openspec/changes/pipeline-detail-step-spine/specs/*/spec.md` holds a MODIFIED delta (phone behaviour kept verbatim, desktop
behaviour added with a scenario) for 19 capabilities: `pipeline-editor-page` (9 requirements), `pipeline-lane-editor-ui` (4),
`pipeline-outputs-gallery` (3), `pipeline-tails-ui` (2), `pipeline-root-editor-ui` (2), `pipeline-schedule-config-ui` (2),
`pipeline-step-preview` (2), `pipeline-dry-run-ui`, `pipeline-step-reorder`, `pipeline-outputs-rail` (4),
`pipeline-run-truncation-reporting`, `pipeline-lane-run-reporting`, `pipeline-step-schema-diff`, `pipeline-step-lifecycle`,
`pipeline-edit-flow` (2), `pipeline-shape-instantiation-ui`, `pipeline-step-validation-display` (2),
`pipeline-step-warning-display`, `output-history-scrubber`.

Recorded grep of every `openspec/specs/*/spec.md`:

```
$ grep -il "footer\|tabpanel\|step card\|StepCard\|OutputsRail\|Outputs tab\|gallery\|river" openspec/specs/*/spec.md   # 69 files
```

The 69 hits were triaged. Reconciled with a delta above: the 19 capabilities listed. Remaining hits, with reasons:

- Unrelated uses of the words (modal footers, the connector/egress/fetch/redaction specs, panel and dashboard specs, `data-grid`,
  `loading-state-pattern`, `raw-element-guard`, `frontend-ui-directory-structure`, `backend-ci-test-execution`): not about the
  pipeline detail page.
- The per-op editor specs (`pipeline-*-op`, `pipeline-*-editor`, `pipeline-ai-step-authoring`, `pipeline-upsertsource-editor`,
  `pipeline-convertformat-editor`, `pipeline-generatetext-editor`): they describe a step kind's editor "in the step card". The
  desktop focused editor hosts the same `StepOpEditor` ladder, which the new `pipeline-detail-spine-layout` requirement "Every step
  kind is editable in the focused editor" now states explicitly ("requirements ... that describe a step kind's editor inside the
  step card apply unchanged to the focused editor"), so no per-spec delta is needed.
- `pipeline-lane-layout`: a purely computational layout (lane slots for the river); the spine does not use it and nothing there
  is contradicted.
- `outputs-model`: the word "gallery" appears in a data-model note only.

## 6. Recorded e2e runs (this worktree's servers: frontend 7011, backend 9918, DB `helio_hel1579`; Playwright workers 2)

```
$ DEV_PORT=7011 nice -n 19 npx playwright test \
    e2e/hel908-step-card-split.spec.ts e2e/hel908-trunk-reorder-drag.spec.ts e2e/hel908-trunk-reorder-order.spec.ts \
    e2e/hel1007-multi-root-reorder.spec.ts e2e/hel1345-rootid-step-placement.spec.ts e2e/hel1521-lane-picker-dependents.spec.ts \
    e2e/hel958-join-step-editor.spec.ts e2e/hel1277-output-history-scrubber.spec.ts e2e/hel1390-chart-tail-aggregate-live.spec.ts \
    e2e/hel910-pipeline-to-dashboard-flow.spec.ts e2e/hel1331-history-payloads-toggle.spec.ts e2e/hel1510-output-editor-table-overflow.spec.ts \
    e2e/hel1275-metric-delta-sparkline.spec.ts e2e/hel1306-chart-reference-lines.spec.ts e2e/hel1311-heatmap-histogram-charts.spec.ts \
    e2e/hel1350-chart-compare-picker.spec.ts e2e/hel1392-remount-staleness.spec.ts e2e/hel1579-pipeline-spine-layout.spec.ts \
    e2e/focus-presence-guard.spec.ts e2e/state-surface-contrast-guard.spec.ts --workers=2 --reporter=list
  78 passed (5.1m)
```

Earlier recorded runs of the broader UI-navigating set (27 spec files, 145 tests): 139 passed / 6 failed / 1 skipped; the six
failures were the specs migrated afterwards (hel1277 x2, hel1390, hel910, state-surface-contrast-guard pipeline-detail x2), each
then passing in the final run above. The first runs of the new accent audit were red by design (it printed 70+ accent leaks:
the combinator, the add-condition/add-sort buttons, the diff chips and native checkboxes) before `PipelineSpineAccent.css`.
