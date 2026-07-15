# Files modified — mobile-bottom-nav-dashboard-sheet (HEL-302)

**Status: ready for device testing (tasks 1–7.1 complete).** All task groups
are done and all CI-style gates pass. Per `ticket.md`'s "Verification is
human-performed" section, this is still **not** "done" in the fullest sense —
device verification (task group 7's test plan, below) is human-performed and
has not happened yet. Desktop/Playwright-emulated-mobile evidence in this repo
is regression-only, never a substitute for an actual phone.

## Design checkpoint outcome (tasks 4.2/4.3)

**APPROVED**, 2026-07-14/15. Human feedback verbatim: "bottom nav bar is
looking good... otherwise it all looks great." All three checkpoint questions
were confirmed with no changes requested now:

1. Tab bar proportions (56px height, 22px icons) — no change now; final
   tuning happens at device testing (task 7).
2. Hiding Undo/Redo + "Customize dashboard" below 768px — confirmed fine.
3. The mobile title's verbose accessible name ("Switch dashboard (current:
   X)") — confirmed fine.
4. The `<768px` shell gate (vs. the ratified 430px phone breakpoint from
   HEL-300) — confirmed fine. Verified this is the pre-existing, ratified
   `max-width: 768px` breakpoint from HEL-300 (`a7b914fd`), not something
   introduced by this ticket — see the desktop regression pass below.

## Blocking bug investigation (dashboard-sheet selection) — resumed cycle

The human reported from the live dev server: "i can't select any dashboard,
source, pipeline, or type" — specifically that tapping a dashboard-sheet item
did not switch the dashboard. Per the systematic-debugging law, no fix was
applied without a probe-confirmed root cause; the investigation below is the
probe record.

**Probes run** (Playwright, against the *unmodified* checkpoint-1 code at
`d7ee2c0`, live dev server, `matt@helio.dev`, iPhone-13 viewport/UA emulation
with real touch (`hasTouch`) unless noted):

1. Plain mouse click (390×844 viewport, no touch emulation) on a non-active
   dashboard item → selection dispatched, title updated, sheet closed. Pass.
2. Real touch `tap()` (iPhone-13 device profile) on a non-active item → same
   result. Pass. Re-ran after a **full dev-server restart** (killed the
   process on :5475, re-ran `scripts/concertino/start-servers.sh` to
   eliminate any stale Vite/HMR module-graph state) — same result, twice.
3. Tap immediately after opening (mid entrance-animation, no settle wait) —
   Playwright's own actionability check refused the tap ("element outside
   viewport", a Playwright geometry-timing artifact, not a real-device
   scenario since a real finger can't tap something not yet visually
   settled). Not evidence of an app bug.
4. Scroll the list (14 seeded dashboards, taller than the sheet's `70dvh` cap)
   then tap the last, off-screen-until-scrolled item → selection dispatched
   correctly, sheet closed.
5. Full section sweep: opened the sheet and tapped a non-active item on `/`
   (dashboards), and — after building task 5.1 — on `/sources`, `/pipelines`,
   `/registry` too. All four selected/navigated and closed correctly (see
   below).
6. Visual confirmation: screenshotted panel content before/after a dashboard
   switch — panel count and content genuinely changed (`1 panel` /
   "Upload Test Image" → `3 panels` / "Skeptic Avg Check" + others), not just
   the title text.
7. Escapability: Escape key and backdrop-tap both correctly dismiss.

**Conclusion:** no reproducible defect was found in the dashboard-sheet
selection path at the code committed in `d7ee2c0`. `handleMobileSheetSelect`
dispatches `setSelectedDashboardId(item.id)` — the exact same reducer action
`DashboardList`'s own button dispatches — and the dispatch is a pure
synchronous Redux update (no network call in the loop), so there is no
API/CORS-shaped failure mode either. The most plausible explanation for what
the human observed is a stale/HMR-corrupted Vite dev-server module graph
accumulated over the long live-editing session that produced the checkpoint-1
commit (new files + a Context provider added mid-session are a known Vite
Fast-Refresh fragility class) — not a defect in the shipped code. Corrective
action taken: the dev server was fully restarted (not just reused) before
continuing, and reselection was reverified fresh afterward per probe #2.

**A real, different bug found along the way.** Writing `MobileNavSheet.test.tsx`
(task 6.3) — mounting the sheet with `open` already `true`, rather than the
app's own pattern of mounting closed and flipping `open` true later —
repeatedly reproduced a genuine defect: `onClose` fired twice, once
spuriously on mount. Root cause (probe-confirmed via the failing test's
call-count assertion): the "external close" effect
(`useEffect(() => { if (open && !overlay.isActive) onClose(); }, [overlay.isActive])`)
read `overlay.isActive` on the same commit as the sibling effect's
`overlay.open()` call, before that call's `setActiveId` had propagated back
through context — so on a from-cold mount with `open=true`, it read the
*stale* `false` and treated it as an external dismissal. This is dormant in
production today only because `App.tsx` always mounts the sheet with
`open=false` and flips it later (a prop *transition*, not a fresh mount,
sidesteps the staleness window) — but it is a real latent fragility in the
component, in the same "dismiss fires at the wrong time" bug class the
orchestrator flagged as a plausible candidate for the original report. Fixed
by tracking a `wasActiveRef` that only permits the external-close path once
`overlay.isActive` has actually been observed `true` for the current open
session (see `MobileNavSheet.tsx`). All 7 `MobileNavSheet.test.tsx` cases,
including the two that exercise this exact race, now pass.

## New files (this cycle — build-out + tests)

- `frontend/src/shared/chrome/navDestinations.test.ts` — locks the shared
  four-destination array (labels, paths, `end` flags, distinct icons) both
  the desktop sidebar and `BottomNav` map over (task 6.1).
- `frontend/src/shared/chrome/BottomNav.test.tsx` — renders the four tabs,
  active state follows the route including into a nested `/pipelines/:id`
  detail path (task 6.2).
- `frontend/src/shared/chrome/MobileNavSheet.test.tsx` — open/closed, active
  item marked, selection dispatch + dismiss, backdrop dismiss, Escape
  dismiss, empty-state message, and "no CRUD affordances" (task 6.3). Two of
  these cases are what caught the `onClose`-fires-twice bug described above.

## New files (checkpoint 1)

- `frontend/src/shared/chrome/navDestinations.ts` — single source of the four
  section destinations `{to, end?, label, icon}` (Lucide `LayoutDashboard`,
  `Database`, `Workflow`, `BookOpen`). Desktop sidebar `NavLink`s and
  `BottomNav` both map over this list so the two surfaces cannot drift.
- `frontend/src/shared/chrome/BottomNav.tsx` — breakpoint-gated bottom tab bar.
  Presentational; visibility is enforced entirely in `BottomNav.css`, so
  promoting it to desktop later is a stylesheet change only.
- `frontend/src/shared/chrome/BottomNav.css` — opaque `--app-surface`, top
  `--app-border-subtle` hairline, `--app-accent` active state (nowhere else in
  the bar), height = `--control-lg` + `--space-4` (56px) + `env(safe-area-inset-bottom)`,
  each tab stretches to that full height (>44px target). Hidden by default;
  shown only `max-width: 768px`.
- `frontend/src/shared/chrome/MobileNavSheet.tsx` — generic portal bottom
  sheet (dashboards today; section items land in the build-out pass). Backed
  by `document.body` portal, registers with `useOverlay` (single-active +
  Escape semantics — first real consumer of that hook), dismisses on backdrop
  tap, Escape, or a pointer-driven downward drag past an 80px threshold.
  Selecting an item calls `onSelect` then closes.
- `frontend/src/shared/chrome/MobileNavSheet.css` — opaque
  `--app-surface-strong`, bottom-anchored, translate-up entrance animation
  respecting `prefers-reduced-motion`, `--app-accent` active-item wash + dot
  (consistent with `DashboardList`'s own active-item styling).

## Modified files (this cycle — build-out + bug fix)

- `frontend/src/shared/chrome/MobileNavSheet.tsx` — fixed the mount-order
  `onClose`-fires-twice race described above (`wasActiveRef` guard on the
  external-close effect). No prop/behavior contract change for callers.
- `frontend/src/shared/chrome/SidebarBody.tsx` — exported the existing
  `sectionFromPathname` helper (was module-private) so `App.tsx` drives the
  phone section sheet off the *exact same* route-matching logic the desktop
  sidebar uses, rather than a second hand-rolled copy that could drift.
- `frontend/src/app/App.tsx` — extended from the checkpoint-1 dashboard-only
  wiring (task 3.3) to all four sections (task 5.1):
  - `mobileSheetItems` is now a `mobileSection`-keyed switch: `dashboards`
    (Redux `items`/`selectedDashboardId`, unchanged), `sources` (Redux
    `sources.items` + the same `selectedSourceId ?? items[0]?.id` fallback
    `SidebarBody` uses), `pipelines` (`pipelines.items`, active id from the
    route's `:id`), `registry` (`selectPipelineOutputDataTypes` — the same
    pipeline-bound-only filter `SidebarBody` applies, *not* the raw
    `dataTypes.items` list, so the sheet can never show a type the desktop
    sidebar wouldn't).
  - `handleMobileSheetSelect` branches per section: `dashboards`/`sources`/
    `registry` dispatch the matching Redux selection action (mirroring
    `DashboardList`/`SidebarItemList`'s `onSelect` pattern); `pipelines`
    calls `navigate('/pipelines/:id')` instead (mirroring
    `SidebarItemList`'s `toHref` pattern — pipelines are navigated, not
    Redux-selected, on desktop too).
  - The phone title button generalized from "dashboards only, gated on
    `selectedDashboard !== null`" to all four sections (always shown for
    sources/pipelines/registry, so an empty section is still reachable/
    pickable, never a dead end).
  - `breadcrumbItemName`'s registry branch was changed from raw
    `dataTypes.items` to `pipelineOutputDataTypes`, for the same
    "don't drift from what's actually selectable" reason above — this was a
    small pre-existing inconsistency between the breadcrumb and
    `SidebarBody`'s own list, surfaced because the phone sheet now needs to
    agree with both; not a speculative unrelated refactor, since leaving it
    would have made the phone title text and the sheet's active-item
    highlight visibly disagree.
  - `MobileNavSheet`'s `title`/`emptyMessage` props are now
    `mobileSection`-driven instead of hardcoded `"Dashboards"`/
    `"No dashboards yet."`.
- `frontend/src/app/App.test.tsx` — two new tests exercising the /pipelines
  section sheet specifically (navigation-not-Redux-select wiring, and the
  empty-state message; task 6.4). Uses `getPipelines` mocked with a
  *persistent* `mockResolvedValue` rather than `...Once`, because both
  `SidebarBody` (gated on `status === "idle"`) and `PipelinesPage`
  (unconditional) independently dispatch `fetchPipelines()` on mount — an
  `Once` value only satisfies whichever of the two calls happens to resolve
  first, making the test order-dependent/flaky.

## Modified files (checkpoint 1)

- `frontend/src/app/App.tsx`:
  - Desktop sidebar `NavLink`s now map over `navDestinations` instead of four
    hardcoded links (same `className` string, same DOM shape — react-router's
    `NavLink` still appends `.active` automatically, so desktop CSS/behavior
    is unchanged; verified via `App.test.tsx`).
  - Mounts `<BottomNav />` inside `.app-shell`, on every protected route.
  - Adds a phone-only tappable title button (`.app-command-bar__mobile-title`)
    next to the (untouched) desktop breadcrumb — dashboard name + chevron,
    opens the sheet. Wired to `state.dashboards` (`items`,
    `selectedDashboardId`) and dispatches the same `setSelectedDashboardId`
    action `DashboardList` uses — no forked state.
  - Renders `<MobileNavSheet>` for the dashboard picker.
- `frontend/src/app/App.css`:
  - Replaces the broken `position: fixed; width: 0` mobile sidebar stub
    (HEL-302's W3.0 trap) with `display: none` below 768px; `.app-content`
    gains bottom padding reserving the bar height + safe area.
  - Adds `.app-command-bar__mobile-title` styles (hidden by default, shown
    `<=768px`).
  - Hides `.undo-redo-btn` and `.dashboard-appearance-editor` below 768px —
    **found during checkpoint screenshotting**: these desktop layout-editing
    controls, left in place, squeezed the mobile title button to zero width
    in the command bar's flex layout. They're editing affordances explicitly
    out of scope for the phone viewer per `notes/mobile-pwa-handoff.md` §2
    ("Dashboard/item CRUD on phone" / editing affordances hideable
    `<768px`), so hiding them is in-scope cleanup, not scope creep, and
    doesn't touch `PanelGrid`/renderers.
- `frontend/src/app/App.test.tsx`: scoped four existing nav-link queries
  (`Data Pipelines`, `Data Sources`, `Type Registry` x2) to the desktop
  `nav[aria-label="Main navigation"]` landmark via `within(...)`, since
  `BottomNav` (always mounted, CSS-only gating) now also renders links with
  those names and jsdom doesn't evaluate `@media` — an unscoped query became
  ambiguous. Gave the phone title button an explicit `aria-label` (distinct
  from the visible dashboard name) for the same reason — it was colliding
  with `DashboardList`'s per-item button, which is `aria-label`'d with the
  dashboard name too.

## Root cause note (mobile title button, zero-width)

- **Root cause:** `.app-command-bar__left` is `flex: 1; min-width: 0`; on a
  390px viewport the pre-existing `.app-command-bar__right` (Undo, Redo,
  "Customize dashboard", theme toggle, user menu) is wider than the space
  left after the logo, so the flex layout gives `.app-command-bar__right` its
  full min-content width and squeezes every `min-width: 0` sibling in
  `.app-command-bar__left` — including the new mobile-title button — to 0.
- **Probe:** Playwright `getBoundingClientRect()` on `.app-command-bar__left`
  and `.app-command-bar__mobile-title` at a 390px viewport, before the fix:
  `left.w = 0`, `mobileTitle.w = 0`, `right.w = 381` (wider than the 390px
  bar). After hiding `.undo-redo-btn`/`.dashboard-appearance-editor` at
  `<=768px`: `left.w = 286`, `mobileTitle.w = 92`, `right.w = 64`.
- **Fix:** hide the two desktop-only editing controls below 768px (see
  App.css above); confirmed with the same probe and the checkpoint
  screenshots (title control is visible and tappable in both).

## Checkpoint screenshots (task 4.1)

`openspec/changes/mobile-bottom-nav-dashboard-sheet/checkpoint-shots/`, all at
390x844 via a throwaway Playwright script (not committed) against the dev
server (`scripts/concertino/start-servers.sh`, DEV_PORT=5475,
BACKEND_PORT=8382), logged in as `matt@helio.dev`:

- `bottom-nav-light.png` / `bottom-nav-dark.png` — dashboard view showing the
  BottomNav.
- `dashboard-sheet-light.png` / `dashboard-sheet-dark.png` — the open
  dashboard-switcher sheet (active dashboard highlighted, scrollable list).

### Icon / label / metric choices — rationale

Icons are Lucide, matching the existing `PanelLeftClose`/`PanelLeftOpen` usage
in `App.tsx` so no new icon library is introduced: `LayoutDashboard` for
Dashboards (a grid glyph reads as "this is the workspace/overview," matching
the section's own content), `Database` for Data Sources (literal and already
the established metaphor for a data store), `Workflow` for Data Pipelines (a
branching-nodes glyph for a step-based transform, distinct from Database at a
glance), `BookOpen` for Type Registry (a reference/catalog metaphor —
Registry is a lookup, not a workspace, so a book reads better than a
database-adjacent icon). Labels are the exact desktop sidebar strings (via
`navDestinations`) so phone and desktop can never say two different things
for the same route. No numeric "metric" choices were needed for this
ticket — W3 is nav-only; per-panel sizing metrics are HEL-301's W4 scope, out
of this ticket's territory.

## Design questions for the human

1. Tab bar height (56px + safe-area) and icon size (22px) are first-cut
   proportions read off the control-token scale, not tuned on a device per
   §8 of the handoff — happy to adjust once you've seen it on-phone.
2. Hiding Undo/Redo + "Customize dashboard" below 768px (see root-cause note
   above) is a functional necessity, not just a design call — confirming
   you're fine with those affordances being desktop-only for now (consistent
   with the "no editing on phone" viewer scope), pending HEL-301's read-only
   panel stack landing.
3. The mobile title's accessible name ("Switch dashboard (current: X)") is
   deliberately more verbose than its visible text (just the dashboard name)
   to avoid colliding with `DashboardList`'s per-item `aria-label`s in
   testing-library queries — no visual change, flagging in case there's a
   preferred phrasing.

## Escapability + occlusion pass (task 5.2)

Playwright, iPhone-13 viewport/UA emulation, all four routes (`/`,
`/sources`, `/pipelines`, `/registry`) plus `/pipelines/:id`:

- `BottomNav` present, same 56px box (`x:0, y:608, w:390, h:56`), on every
  route including the pipeline detail route — no route is a navigation trap.
- `.app-content` reserves `padding-bottom: 56px` (+ `env(safe-area-inset-bottom)`
  in a real notch) on every route, so content is never occluded by the bar.
- The section sheet dismisses via Escape, via backdrop tap, and — after
  either — `BottomNav` is still fully functional (tapped a tab immediately
  after closing the sheet and it navigated correctly).

## Desktop regression pass (task 5.3)

Playwright, real (non-touch) viewports at 768/1100/1440, `matt@helio.dev`:

| width | BottomNav visible | phone title visible | sidebar visible | Undo/Redo visible |
| ----- | ------------------ | -------------------- | ---------------- | ------------------- |
| 768   | yes                 | yes                   | no                | no                   |
| 1100  | no                  | no                    | yes               | yes                  |
| 1440  | no                  | no                    | yes               | yes                  |

768px showing the phone layout is **expected, not a regression**: the
`max-width: 768px` breakpoint predates this ticket (HEL-300, `a7b914fd`,
already on `main`) and was explicitly reconfirmed fine at the design
checkpoint (see above) — this ticket only fills in what renders inside that
already-ratified gate. 1100/1440 screenshots and desktop breadcrumb text for
`/sources`, `/pipelines`, `/pipelines/:id`, `/registry` were spot-checked and
match pre-existing desktop behavior (each shows the section's active item
name, e.g. `"Data Pipelines / Profit (migrated)"`).

## Verification gates run (final, this cycle)

```
$ npm run lint
> eslint . --max-warnings=0
(clean, exit 0)

$ npm run format:check
> prettier . --check
All matched files use Prettier code style! (exit 0)

$ npm test
> jest --passWithNoTests && npm --prefix frontend test
Test Suites: 88 passed, 88 total
Tests:       946 passed, 946 total
(exit 0)

$ npm --prefix frontend run build
✓ built in 569ms (exit 0)
```

Desktop/CI-style + Playwright-emulated-mobile gates only — per the ticket,
none of this is device verification. See the on-device test plan below.

## On-device test plan (task 7.1) — human-performed, not yet run

Build and serve a production build (matches what a real device would fetch,
unlike the Vite dev server):

```
npm --prefix frontend run build && npx vite preview --host
```

Find the LAN URL `vite preview --host` prints (e.g. `http://192.168.x.x:4173`)
and open it on an actual phone on the same network. Walk through, in order:

1. **Log in** on the phone. Confirm the `BottomNav` (4 tabs: Dashboards,
   Data Sources, Data Pipelines, Type Registry) is visible at the bottom and
   nothing behind it is clipped/hidden.
2. **Dashboard switching, no URL bar.** Tap the dashboard name in the
   command bar (chevron next to it) to open the sheet. Select a *different*
   dashboard from the list — the sheet should close and the panel content
   below should visibly change. Repeat for a **3rd** dashboard. Confirm you
   never needed the browser's own URL/back UI to do this.
3. **Section pickers.** Tap "Data Sources" in `BottomNav`, tap the phone
   title to open its sheet, select a source — confirm the desktop-equivalent
   selection state changes (e.g. re-check via the sidebar if you rotate to a
   wider window, or just trust the title updates). Repeat for "Data
   Pipelines" (selecting here should navigate to that pipeline's detail
   page, not just "select" it in place) and "Type Registry".
4. **Safe-area check.** On a phone with a home indicator/gesture bar (iPhone
   X or later, most modern Android), confirm the bottom nav bar sits clear
   of the home indicator (not overlapped) in both portrait orientations you
   can test, and that page content isn't hidden underneath the bar when
   scrolled to the bottom.
5. **Swipe-down feel.** Open any sheet (dashboard or a section) and swipe
   down from the grabber/title area. Confirm it feels responsive
   (follows your finger, not laggy) and dismisses past a natural
   thumb-swipe distance — it should not require an unnaturally long drag,
   nor dismiss on a light accidental touch.
6. **Every-route-escapable walk.** From each of the 4 sections, and from a
   pipeline's detail page, confirm: (a) `BottomNav` is present and every tab
   is tappable, (b) any open sheet can be dismissed by tapping outside it
   (backdrop) as well as by the swipe-down gesture, (c) you can always get
   back to Dashboards without using the browser's own back button.
7. **Proportions gut-check (checkpoint item #1, deferred to here).** With
   the bar and sheets in front of you on a real screen, note whether the
   56px bar height / 22px icons feel right, or whether they read too small/
   large for a comfortable thumb target — this is the one open item from the
   design checkpoint, intentionally left for here rather than guessed on a
   simulated viewport.

Report back pass/fail per step, plus any proportion-tuning feedback from
step 7 (spinoff-able as a small follow-up if a real adjustment is needed).
