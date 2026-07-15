# Helio Mobile — PWA Viewer Handoff

**Status:** ready to implement · **Author:** scoping session, 2026-07-14
**Audience:** the agent implementing this, in a fresh session.
**Linear:** project [Helio Mobile — PWA](https://linear.app/helioapp/project/helio-mobile-pwa-f1004292efc2)

## Ticket map

This document is the shared, binding brief. The work is split across three
tickets; each references back here.

| Ticket      | Scope                                                                                                     | Spec sections          |
| ----------- | --------------------------------------------------------------------------------------------------------- | ---------------------- |
| **HEL-300** | PWA shell — manifest, icons, service worker, fonts, OAuth answer, **`DESIGN.md` breakpoint ratification** | W1, W2, W6, §3.2, §4.2 |
| **HEL-301** | Viewer grid + panel sizing — **the heart of the project**                                                 | W4, W5, §4.1           |
| **HEL-302** | Native mobile navigation — tab bar + dashboard sheet                                                      | W3                     |

HEL-300 unblocks the other two (it ratifies the breakpoint they both need).
HEL-301 and HEL-302 are independent of each other but should be run
**sequentially** — device verification is human-performed and only one thing can
be felt out at a time.

**Every ticket's terminal state is "ready for device testing", not "done"** — see
§6. No agent can verify this work.

---

## 0. Read this first

You are **not** writing a new app. You are making the existing
`frontend/` usable on an iPhone and installable to the home screen. Every
line of React, CSS, Redux, and ECharts in this repo stays where it is.

Three documents are **binding** and you must read them before writing code:

- `CONTRIBUTING.md` — code-quality standard.
- `DESIGN.md` — the design language. Non-negotiable, including for mobile.
  Mobile is not a licence to invent new tokens or a second visual system.
- `CLAUDE.md` — commands, architecture, conventions.

**Do not reach for React Native, Expo, or Capacitor.** That was evaluated and
rejected with numbers (see §1). If you find yourself proposing a native
rewrite, you have misread the task.

---

## 1. The decision, and why (so you don't relitigate it)

Target: **a Progressive Web App**, installed via Safari → Share → _Add to
Home Screen_. No Xcode, no Apple Developer account, no App Store review, no
signing, no expiry. Ships through the existing Firebase Hosting pipeline
(`.github/workflows/cd-frontend.yml`).

React Native was rejected on measured cost, not taste:

| Layer                              |     LOC | PWA     | React Native  |
| ---------------------------------- | ------: | ------- | ------------- |
| View (`ui/*.tsx`)                  |  12,060 | carries | rewritten     |
| CSS                                |   7,783 | carries | **discarded** |
| Logic (state/services/types/utils) |   6,551 | carries | carries       |
| Component tests                    | ~16,900 | carries | mostly breaks |

RN has no CSS custom properties, no `color-mix()`, and no container queries —
i.e. no `theme.css`, and no `DESIGN.md`. It has no `react-grid-layout`
equivalent, and no ECharts (the RN wrappers render charts _inside a WebView_).
It keeps roughly a quarter of the non-test code.

The owner has a MacBook Air, so native is _possible_ — it is simply not worth
19.8k lines and a forked design system. **Capacitor** remains a cheap,
reversible add-on later (same codebase, adds a real `.ipa`); it is explicitly
**out of scope here** and nothing you write should preclude it.

---

## 2. Scope

**In — the phone (<768px) is a **viewer**:**

- Browse dashboards; read panels: charts, tables, metrics, markdown, text,
  images, dividers.
- Navigate between `/`, `/sources`, `/pipelines`, `/registry`.
- Log in and out.
- Install to home screen; launch standalone with correct icon, splash, theme
  colour, and safe-area handling.
- Light/dark and the user's accent must work exactly as on desktop.

**Out — do not build:**

- Panel drag/resize on phone. Panels **stack single-column and are read-only**.
- Panel creation, pipeline editing, source configuration on phone. These routes
  must remain _reachable and readable_, but editing affordances may be hidden
  below 768px. Do not delete them; do not build mobile editors for them.
- Offline data. The app shell may be precached; **dashboard data is
  network-only** (see §5.3).
- Any change to the backend, to `schemas/`, or to the API contract.
- Push notifications.
- iPad-specific work. iPad ≥768px already gets the desktop layout, which is the
  correct outcome. Verify it isn't broken; don't build for it.

---

## 3. Pre-flight

### 3.1 Cookie / domain — RESOLVED, no action needed

Confirmed by the owner (2026-07-14): the frontend is served from
**`helioapp.dev`**, the API from **`api.helioapp.dev`**. Same registrable domain
(`helioapp.dev`) → the `helio_session` cookie is **first-party** → Safari's ITP
does not block it. `SameSite=None; Secure` works as-is. **Nothing to do.**

Recorded because it is non-obvious and worth not re-deriving: had the frontend
been on `helio-493120.web.app`, `.web.app` is on the Public Suffix List, the
cookie would have been cross-site, and Safari would have blocked login on iOS
entirely.

### 3.2 Does Google OAuth survive standalone mode? (de-risk early)

`LoginPage.tsx:88` does a full cross-origin navigation:
`window.location.href = ${API_BASE_URL}/api/auth/google`.

**iOS standalone PWAs have a separate cookie jar from Safari.** Historically,
cross-origin navigation from a standalone PWA punted the user into Safari; the
OAuth redirect then completed _in Safari_, dropping the session cookie in the
wrong jar and leaving the PWA logged out forever. iOS 16.4+ improved this, but
it is version-sensitive and must be tested on the actual device, not reasoned
about.

**Mitigation already exists:** email/password login is a pure XHR
(`POST /api/auth/login`) and cannot break out of the PWA. If OAuth fails in
standalone, the correct response is to **hide the Google button below 768px in
standalone mode** and let password auth carry the phone. Do not attempt to fix
iOS's cookie jar.

---

## 4. Hazards — read before touching `PanelGrid`

### 4.1 The phone can silently corrupt saved layouts (critical)

This is the single most dangerous part of the task.

`PanelGrid.tsx:233` wires `onLayoutChange={handleLayoutChange}` →
`markLayoutChanged()` → the auto-save pipeline in `usePanelGridSave.ts` →
`updateDashboardLayout` → `PATCH /api/dashboards/:id`.

**React Grid Layout fires `onLayoutChange` on mount and on every
width/breakpoint change — not only on drag.** Layouts are persisted per
breakpoint (`lg`/`md`/`sm`/`xs`, `dashboardGridCols = {lg:12, md:10, sm:6,
xs:2}`) and `xs` is a **real stored layout**, not a derived one.

So: _merely opening a dashboard on a phone can PATCH a phone-derived `xs`
layout to the server._ If you also change how `xs` renders, you will write that
mangling back and corrupt the stored layout for every client.

**Requirement:** below 768px the grid must be **structurally incapable of
persisting layout**. Not "drag disabled" — RGL still fires `onLayoutChange`
with `isDraggable={false}`. Prefer **not rendering `<Responsive>` at all** on
phone: render a plain single-column stack of `PanelCard`s, ordered by the `xs`
layout's `y` then `x`. That path cannot call `markLayoutChanged`, which is the
only guarantee worth having.

Do **not** change `dashboardGridCols.xs` from `2`. It is part of the persisted
contract.

### 4.2 `DESIGN.md` §4 forbids the breakpoint you want

> "Canonical set, shared with React Grid Layout: **1440 / 1100 / 768**. CSS
> media queries use these values only. **[mechanical]**"

A phone port realistically wants a ~430px breakpoint. DESIGN.md's own rule is
_"When a rule and a deadline conflict, follow the rule or escalate. Never
silently diverge."_

**Therefore: amend `DESIGN.md` §4 as part of this change** — ratify the phone
breakpoint explicitly, in the doc, with a one-line rationale. Do not quietly add
a `@media (max-width: 430px)` and hope nobody greps.

Note `PanelDetailModal.css:575` already uses `480px` — a pre-existing violation.
Fold it into whatever you ratify rather than leaving two undocumented values.

### 4.3 Everything else

- **Fonts are remote.** `index.html` pulls Fraunces / Schibsted Grotesk /
  JetBrains Mono from Google Fonts. A standalone PWA on a bad connection will
  flash unstyled text. Either self-host into `public/` or give fonts a
  cache-first service-worker rule. Do not drop the font trio.
- **`theme-color` must follow light/dark**, or the iOS status bar will fight the
  theme. Two `<meta name="theme-color" media="(prefers-color-scheme: ...)">`
  tags, sourced from `--app-bg`.
- **Safe areas.** `viewport-fit=cover` + `env(safe-area-inset-*)` on the command
  bar and any bottom nav, or content sits under the notch and home indicator.
- **No swipe-back in standalone.** There is no browser chrome. Every route must
  be escapable via in-app navigation or the user is trapped.
- **`100vh` is a lie on iOS Safari.** Use `100dvh`.

---

## 5. Work items

### W1 — PWA shell

- Add `vite-plugin-pwa` to `frontend/`; configure in `vite.config.ts`.
- Web app manifest: `name: "Helio"`, `short_name: "Helio"`,
  `display: "standalone"`, `start_url: "/"`, `scope: "/"`, background and theme
  colours from `theme.css`.
- Icons generated from the existing `public/orbit-mark.svg` (use
  `@vite-pwa/assets-generator`): 180×180 `apple-touch-icon`, 192/512 standard,
  512 maskable. The OrbitMark is an accent-bearing brand asset — check it reads
  on both light and dark iOS home screens.
- `index.html`: `viewport-fit=cover`, `apple-mobile-web-app-capable`,
  `apple-mobile-web-app-status-bar-style`, `apple-touch-icon`, dual
  `theme-color`.

### W2 — Service worker (deliberately conservative)

- **Precache:** built JS/CSS/fonts/icons — the app shell only.
- **Network-only, never cached:** everything under `/api/**`. Non-negotiable:
  these responses are authenticated and user-specific. A cached `/api/auth/me`
  or a stale dashboard is a correctness bug, and a cached response served to the
  wrong session is a security bug.
- Registration must not break the existing 401 interceptor in `main.tsx`.
- Ship an update path (`registerType: "autoUpdate"`). A wedged service worker on
  a phone with no devtools is genuinely hard to recover from.

### W3 — Native-feeling navigation (`app/App.tsx`, `app/App.css`)

**This is a primary goal of the change, not plumbing.** The owner's brief: the
navbar UX should feel like native UI, not a website's. Budget accordingly.

#### W3.0 — The trap: Helio's nav is two levels, not one

Read this before designing anything.

The sidebar carries **two orthogonal things**:

1. **Section nav** — `NavLink`s to `/`, `/sources`, `/pipelines`, `/registry`
   (`App.tsx:132–143`).
2. **Item nav** — `SidebarBody` (`shared/chrome/SidebarBody.tsx`), which is
   _context-sensitive_: on `/` it renders **`DashboardList`** (full CRUD); on
   other sections it renders the lighter `SidebarItemList`.

**`DashboardList` is the only dashboard switcher in the app, and it lives inside
the sidebar.** So "replace the sidebar with a bottom tab bar" silently deletes
the single most important action a phone viewer has: _choosing which dashboard
to look at_. Any design that doesn't answer "how do I switch dashboards on a
phone" is wrong, however good the tab bar looks.

Current mobile state is a stub and effectively broken: `App.css:335` pins
`.app-sidebar` to `position: fixed; top: 48px` and collapses it to `width: 0`
with no way to reopen it.

#### W3.1 — Section nav → bottom tab bar

- New component, `shared/chrome/BottomNav.tsx` + `.css`. **Build it as a real
  shared component, breakpoint-gated — not a phone-only hack.** The owner may
  promote this to desktop after living with it; that decision should be a
  breakpoint/flag change, not a rewrite.
- Four destinations, reusing the existing `NavLink` targets and Lucide icons so
  phone and desktop nav can't drift.
- **Opaque background** — `--app-surface`, hairline `--app-border-subtle` top
  border. **Do not** use the iOS translucent-blur material, however native it
  looks. `DESIGN.md` §0.2's opacity invariant exists precisely because
  dashboards carry user-set backgrounds; a translucent bar would tint against
  them and look broken. Opaque is both compliant and correct here.
- **Active tab uses `--app-accent`** — explicitly sanctioned by `DESIGN.md` §0.3
  ("the active nav indicator"). Inactive: `--app-text-muted`. This is one of the
  few places accent is _allowed_; use it, and nowhere else in the bar.
- Height from the control tokens **plus `env(safe-area-inset-bottom)`**. Tap
  targets ≥44×44pt (Apple HIG) — the real constraint, regardless of icon size.
- Labels in the UI face (Schibsted Grotesk) per `DESIGN.md` §0.4 — **not** mono.
  Mono is for data/annotation; a tab label is neither.

#### W3.2 — Dashboard switching → tappable title + sheet

This is the answer to W3.0, and it's the genuinely native pattern (cf. Files'
location picker, Safari's tab groups):

- The command bar's `__breadcrumb-current` already holds the dashboard name but
  is `display: none` at 768px (`App.css`). **Restore it on phone as a tappable
  title** — name + a small chevron, making it visibly a control.
- Tapping it opens a **bottom sheet** listing dashboards (source the data from
  `DashboardList`'s existing selectors — do not fork the state). Tap to switch,
  sheet dismisses. Swipe-down and backdrop-tap to dismiss.
- **Viewer scope:** the sheet is a _picker_. `DashboardList`'s CRUD
  (create/rename/delete/duplicate) is **out of scope on phone** — omit those
  affordances from the sheet rather than reimplementing them.
- The sheet is a surface: opaque `--app-surface-strong`, per `DESIGN.md`.
- Reuse the existing overlay/portal infrastructure (`OverlayProvider`,
  `shared/chrome/Popover.css`, `shared/ui/Modal.css`) rather than inventing a
  third overlay mechanism.

#### W3.3 — The rest of the shell

- Keep the desktop sidebar **untouched** ≥768px. All of the above is additive
  below the phone breakpoint.
- On other sections (`/sources`, `/pipelines`, `/registry`), `SidebarItemList`
  has the same problem in miniature. Viewer scope means these are
  _read-and-navigate_; the simplest correct answer is the same sheet pattern
  driven by the same title control. Don't build a second mechanism.
- Every route must be escapable via the tab bar — there is no swipe-back in
  standalone (§4.3).

### W4 — Viewer grid and panel sizing (**the heart of the change**)

**The owner's brief: "it's very important that dashboard sizing feels right on
mobile — that's half the reason I'm doing this rather than staying in the
browser."** If the sizing is merely acceptable, this project has failed at its
own premise. Treat everything below as the primary deliverable.

#### W4.1 — Structure

- Below the phone breakpoint, `PanelGrid` renders a **single-column read-only
  stack**, ordered by the `xs` layout (`y`, then `x`). Per §4.1 this path must
  not import or invoke the save pipeline — that is a correctness requirement,
  not a preference.
- Hide drag handles, resize handles, and title-edit affordances.

#### W4.2 — Why you must NOT honour the stored `h`

The instinct is to keep each panel's stored height (`h × rowHeight` where
`rowHeight: 52`, `margin: [18,18]`). **Resist it. This is the thing that will
make the app feel like a squashed website** — precisely the outcome the owner is
paying for a PWA to avoid.

The reason: `h` encodes intent _inside a 12-column desktop grid_. A panel that
was 6 cols × 5 rows was ~640×332 — a landscape rectangle. Full-width on a phone
it becomes ~358×332, nearly square. The stored number survives; the _proportion_
it was chosen for does not. A `metric` panel at `h=5` becomes 332px containing
one number — roughly 80% whitespace. That single case is the biggest "this is
just the website" tell in the whole app.

What _is_ real signal in `h` is **relative** intent: a chart the user made tall
versus one they made short. So:

> **Rule: height is content-appropriate per panel kind, modulated by `h` within
> a clamped band. Never `h × 52`.**

#### W4.3 — Per-kind height policy

`PanelKind = "metric" | "chart" | "table" | "text" | "markdown" | "image" |
"divider"` (`features/panels/types/panel.ts:52`). Let `w` = panel content width
(≈344–358px at a 390px viewport). These are the starting values — tune them on
device (§6), they are not sacred:

| Kind       | Policy                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `metric`   | **Content-sized, ~104–132px. Ignore `h` entirely.** It is one number and a label. This is the highest-impact fix in the table. |
| `chart`    | Aspect-driven: `clamp(200px, w × 0.62, 340px)`. Use `h` to pick within the band — `h ≤ 4` → compact end, `h ≥ 8` → tall end.   |
| `table`    | `min(60dvh, header + rows × rowHeight)`. **Must cap** — an unbounded table wrecks page scroll. Internal scroll, see W5.        |
| `markdown` | **Fully intrinsic.** No fixed height, no cap, no internal scroll. Let text flow and the page scroll.                           |
| `text`     | Same as `markdown`.                                                                                                            |
| `image`    | Natural aspect ratio, `max-width: 100%`, `height: auto`.                                                                       |
| `divider`  | Intrinsic hairline. No card chrome at all — no header, no footer.                                                              |

**Nested scroll containers are the enemy.** They are the worst-feeling thing in
an iOS web view (§1) and the clearest "website in a shell" signal. Only `table`
gets one, and only because the alternative is worse.

#### W4.4 — Density and chrome

At 390px, chrome is the tax that decides whether this feels native:

- **Gutters:** desktop `margin: [18,18]` and its container padding are too fat.
  Use `--space-3` (12px) rhythm between cards and for container padding. Tokens
  only, per `DESIGN.md` §3.
- **Card chrome:** drop `.panel-grid-card__footer`'s type badge and the drag
  handle on phone. Keep the title and freshness. Every px of chrome is a px not
  spent on the data.
- **Kill the zoom widget.** `PanelList.tsx:138` renders zoom in/out/reset. On a
  phone this is meaningless desktop chrome — iOS has pinch — and it eats header
  space. Hide it below the phone breakpoint.
- **Metric typography:** the classic failure is a large value clipping or
  wrapping. Use the `DESIGN.md` type scale (not desktop sizes), keep tabular
  numerals, and test with a genuinely long value (e.g. `1,234,567.89`).

#### W4.5 — Detail modal

`PanelDetailModal` must be full-screen on phone and dismissible without a hover
target (`PanelDetailModal.css:575` currently has a stray `480px` query — fold it
into the ratified breakpoint, see §4.2).

### W5 — Renderers at 390px

Each renderer in `features/panels/ui/renderers/`:

- **ChartRenderer / ECharts** — verify resize on rotation; ECharts needs an
  explicit resize on container change. Legends and axis labels will overflow;
  fix via ECharts config, not CSS. Consider hiding legends below the phone
  breakpoint.
- **TableRenderer / `DataGrid.css`** — the real problem child. Must scroll
  horizontally _within the panel_ (`overflow-x: auto`); the page body must never
  scroll horizontally.
- **MetricRenderer** — should look _better_ on phone; check tabular numerals and
  that large values don't clip.
- **MarkdownRenderer / TextRenderer / ImageRenderer** — check long words, code
  blocks, and wide images don't force body scroll.
- Container queries on `panel-card` already exist (DESIGN.md §4) and are the
  right tool. Prefer them over new media queries.

### W6 — Auth on phone

- Per §3.2: if OAuth breaks in standalone, hide the Google button below the
  phone breakpoint; keep password login. Test on device first.
- `LoginPage` / `RegisterPage` must be usable with the iOS keyboard up — inputs
  must not slide under it. `autocomplete` attributes are already correct
  (`current-password`); keep them so iOS offers Keychain.

---

## 6. Verification — required, on a real device

Jest and a desktop browser at 390px **do not** verify this work. Per
`.concertino/laws/verification-before-completion`, completion requires fresh
evidence.

1. `npm --prefix frontend run build && npx vite preview --host` — reachable from
   the phone on the LAN.
2. On the actual iPhone, in Safari: load, log in, open a dashboard, read every
   panel type, rotate.
3. **Add to Home Screen. Launch from the icon.** Confirm: correct icon, no
   browser chrome, no notch overlap, nav works, back is never a trap, light/dark
   and accent correct.
4. **The layout-corruption check (do not skip):** note a dashboard's `xs` layout
   server-side, open that dashboard on the phone, background the app, wait,
   reopen. Re-read the layout. **It must be byte-identical.** If it changed, §4.1
   is not satisfied and the work is not done.
5. **The sizing check (W4 is the premise of the project):** build a dashboard
   containing **one of every `PanelKind`** and read it on the phone. Specifically
   confirm: no metric panel is mostly whitespace; no chart is squashed or
   stretched; the table scrolls horizontally _within its panel_ while the body
   never scrolls sideways; markdown flows without a nested scrollbar. Screenshot
   it for the owner — this is the deliverable he'll judge.
6. **The switcher check:** from the phone, switch between at least three
   dashboards without touching the URL bar (there isn't one in standalone).
7. `npm run lint && npm test` clean; Husky pre-commit passes.

**Debugging:** the owner has a MacBook Air. Safari on macOS can remote-inspect a
standalone PWA on a physical iPhone over USB (enable Settings → Safari →
Advanced → Web Inspector on the phone). Ask for it if you're stuck — debugging a
standalone PWA without it is blind.

---

## 7. Definition of done

- Installs to the iPhone home screen and launches standalone with correct
  branding, safe areas, and theme.
- **Dashboard sizing feels native, not squashed** — per-kind heights (W4.3), no
  metric-panel whitespace, no nested scrollers outside tables. Proven by §6.5.
  _This is the bar the project is judged against._
- **Navigation feels like native UI** — opaque bottom tab bar, dashboard
  switching via tappable title + sheet, every route escapable. Proven by §6.6.
- **No layout write-back from phone, proven by §6.4.**
- Desktop and iPad ≥768px are visually and behaviourally unchanged.
- `DESIGN.md` §4 amended to ratify the phone breakpoint.
- Lint, format, and tests pass. No backend or schema changes.

---

## 8. Open questions to raise, not guess

- §3.2's answer, from a real device (Google OAuth in standalone mode).
- **W4.3's numbers are a starting point, not a spec.** They were derived by
  reading the code, not by looking at a phone. Tune them on device and show the
  owner — "feels right" is a judgment call and it's his to make, not yours.
- W3's tab bar and dashboard sheet are the only genuinely new UI here and
  `DESIGN.md` has no precedent for either. **Screenshot both before building
  them out fully.** Note the owner is considering promoting the bottom nav to
  desktop web later — build it as a real component (W3.1), not a phone hack.
