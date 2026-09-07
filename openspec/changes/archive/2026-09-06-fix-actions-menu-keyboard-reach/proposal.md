# Fix ActionsMenu programmatic focus-restore at desktop width

## Why

The dashboard-row `ActionsMenu` wrapper is `display: none` at rest. Calling
`.focus()` on its trigger therefore no-ops — `document.activeElement` stays on
`<body>` — so a dialog opened from the menu cannot return focus to its invoker.
This is the HEL-590 focus-restore symptom, reproduced in Chromium at 1440.

**This ticket has been re-framed twice, and was wrong both times. Read
design.md's R1-R6 before trusting any framing of it, including this one.**
In particular:

- The originally-claimed fix (reveal on `:focus-within` as well as `:hover`)
  **has been on main since commit `affbec86e`, 2026-05-10** — four months
  before the run that "found" the bug. It is what makes the desktop tab path
  work today.
- A restatement claiming the kebab was keyboard-unreachable inside
  `MobileNavSheet` at 430 was **also false** (R6): `.app-sidebar` is
  `display: none` at <=768px, so the sidebar and its kebab are not rendered at
  phone width at all, and `MobileNavSheet` contains no `ActionsMenu`. That
  claim came from a probe whose visibility predicate could not return false.

What is left, and all that is left, is the programmatic-focus defect at
desktop width.

Why now: focus restore is the difference between a dialog dismissal returning a
keyboard user to where they were and dropping them at the top of the document.

## What Changes

- Make the dashboard-row `ActionsMenu` trigger **programmatically focusable at
  rest** at desktop width, so focus restore from a dialog lands on the invoker
  rather than `<body>`. Implemented as host CSS in `DashboardList.css`, using
  the visually-hidden recipe canonically defined at
  `frontend/src/theme/theme.css:340`, with a comment naming that as its source.
  The `.sr-only` **class** itself is deliberately not used: it is a markup
  class, the wrapper at `ActionsMenu.tsx:152` takes no `className`, and
  hidden-at-rest vs painted-on-reveal is a CSS state rather than a fixed
  property (design.md D1).
- **Extend the existing hover/`:focus-within` reveal rule to undo every one of
  those declarations**, not just `display`. Omitting this leaves the kebab
  never painted again while every acceptance criterion and both guard arms
  still pass — a measured green-but-broken outcome (design.md D1).
- Add a **Playwright** regression guard whose red arm is the
  **programmatic-focus sentinel** (`document.activeElement` is `<body>` with
  the fix reverted), proven load-bearing in both arms.
- The guard ships as **two keyboard tests with two different jobs — keep them
  distinct, don't read them as double coverage of the same thing:**
  - **"resting trigger is a real focus target" — the proof.** Calls `.focus()`
    on the resting trigger and asserts `document.activeElement` is the
    trigger. This is the one that actually catches the defect: reverted to
    the pre-fix CSS, it goes **RED** (`{"isTrigger":false,"isBody":true,
    "tag":"BODY"}`).
  - **"keyboard: Tab reaches trigger…" — a no-regression guard, not a proof.**
    Drives real `Tab` keypresses (a bounded loop, not a hardcoded tab index —
    a hardcoded count is exactly as fragile as a line-number-pinned assertion)
    to the trigger, then Enter/ArrowDown/Escape. Measured, not assumed, to
    stay **GREEN** with the pre-fix CSS too: `:focus-within`
    (`DashboardList.css:244`) already reveals the wrapper once the row button
    ahead of it in tab order is focused, before *and* after this fix, so a
    Tab walk cannot discriminate this defect no matter how it's written. Its
    job is only to confirm the existing Tab/Enter/Escape path still works —
    it must never be cited as evidence the fix works.
  An earlier revision of the second test called `.focus()` instead of
  pressing real Tabs, making it silently duplicate the first test's axis
  under a different name — "one axis wearing two labels" — while its own
  comment still (falsely, at that point) claimed it was non-discriminating.
  Caught and fixed before merge; both arms above were re-measured after the
  fix to confirm the labels now match the instruments.
- Triage the 12 jsdom focus assertions in `ActionsMenu.test.tsx` and
  `MobileNavSheet.test.tsx` — the files this change touches — keeping those
  genuinely falsifiable under jsdom and annotating the rest.

Not a breaking change. No API, wire shape, or contract moves. No migration.

## Explicitly NOT in this change

- **No change to `MobileNavSheet`'s focus trap.** Its current behaviour is
  correct (design.md D2/R6). Nothing here should lead an executor to touch it.
- **No change to phone-width rendering.** `.app-sidebar` stays `display: none`
  at <=768px. Un-hiding it is not the fix for anything here.
- The missing mobile actions affordance is **HEL-1006**.
- The 27 remaining jsdom assertions across 9 other files are **HEL-1005**.

## Capabilities

### New Capabilities

- `actions-menu-keyboard-access` — the shared `ActionsMenu`'s keyboard and
  programmatic-focus contract, binding only where the menu is actually
  rendered.

### Modified Capabilities

None. (An earlier revision declared `mobile-dashboard-sheet`; that delta was
deleted along with the withdrawn phone-width scope.)

## Impact

- `frontend/src/features/dashboards/ui/DashboardList.css` — the resting
  `display: none` on the row's `.popover.actions-menu`
- `e2e/` — new Playwright guard, written fresh
- `frontend/src/shared/chrome/{ActionsMenu,MobileNavSheet}.test.tsx` —
  annotation/triage only, no behavioural change

`ActionsMenu` is shared by `DashboardList`, `PanelCard`, `SidebarItemList`,
`CommandBar`, and `PipelineDetailHeader`. The hover-reveal being changed is
host-surface CSS in `DashboardList.css` and applies only to the dashboard rows,
so the blast radius is narrower than the component's consumer list — but those
consumers must still be confirmed unaffected (design.md D6).

**The accessibility-tree shift is the actual win here, not a side effect of
the fix.** Every resting sidebar-row `ActionsMenu` trigger is now present and
announced in the accessibility tree — where previously, under
`display: none`, none was. This is broader than the ticket's own framing
(desktop dashboard-row focus-restore): the CSS selector
`.dashboard-list__item-row .popover.actions-menu` is reused by
`SidebarItemList` (it imports `DashboardList.css` and shares the same
`dashboard-list__item-row` class), so **every Data Sources, Pipelines,
Metrics, and Conversations sidebar row changes too, not just dashboards.**
Bounded explicitly, not merely asserted: `PanelCard`, `CommandBar`, and
`PipelineDetailHeader` are unaffected because none of them uses that class.
Stating this plainly here so it is not left for whoever next runs a screen
reader against the sidebar to discover on their own.

**The four `e2e` locators fixed in this change (`hel910-pipeline-to-
dashboard-flow.spec.ts:187`, `hel909-output-picker-panel-sheet.spec.ts:111,
184,220`) were latently broken before this change, not broken by it —
`getByRole("button", { name: "Dashboard actions" })` matches by substring, so
a row named e.g. `"HEL-910 Flow Dashboard actions"` was always going to
collide with the CommandBar's own, unrelated `"Dashboard actions"` trigger.**
This change did not make those locators fragile — it revealed a fragility
that already existed, by putting the resting row trigger into the
accessibility tree for that substring match to find.

**These two files are not in the same evidentiary state, and that
distinction must not be blurred (correction, final-gate round 2,
skeptic-final-2.md):**

- `hel910-pipeline-to-dashboard-flow.spec.ts` — **genuinely exercised.** It
  ran and passed before this change, failed deterministically once the CSS
  fix landed (reproduced by isolation: reverting only the locator fix, CSS
  untouched, reproduces the exact strict-mode violation), and passes again
  with `exact: true`. The full-suite `42 passed` measurement includes it.
- `hel909-output-picker-panel-sheet.spec.ts` — **NOT exercised, at any
  point.** This file is on `playwright.config.ts`'s quarantine register
  (**HEL-951**, follow-up **HEL-963** — a pre-existing, unrelated defect: "a
  panel placed via the OutputPicker never becomes visible in the grid /
  mobile stack"). It does not run in CI or locally; `npx playwright test
  --list | grep -c hel909` returns `0`. Its three `exact: true` edits were
  **never run before this change, are not run by this change, and are not
  part of the 42-passed count.** They are correct **by reasoning** — the
  identical substring-collision mechanism, the same trigger, the same
  non-exact locator shape as the verified `hel910` fix — but that is
  reasoning, not measurement, and an earlier revision of this ticket's
  artifacts wrongly stated these sites had "passed" and were "now exercised."
  Both statements were false and have been corrected. **Anyone
  unquarantining HEL-951/HEL-963 must re-verify these three sites then** —
  they carry no execution evidence from this change.

See `files-modified.md` for the isolation-test transcript and the full-suite
before/after measurement.

**`MobileNavSheet.tsx` is NOT in this list** and must not be modified.

No database migration (main is at V102). No backend change.
