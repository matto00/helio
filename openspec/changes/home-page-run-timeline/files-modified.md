# Files modified — HEL-1578 (Home page: run timeline; Phase A + Phase B)

Every file changed against the merge-base (outside this change dir), one bullet each. Phase B (changed dot from HEL-1575's change signal, `dashboardIds` on home-summary) is included.

- `DESIGN.md` — design standard: Rail Home bullet and Home tab
- `backend/src/main/resources/db/migration/V136__pipeline_runs_pipeline_started_idx.sql` — new — V136 index on pipeline_runs (pipeline_id, started_at DESC)
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — mount the home-summary routes
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — mix in the home-summary protocol
- `backend/src/main/scala/com/helio/api/protocols/home/HomeSummaryProtocol.scala` — new — home-summary backend slice (model, builder, service, repository, protocol, routes)
- `backend/src/main/scala/com/helio/api/protocols/home/README.md` — new — module README for the home summary slice
- `backend/src/main/scala/com/helio/api/routes/home/HomeSummaryRoutes.scala` — new — home-summary backend slice (model, builder, service, repository, protocol, routes)
- `backend/src/main/scala/com/helio/api/routes/home/README.md` — new — module README for the home summary slice
- `backend/src/main/scala/com/helio/infrastructure/persistence/home/HomeSummaryRepository.scala` — new — home-summary backend slice (model, builder, service, repository, protocol, routes)
- `backend/src/main/scala/com/helio/infrastructure/persistence/home/README.md` — new — module README for the home summary slice
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepository.scala` — keep-24h retention in deleteOldRunsInternal (D4)
- `backend/src/main/scala/com/helio/services/home/HomeSummaryBuilder.scala` — new — home-summary backend slice (model, builder, service, repository, protocol, routes)
- `backend/src/main/scala/com/helio/services/home/HomeSummaryModel.scala` — new — home-summary backend slice (model, builder, service, repository, protocol, routes)
- `backend/src/main/scala/com/helio/services/home/HomeSummaryService.scala` — new — home-summary backend slice (model, builder, service, repository, protocol, routes)
- `backend/src/main/scala/com/helio/services/home/README.md` — new — module README for the home summary slice
- `backend/src/test/scala/com/helio/api/routes/home/HomeSummaryRoutesSpec.scala` — new — backend test (home summary, retention, or seed support)
- `backend/src/test/scala/com/helio/infrastructure/persistence/home/HomeSummaryScopingSpec.scala` — new — backend test (home summary, retention, or seed support)
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepositorySpec.scala` — backend test (home summary, retention, or seed support)
- `backend/src/test/scala/com/helio/services/home/HomeSummaryBuilderSpec.scala` — new — backend test (home summary, retention, or seed support)
- `backend/src/test/scala/com/helio/services/pipelines/FireTimeRunConfigGateSpec.scala` — backend test (home summary, retention, or seed support)
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunEditorPersistenceSpec.scala` — backend test (home summary, retention, or seed support)
- `backend/src/test/scala/com/helio/testsupport/HomeSummarySeeding.scala` — new — backend test (home summary, retention, or seed support)
- `e2e/README.md` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/focus-presence-guard.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel1065-pin-toggle-css-fixes.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel1085-form-field-renderers-keyboard.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel1087-form-submit-path.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel1088-compact-counter-chrome.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel1090-form-panel-assembled-a11y.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel1094-sse-fan-out-panel-refresh.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel1095-optimistic-pending-writing-panel-a11y.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel1096-run-to-update-affordance.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel1169-network-vs-rejection-reconcile-a11y.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel1189-output-panel-controls-live.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel1304-output-charttype-render.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel1305-chart-time-axis.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel1306-chart-reference-lines.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel1311-heatmap-histogram-charts.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel1351-aggregated-chart-overlay.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel1508-chart-time-axis-followups.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel1512-category-axis-labels.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel1562-landing-page.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel1572-appearance-preferences.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel1574-shell-rail.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel1575-dashboard-tabs.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel1578-home-changed-dot.spec.ts` — new — new Home e2e spec / seed support
- `e2e/hel1578-home-page.spec.ts` — new — new Home e2e spec / seed support
- `e2e/hel503-palette-global-resource-search.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel516-palette-quick-create.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel519-recent-navigation.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel572-chart-click-drilldown.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel588-cross-filter-panels.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel666-single-assistant-entry.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel716-panel-detail-tall-viewport-footer.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel773-top-anchored-mobile-nav-sheet.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel813-mobile-touch-target-floor.regression.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel813-mobile-touch-target-floor.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel909-output-picker-panel-sheet.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel910-pipeline-to-dashboard-flow.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/hel968-multi-root-editor-flow.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/state-surface-contrast-guard.spec.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/support/auth.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `e2e/support/homeSeed.ts` — new — new Home e2e spec / seed support
- `e2e/support/isolateLivePage.ts` — e2e retarget of dashboard-grid /home to /dashboards, or merged-head fix
- `frontend/src/app/App.test.tsx` — updated or new frontend test for the Home/route retarget
- `frontend/src/app/AppRoutes.tsx` — Home routing, shell, stamp or change-signal wiring
- `frontend/src/app/AppShell.dashboardMetaRow.test.tsx` — updated or new frontend test for the Home/route retarget
- `frontend/src/app/AppShell.rail.test.tsx` — updated or new frontend test for the Home/route retarget
- `frontend/src/app/CommandBar.test.tsx` — updated or new frontend test for the Home/route retarget
- `frontend/src/app/ShareDialogFocusRestore.test.tsx` — updated or new frontend test for the Home/route retarget
- `frontend/src/app/dashboardChrome.test.ts` — updated or new frontend test for the Home/route retarget
- `frontend/src/app/dashboardMeta/DashboardMetaRow.test.tsx` — updated or new frontend test for the Home/route retarget
- `frontend/src/app/hidesBreadcrumbItemName.test.ts` — updated or new frontend test for the Home/route retarget
- `frontend/src/app/shell/AppRail.test.tsx` — updated or new frontend test for the Home/route retarget
- `frontend/src/app/shell/AppRail.tsx` — Home routing, shell, stamp or change-signal wiring
- `frontend/src/features/README.md` — Home routing, shell, stamp or change-signal wiring
- `frontend/src/features/auth/ui/UserMenu.tsx` — Home routing, shell, stamp or change-signal wiring
- `frontend/src/features/commandPalette/model/builtInActions.test.tsx` — updated or new frontend test for the Home/route retarget
- `frontend/src/features/commandPalette/model/dashboardSeenStore.test.ts` — new — updated or new frontend test for the Home/route retarget
- `frontend/src/features/commandPalette/model/dashboardSeenStore.ts` — new — Home routing, shell, stamp or change-signal wiring
- `frontend/src/features/commandPalette/state/recentVisitsListeners.ts` — Home routing, shell, stamp or change-signal wiring
- `frontend/src/features/dashboards/hooks/useDashboardViewStamp.test.tsx` — new — updated or new frontend test for the Home/route retarget
- `frontend/src/features/dashboards/hooks/useDashboardViewStamp.ts` — new — Home routing, shell, stamp or change-signal wiring
- `frontend/src/features/dashboards/tabs/changeRule.test.ts` — new — updated or new frontend test for the Home/route retarget
- `frontend/src/features/dashboards/tabs/changeRule.ts` — new — Home routing, shell, stamp or change-signal wiring
- `frontend/src/features/dashboards/tabs/dashboardTabsSelectors.ts` — Home routing, shell, stamp or change-signal wiring
- `frontend/src/features/dashboards/tabs/tabsBrowserTriggers.test.ts` — updated or new frontend test for the Home/route retarget
- `frontend/src/features/dashboards/tabs/tabsPersistence.test.ts` — updated or new frontend test for the Home/route retarget
- `frontend/src/features/dashboards/tabs/warm/warmCache.homeStamp.test.ts` — new — updated or new frontend test for the Home/route retarget
- `frontend/src/features/dashboards/tabs/warm/warmCache.ts` — Home routing, shell, stamp or change-signal wiring
- `frontend/src/features/dashboards/ui/DashboardRoute.tsx` — Home routing, shell, stamp or change-signal wiring
- `frontend/src/features/dashboards/ui/ProposalReviewPage.test.tsx` — updated or new frontend test for the Home/route retarget
- `frontend/src/features/dashboards/ui/ProposalReviewPage.tsx` — Home routing, shell, stamp or change-signal wiring
- `frontend/src/features/home/README.md` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/hooks/useChangedDashboardIds.test.tsx` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/hooks/useChangedDashboardIds.ts` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/hooks/useCoarsePointer.ts` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/services/homeService.ts` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/state/homeSummarySlice.test.ts` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/state/homeSummarySlice.ts` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/test/homeFixtures.ts` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/test/renderHome.tsx` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/types/homeSummary.ts` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/ui/DashboardShelf.test.tsx` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/ui/DashboardShelf.tsx` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/ui/HomeOpeningLine.tsx` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/ui/HomePage.css` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/ui/HomePage.test.tsx` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/ui/HomePage.tsx` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/ui/LayoutThumbnail.tsx` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/ui/NeedsAttention.test.tsx` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/ui/NeedsAttention.tsx` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/ui/PipelineRunsCard.tsx` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/ui/RunDisclosureList.test.tsx` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/ui/RunDisclosureList.tsx` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/ui/RunTimeline.test.tsx` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/ui/RunTimeline.tsx` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/ui/TimelineMark.tsx` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/ui/UpNext.test.tsx` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/ui/UpNext.tsx` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/ui/summaryLoadState.ts` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/utils/buildSummarySentence.test.ts` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/utils/buildSummarySentence.ts` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/utils/relativeShelfTime.test.ts` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/utils/relativeShelfTime.ts` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/utils/shelfOrder.test.ts` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/utils/shelfOrder.ts` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/utils/timelineMarks.test.ts` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/utils/timelineMarks.ts` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/utils/timelineScale.test.ts` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/home/utils/timelineScale.ts` — new — Home page feature (service, slice, hooks, UI, utils, tests)
- `frontend/src/features/onboarding/ui/OnboardingChecklist.tsx` — Home routing, shell, stamp or change-signal wiring
- `frontend/src/features/panels/ui/PanelList.tsx` — Home routing, shell, stamp or change-signal wiring
- `frontend/src/features/patchSets/ui/PatchSetReviewPage.test.tsx` — updated or new frontend test for the Home/route retarget
- `frontend/src/features/patchSets/ui/PatchSetReviewPage.tsx` — Home routing, shell, stamp or change-signal wiring
- `frontend/src/features/pipelines/services/runToUpdate.test.ts` — new — updated or new frontend test for the Home/route retarget
- `frontend/src/features/pipelines/services/runToUpdate.ts` — Home routing, shell, stamp or change-signal wiring
- `frontend/src/features/pipelines/ui/proposalReview/PipelineProposalReviewPage.test.tsx` — updated or new frontend test for the Home/route retarget
- `frontend/src/features/pipelines/ui/proposalReview/PipelineProposalReviewPage.tsx` — Home routing, shell, stamp or change-signal wiring
- `frontend/src/features/proposals/ui/CombinedProposalReviewPage.test.tsx` — updated or new frontend test for the Home/route retarget
- `frontend/src/features/proposals/ui/CombinedProposalReviewPage.tsx` — Home routing, shell, stamp or change-signal wiring
- `frontend/src/shared/chrome/BottomNav.test.tsx` — updated or new frontend test for the Home/route retarget
- `frontend/src/shared/chrome/BottomNav.tsx` — Home routing, shell, stamp or change-signal wiring
- `frontend/src/shared/chrome/navDestinations.test.ts` — updated or new frontend test for the Home/route retarget
- `frontend/src/shared/chrome/navDestinations.ts` — Home routing, shell, stamp or change-signal wiring
- `frontend/src/shared/chrome/resourceNavigation.test.tsx` — updated or new frontend test for the Home/route retarget
- `frontend/src/shared/chrome/resourceNavigation.ts` — Home routing, shell, stamp or change-signal wiring
- `frontend/src/shared/chrome/sections.test.ts` — updated or new frontend test for the Home/route retarget
- `frontend/src/shared/chrome/sections.ts` — Home routing, shell, stamp or change-signal wiring
- `frontend/src/store/store.ts` — Home routing, shell, stamp or change-signal wiring
- `frontend/src/theme/elevationTokenGuard.css.test.ts` — updated or new frontend test for the Home/route retarget
- `frontend/src/theme/motionTokenGuard.css.test.ts` — updated or new frontend test for the Home/route retarget
- `schemas/README.md` — home-summary response schema / index
- `schemas/home/home-summary-response.schema.json` — new — home-summary response schema / index

## 1.8 `"/home"` call sites in `frontend/src` (non-test), D1 rule

| Site | Purpose | Target |
| --- | --- | --- |
| `app/AppRoutes.tsx` `/` redirect | `/` means app home | `/home` (kept) |
| `app/AppRoutes.tsx` NotFoundPage "Back to dashboards" | dashboard grid | `/dashboards` |
| `app/AppRoutes.tsx` `/home` route | the Home page | `HomePage` (new); `/dashboards` route renders `PanelList` |
| `app/CommandBar.tsx` wordmark link "Helio home" | app home | `/home` (kept) |
| `features/auth/ui/LoginPage.tsx`, `MfaVerifyPage.tsx`, `OAuthCallbackPage.tsx`, `RegisterPage.tsx`, `PublicOnlyRoute.tsx` | sign-in landing, already-signed-in redirect | `/home` (kept) |
| `features/auth/utils/postLoginReturnTo.ts` | skips storing the default landing | `/home` (kept) |
| `features/auth/state/signedInHint.ts`, `frontend/index.html` | returning users sent to app home | `/home` (kept, comments/script) |
| `pwaConfig.ts` `start_url` | PWA start | `/home` (kept) |
| `features/auth/ui/UserMenu.tsx` "Getting started" | reopens the checklist rendered by `PanelList` | `/dashboards` |
| `features/dashboards/ui/DashboardRoute.tsx` not-found CTA | dashboard grid | `/dashboards` |
| `features/dashboards/ui/ProposalReviewPage.tsx` (5 sites: accept, reject, 3 CTAs) | after applying / back to dashboards | `/dashboards` |
| `features/patchSets/ui/PatchSetReviewPage.tsx` (7 sites) | after apply / back to dashboards | `/dashboards` |
| `features/pipelines/ui/proposalReview/PipelineProposalReviewPage.tsx` (reject + CTA) | back to dashboards | `/dashboards` |
| `features/proposals/ui/CombinedProposalReviewPage.tsx` (3 sites) | after apply / back to dashboards | `/dashboards` |
| `features/onboarding/ui/OnboardingChecklist.tsx` `navGlyph` | placement glyph = dashboards section | `/dashboards` |
| `shared/chrome/resourceNavigation.ts` (dashboard ref) | select dashboard, show the grid | `/dashboards` |
| `shared/chrome/sections.ts`, `navDestinations.ts` | registry / Home alias | Home entry `/home` (`showInNav: false`), Dashboards `/dashboards` |

Verified with `git grep -n '"/home"\|/home' -- frontend/src ':!*.test.*'`: the remaining hits are the "kept" rows above plus comments.

## 1.8a e2e retarget (dashboard-grid uses of `/home` -> `/dashboards`)

Rule: `page.goto("/home")` meant the dashboard grid in every spec below, so it became `page.goto("/dashboards")`. `waitForURL("/home")` after a UI login is kept (it asserts the new landing). `e2e/hel1562-landing-page.spec.ts` keeps its `/home` assertions (app home) but its "Add dashboard" check became the Home landmark (the Home page has no such button).

| File | Change |
| --- | --- |
| `support/auth.ts` | `waitForShell` now opens `/dashboards` before waiting for "Add dashboard" (sign-in lands on Home, which has no dashboards list) |
| `support/isolateLivePage.ts` | comment only (login still waits for `/home`) |
| `focus-presence-guard.spec.ts`, `state-surface-contrast-guard.spec.ts` | route keys/paths `"/home"` -> `"/dashboards"` |
| `hel1574-shell-rail.spec.ts` | asserts the Home landing (Home current, no list) then goes to `/dashboards` for the rail/list assertions; two `goto` retargets |
| `hel666-single-assistant-entry.spec.ts` | route list and post-apply `waitForURL` -> `/dashboards` |
| `goto("/home")` -> `goto("/dashboards")` only | hel1065, hel1085, hel1087, hel1088, hel1090, hel1094, hel1095, hel1096, hel1169, hel1189, hel1304, hel1305, hel1306, hel1311, hel1351, hel1508, hel1512, hel503, hel516, hel519, hel572, hel588, hel716, hel773, hel813 (+ regression), hel909, hel910, hel968 |
| `README.md` | wording |
| new | `hel1578-home-page.spec.ts`, `support/homeSeed.ts` |

Verified by `git grep -n 'goto("/home")' e2e` (no hit remains).
