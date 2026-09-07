# HEL-1003: ActionsMenu keyboard reachability (scope restated after real-browser premise validation)

## Description

The shared `ActionsMenu` chrome hides its wrapper with `display: none` until
hover. Two consequences were claimed by the original ticket; real-browser
measurement (Chromium, Playwright, 1440x900 and 430x900, base `ef3b7538`)
confirmed one and refuted the others. Note the ticket's framing of 1440 and
430 as two comparable "entry points" to the same surface is itself wrong: below
the 768px breakpoint this surface **is not rendered at all** (see design.md
R3/R6), so 430 is not a working path or a broken one — it is not a path. The
scope below is the **final** scope, approved via escalation
`narrow-to-desktop-and-spinoff`.

### (a) CONFIRMED — programmatic focus-restore no-ops at desktop width

`.focus()` on the resting (hidden) trigger leaves `document.activeElement` on
`<body>` at 1440. This is the genuine HEL-590 focus-restore symptom: a dialog
opened from the menu cannot return focus to its invoker.

**Not "at both widths."** At 430 `.focus()` also fails, but only because
nothing is rendered to focus — a different fact with a different cause, not a
second instance of this defect. Defect (a) exists only above the 768px
breakpoint.

### (b) WITHDRAWN — there is no keyboard defect at 430

An earlier restatement of this ticket claimed the row kebab was
keyboard-unreachable inside `MobileNavSheet` at 430. That was **false**, and
was produced by a probe whose visibility predicate could not return false
(see design.md D0c). Ground truth:

- `frontend/src/app/App.css:604-609` (inside the `:519`
  `@media (max-width: 768px)` block) sets `.app-sidebar { display: none }` —
  at phone width the sidebar, `DashboardList`, and the kebab are **not
  rendered at all**.
- `MobileNavSheet` contains **no `ActionsMenu`** (its only mention is a comment
  at line 419); `MobileShell.tsx:47` hardcodes `secondaryAction` to a single
  `"Share"` for dashboards only.

The real phone-width gap is that there is **no host for Rename / Duplicate /
Export / Delete for any input modality, pointer included** — a missing mobile
affordance and a product question, not an accessibility defect. It is spun off
and is NOT in scope here.

### REFUTED — the desktop path is not broken

At 1440 the row kebab is reached at Tab #15, Enter opens the menu, focus lands
on "Rename", all of Rename/Duplicate/Share/Export/Delete are present and
activatable, and Escape restores focus to the kebab.

### REFUTED — the originally-proposed fix is already on main

`DashboardList.css:244` has had
`.dashboard-list__item-row:focus-within .popover.actions-menu` since commit
`affbec86e`, 2026-05-10 — four months before HEL-590. It is what makes the
1440 path work.

## Acceptance criteria

1. Programmatic `.focus()` on the dashboard-row `ActionsMenu` trigger succeeds
   **at desktop widths (above the 768px breakpoint)** —
   `document.activeElement` is the trigger, not `<body>` — verified in a real
   browser. **This criterion is deliberately NOT stated at 430**: the sidebar
   is `display: none` there, and no descendant of a `display: none` ancestor is
   focusable, so a 430 criterion would be unsatisfiable by correct code and
   would function as an instruction to un-hide the sidebar on phone.
2. Keyboard operation of the row menu at desktop width is unregressed: the
   kebab is reached by Tab, Enter opens the menu with focus on its first item,
   arrow keys navigate, and Escape restores focus to the trigger.
3. The resting row at desktop width is **geometrically unchanged** — the
   focusable-at-rest trigger must not reflow the `flex: 1` row button
   (measured: row button 215px before and after).
3a. **The kebab is still PAINTED on reveal.** On `:hover` and on
   `:focus-within`, verified in a real browser: the wrapper is
   **`position: relative`** (the `Popover.css:1-3` baseline — *not* `static`,
   which a correct implementation never produces) with **`clip: auto`**, and
   the `flex: 1` row button reflows to its pre-change hover width (measured:
   215px -> 187px). **This criterion exists because the fix is otherwise
   satisfiable while the kebab is never painted again** — the reveal rule
   currently resets only `display`, and every other criterion here, including
   both guard arms, passes in that broken state.
   The revealed wrapper's own rendered **height must also be asserted** (it is
   `1px` at rest). A reveal rule that resets everything *except* `height`
   passes the 187px, `clip: auto`, `position: relative` AND 24x24 checks while
   painting the kebab inside a 1px-tall box — measured in round 5. The height
   assertion is what closes that gap at the criterion level; task 2.4 already
   enumerates `height` procedurally.
   The trigger's rendered rect **is** a valid additional check: measured, it is
   **24x24 when correctly revealed** and **3x24 in the broken state** (the
   1px-wide wrapper shrinks the 24px flex item; `flex-shrink: 1`). An earlier
   revision wrongly forbade this check as vacuous on a fabricated "24x24 in
   the broken state too" claim — see design.md D1. The primary discriminators
   remain the 187px reflow and `clip: auto`.
4. A **Playwright** regression guard exists and is proven load-bearing in both
   arms, using the assertion shape fixed in design.md D4: the discriminating
   assertion is **programmatic focus** (`.focus()` on the resting trigger puts
   `document.activeElement` on the trigger), and the red arm shows the sentinel
   **`document.activeElement === document.body`** with the observed
   `activeElement` recorded. The green arm shows CI passing with the guard
   removed and the defect present. Forbidden as red-arm substitutes:
   element-presence assertions, and **tab-reachability**, which is green both
   before and after the fix and so discriminates nothing.
5. Per design.md D0d, every probe and guard used as evidence is **first shown
   able to produce its negative result**.
6. The 12 jsdom focus assertions in `MobileNavSheet.test.tsx` and
   `ActionsMenu.test.tsx` are each triaged: kept as-is where genuinely
   falsifiable under jsdom, or annotated with an explicit note of what they
   cannot prove.

## Out of scope

- The remaining 27 suspect jsdom assertions across 9 other files: **HEL-1005**.
- The missing mobile actions affordance at phone width: **HEL-1006**.
- Any change to `MobileNavSheet`'s focus trap (design.md D2 — its current
  behaviour is correct).
