## 1. Frontend — foundations

- [x] 1.1 Read `DESIGN.md`, `CONTRIBUTING.md`, and `notes/mobile-pwa-handoff.md` §W3 in full
- [x] 1.2 Create `frontend/src/shared/chrome/navDestinations.ts` — shared `{to, end, label, icon}` list (Lucide)
- [x] 1.3 Refactor `App.tsx` desktop sidebar NavLinks to map over `navDestinations` (desktop DOM/CSS output unchanged)

## 2. Frontend — BottomNav (first cut, up to checkpoint)

- [x] 2.1 Create `shared/chrome/BottomNav.tsx` — `<nav>` of NavLinks over `navDestinations`, icon + UI-face label
- [x] 2.2 Create `shared/chrome/BottomNav.css` — opaque `--app-surface`, top hairline, accent active state, control-token height + `env(safe-area-inset-bottom)`, >=44px targets, hidden >=768px
- [x] 2.3 Mount `BottomNav` in `App.tsx` shell; replace App.css <=768px sidebar stub (`display:none` sidebar, content bottom padding for bar + safe area)

## 3. Frontend — dashboard sheet (first cut, up to checkpoint)

- [x] 3.1 Create sheet component (`shared/chrome/MobileNavSheet.tsx` + `.css`) — portal bottom sheet, opaque `--app-surface-strong`, `useOverlay` registration, backdrop + Escape + swipe-down dismiss, entrance animation with `prefers-reduced-motion`
- [x] 3.2 Add phone-only tappable title control in the command bar (name + chevron; hidden >=768px, desktop breadcrumb untouched)
- [x] 3.3 Wire dashboards: list from `state.dashboards` selectors, active indication, select via `DashboardList`'s selection action, dismiss on pick — no CRUD affordances

## 4. CHECKPOINT — human design review (mandatory, do not proceed past it)

- [x] 4.1 Start dev server (canonical script), screenshot BottomNav and open dashboard sheet at 390x844, light and dark, via Playwright/agent-eyes
- [x] 4.2 STOP and return screenshots to the orchestrator with a one-paragraph rationale of icon/label/metric choices; wait for human feedback and record the verdict in `files-modified.md`
- [x] 4.3 Apply any requested design revisions before continuing

## 5. Frontend — build-out (post-checkpoint)

- [x] 5.1 Extend the sheet to `/sources`, `/pipelines`, `/registry`: same title control + sheet fed by `SidebarItemList`'s data, navigate on tap, empty-state message, no editing affordances
- [x] 5.2 Escapability + occlusion pass: BottomNav on all protected routes <768px, z-order vs overlays, content never occluded, no route trapped
- [x] 5.3 Desktop regression pass: verify >=768px DOM/visuals unchanged (768/1100/1440 vs main)

## 6. Tests

- [x] 6.1 Jest: `navDestinations` shared-source test (desktop nav and BottomNav render identical destinations)
- [x] 6.2 Jest: `BottomNav` renders four tabs, active state follows route
- [x] 6.3 Jest: sheet — opens from title, lists dashboards from store, dispatches selection and dismisses on pick, backdrop/Escape dismiss, no CRUD affordances rendered
- [x] 6.4 Jest: section-item sheet on `/pipelines` (or similar) navigates and shows empty state
- [x] 6.5 `npm run lint && npm test` clean; `npm --prefix frontend run build` succeeds

## 7. Ready-for-device-testing handoff (terminal state — not "done")

- [x] 7.1 Write ordered on-device test plan into `files-modified.md` (install/build cmd `npm --prefix frontend run build && npx vite preview --host`; steps incl. switching between >=3 dashboards without the URL bar, safe-area check, swipe-down feel, every-route-escapable walk)
- [x] 7.2 Final commit; note explicitly that desktop 390px evidence is regression-only, device verification is human-performed
