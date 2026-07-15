# HEL-302 — Native-feeling mobile navigation — bottom tab bar and dashboard sheet

Priority: High
Project: Helio Mobile — PWA
URL: https://linear.app/helioapp/issue/HEL-302/native-feeling-mobile-navigation-bottom-tab-bar-and-dashboard-sheet

**"The navbar UX should change to be more UI native."** This is a primary goal of the project, not plumbing. Budget accordingly.

`notes/mobile-pwa-handoff.md` **is the binding spec.** Read it in full first, including its §0 instruction to read `DESIGN.md` and `CONTRIBUTING.md`. This ticket is spec section **W3**.

Blocked by HEL-300 (merged — PR #226, on this branch's base), which ratifies the phone breakpoint in `DESIGN.md`.

## W3.0 — The trap: Helio's nav is two levels, not one

**Read this before designing anything.**

The sidebar carries **two orthogonal things**:

1. **Section nav** — `NavLink`s to `/`, `/sources`, `/pipelines`, `/registry` (`App.tsx:132–143`).
2. **Item nav** — `SidebarBody` (`shared/chrome/SidebarBody.tsx`), which is *context-sensitive*: on `/` it renders `DashboardList` (full CRUD); on other sections it renders the lighter `SidebarItemList`.

`DashboardList` **is the only dashboard switcher in the app, and it lives inside the sidebar.** So "replace the sidebar with a bottom tab bar" silently deletes the single most important action a phone viewer has: *choosing which dashboard to look at*.

**Any design that doesn't answer "how do I switch dashboards on a phone" is wrong, however good the tab bar looks.**

Current mobile state is a stub and effectively broken: `App.css:335` pins `.app-sidebar` to `position: fixed; top: 48px` and collapses it to `width: 0` with no way to reopen it.

## W3.1 — Section nav → bottom tab bar

* New component: `shared/chrome/BottomNav.tsx` + `.css`. **Build it as a real shared component, breakpoint-gated — not a phone-only hack.** matto00 may promote this to desktop web after living with it; that should be a breakpoint/flag change, not a rewrite.
* Four destinations, reusing the existing `NavLink` targets and Lucide icons so phone and desktop nav can't drift.
* **Opaque background** — `--app-surface`, hairline `--app-border-subtle` top border. **Do not use the iOS translucent-blur material, however native it looks.** `DESIGN.md` §0.2's opacity invariant exists precisely because dashboards carry user-set backgrounds; a translucent bar would tint against them and look broken. Opaque is both compliant and correct here.
* **Active tab uses** `--app-accent` — explicitly sanctioned by `DESIGN.md` §0.3 ("the active nav indicator"). Inactive: `--app-text-muted`. This is one of the few places accent is *allowed*; use it there and nowhere else in the bar.
* Height from control tokens **plus** `env(safe-area-inset-bottom)`. Tap targets ≥44×44pt (Apple HIG) — the real constraint regardless of icon size.
* Labels in the UI face (Schibsted Grotesk) per `DESIGN.md` §0.4 — **not** mono. Mono is for data/annotation; a tab label is neither.

## W3.2 — Dashboard switching → tappable title + sheet

The answer to W3.0, and the genuinely native pattern (cf. Files' location picker, Safari's tab groups):

* The command bar's `__breadcrumb-current` already holds the dashboard name but is `display: none` at 768px (`App.css`). **Restore it on phone as a tappable title** — name plus a small chevron, so it visibly reads as a control.
* Tapping opens a **bottom sheet** listing dashboards. **Source the data from `DashboardList`'s existing selectors — do not fork the state.** Tap to switch, sheet dismisses. Swipe-down and backdrop-tap to dismiss.
* **Viewer scope:** the sheet is a *picker*. `DashboardList`'s CRUD (create/rename/delete/duplicate) is **out of scope on phone** — omit those affordances rather than reimplementing them.
* The sheet is a surface: opaque `--app-surface-strong`, per `DESIGN.md`.
* **Reuse the existing overlay/portal infrastructure** (`OverlayProvider`, `shared/chrome/Popover.css`, `shared/ui/Modal.css`) rather than inventing a third overlay mechanism.

## W3.3 — The rest of the shell

* Keep the desktop sidebar **untouched** ≥768px. All of this is additive below the phone breakpoint.
* On `/sources`, `/pipelines`, `/registry`, `SidebarItemList` has the same problem in miniature. Viewer scope means these are *read-and-navigate*; the simplest correct answer is the same sheet pattern driven by the same title control. **Don't build a second mechanism.**
* **Every route must be escapable via the tab bar** — there is no swipe-back in standalone mode, and no browser chrome to fall back on. A trapped route is a bug.

## Out of scope

Panel sizing (HEL-301 — being worked in parallel in its own worktree; stay strictly out of its territory), PWA shell (HEL-300), dashboard CRUD on phone, backend or `schemas/` changes.

## Acceptance criteria

- [ ] Bottom tab bar below the phone breakpoint: opaque, accent active state, safe-area inset, ≥44pt targets.
- [ ] Dashboard switching works on phone via tappable title → sheet, sourced from existing selectors.
- [ ] No route is a trap; every one is escapable without browser chrome.
- [ ] `BottomNav` is a real breakpoint-gated shared component, promotable to desktop without a rewrite.
- [ ] Desktop and iPad ≥768px visually and behaviourally unchanged.
- [ ] `npm run lint && npm test` clean; Husky passes. No backend or schema changes.

## Verification is human-performed — and show the design early

**The tab bar and dashboard sheet are the only genuinely new UI in this project, and `DESIGN.md` has no precedent for either.**

**Screenshot both and show matto00 before building them out fully.** Do not disappear and return with a finished nav — this is a taste call and it's his, not yours.

`.concertino/laws/verification-before-completion` requires fresh evidence you cannot produce: a 390px desktop viewport proves nothing about tap targets, safe areas, or standalone-mode navigation. **The correct terminal state is "ready for device testing", not "done."** Hand back with a build (`npm --prefix frontend run build && npx vite preview --host`, phone on same wifi) plus an ordered test plan, including: switch between at least three dashboards from the phone without touching the URL bar (there isn't one in standalone).

**Do not let the evaluator or skeptic accept your own desktop evidence.**

## Orchestrator-mandated checkpoints (from the human, binding)

1. **Design checkpoint (mid-execution ESCALATION):** the tab bar and dashboard sheet must be screenshotted and shown to the human BEFORE being built out fully. The executor must pause after producing first-cut visuals of both components, hand screenshots back, and wait for human feedback before completing the build.
2. **Terminal state is "ready for device testing", not "done":** delivery includes a production build + ordered on-device test plan handed back to the human. The evaluator and skeptic must NOT accept desktop-viewport evidence as device verification — desktop Playwright evidence covers regressions and structure only.
