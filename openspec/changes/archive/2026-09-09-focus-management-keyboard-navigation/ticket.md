# HEL-520: Focus management and keyboard navigation across the app

## Description

DESIGN.md §8 sets the accessibility baseline (global focus ring `outline: 2px solid var(--app-accent)`, keyboard operability, dialogs handle Enter/Escape). Individual components honor pieces of it (the `Modal` in `shared/ui/Modal.tsx`, DataGrid resize handles), but there is no app-wide pass ensuring focus is trapped in dialogs, restored on close, and that all primary flows are fully keyboard-navigable. The app has several modal surfaces and a panel grid.

## Scope

* Audit and fix focus trapping + restoration for all modal/dialog surfaces built on the shared `Modal` (`frontend/src/shared/ui/Modal.tsx`): focus moves into the dialog on open, is trapped within it, and returns to the invoking control on close. Escape closes; Enter submits where a primary action exists.
* Ensure a visible focus indicator everywhere per the §8 rule (accent outline / input accent-border + halo); fix any interactive element that suppresses the outline.
* Make primary flows fully keyboard-operable end to end: creating a panel, editing panel/dashboard appearance, switching dashboards, opening/closing the panel detail modal, and the panel grid's actionable controls.
* Add a "skip to content" affordance for keyboard users if the app shell lacks one.
* Where a roving-tabindex or arrow-key pattern is warranted (e.g. toolbar/menu clusters), apply it consistently.

## Acceptance criteria

* AC1 — Every dialog traps focus, restores focus to its trigger on close, and responds to Escape/Enter.
* AC2 — No interactive element is reachable without a visible focus indicator.
* AC3 — The panel-create, appearance-edit, dashboard-switch, and detail-modal flows are completable with keyboard only, verified in the app.
* AC4 — Jest/RTL coverage for focus trap + restore on the shared `Modal` and at least one consuming surface.

## Out of scope

* ARIA role/label coverage (separate ticket — coordinate).
* Screen-reader copywriting beyond accessible names.

## Premise validation (orchestrator, 2026-09-09, against 7b872db9)

Verdict: **minor-staleness**. Two rounds of probing plus a DESIGN.md cross-check; this section is written as a
single corrected statement rather than as findings-plus-corrections, per MISTAKES.md ("corrections replace
decision text; they never accumulate beneath it"). Where an earlier round of my own probing was wrong, the
wrong claim is stated only as a warning about the method that produced it.

### Already satisfied — do not rebuild

* **The skip-to-content affordance exists** (`App.tsx:206` `.app-skip-link`, HEL-772, pinned in
  `focusRingTokenGuard.css.test.ts:245`). That scope bullet is DONE.
* **`PanelCreationModal` no longer exists.** Migrated onto the shared `Modal` under HEL-716; its hand-rolled
  trap was deleted and generalized into `Modal.tsx`. Do not look for it.
* **AC1 is met for the shared `Modal` and its 17 consumers**: Tab/Shift+Tab wrap (HEL-716), previously-focused
  restore (HEL-590), Escape via the native `cancel` event.
* **AC4's trap half is met** — `Modal.test.tsx` covers it in three cases. **The restore half is not**: zero
  restore assertions in that file. `ShareDialogFocusRestore.test.tsx` already serves as a consuming surface.
* **Shape note, verified against the files:** the eleven suppression sites are not uniform. **Four suppress
  unconditionally in the element's BASE rule**, with any replacement supplied by a separate later rule —
  `auth.css:107`, `AccentPicker.css:19`, `PipelineDetailPage.css:885`, and `AddSourceModal.css:165` (a single `outline: none` in the base rule; the *pair* is the two grouped
  selectors in the separate `:focus` rule beneath it).
  The remainder suppress inside their own `:focus-visible` rule. An unconditional base-rule suppression is
  exactly what `accessible-focus-indicator`'s existing "unconditional suppression is not a focus state"
  requirement names, so these four warrant the closest measurement. Re-derive each site's shape from the file,
  not from this summary — two earlier tallies in this planning round were themselves wrong.
* **BOTH the `outline` channel AND the border/box-shadow channel are already guarded in source.**
  `focusRingTokenGuard.css.test.ts` carries two guards: one requiring every `outline` declaration under
  `frontend/src` to be `var(--app-focus-ring)`, `none`, or a pinned exception; and a second — "border/box-shadow
  focus-indicator guard (HEL-1050)", line ~600 — requiring every group that declares `outline: none` to carry a
  conforming ring-token indicator (`outline`/`outline-color`/`border-color`/`box-shadow`) in a `:focus-visible`
  rule of the same group, or a `BORDER_INDICATOR_PINS` entry. `theme.css:449` supplies the global
  `:focus-visible { outline: var(--app-focus-ring) }`. An earlier draft of this premise claimed the
  border/box-shadow channel was unguarded; that was wrong.

### Genuinely open

* **AC2 is unverified, but the gap is narrower than it first appears.** Every existing check is a SOURCE
  PARSE. What none of them establishes: (1) that a declared indicator actually *paints* — a conforming,
  token-referencing `box-shadow` that is clipped by an ancestor or covered by a sibling passes every guard and
  shows the user nothing; (2) that it clears 3:1 against the backdrop actually COMPOSITED at paint time, as
  opposed to the surfaces declared in `theme.css` that the token's derivation was computed against; (3)
  anything about an element that conveys focus by a border swap *without* declaring `outline: none`, which is
  outside the HEL-1050 guard's trigger. Meanwhile `e2e/support/stateContrast.mjs`'s `classifyState` returns
  `"advisory"` — explicitly deferred — for any state conveyed only by outline/border/box-shadow, i.e. for every
  correct focus ring in this app. **Expect few or no finds. A null result is a legitimate outcome to report,
  not a reason to manufacture one.**
* **AC3 is unverified.** No test drives the four named flows by keyboard.
* **AC4's restore half is unwritten** (above).
* **Two surfaces are genuinely outside the shared `Modal`**: `MobileNavSheet.tsx` (a portalled
  `role="dialog"` div, hand-rolled — and on inspection it already implements trap, initial focus, restore and
  OverlayProvider-delegated Escape; verify behaviour, do not assume from the code's presence) and `Select.tsx`
  (a listbox popover, to which the dialog trap contract does not apply).
* **`Modal`'s restore heuristic has a real limitation**: capturing `document.activeElement` at open loses the
  trigger when the trigger is a menu item unmounted in the same commit. Currently patched at exactly one call
  site by `shareDialogContext.tsx`'s `restoreFocusSelector` + `setTimeout(...,0)`. One patched call site is not
  a fix; whether to generalise it is an evidence question, not a foregone conclusion.

### `AddSourceModal.css:165` is NOT a defect — do not "fix" it

An earlier round of my own probing called this the ticket's one concrete defect (bare `:focus`, raw
`--app-accent` border, no halo). **That was wrong.** DESIGN.md §8 documents bare `:focus` as legitimate for a
persistent, modality-independent indicator on a text input and names this exact selector as *the example of the
shape*. It is orphaned CSS with zero markup references (HEL-1050 D9) and is already pinned in
`focusRingTokenGuard.css.test.ts` with `owner: "HEL-1052"`. Changing it would contradict a documented ruling
and duplicate another ticket.

**Therefore HEL-520 begins with zero known concrete AC2 defects.** AC2's deliverable is the measurement. Finding
nothing to fix is an acceptable, reportable outcome; manufacturing a fix to justify the ticket is not.

### Method warnings, paid for in this run

* **`grep '<Modal'` is not an enumeration of dialog surfaces.** My first-round list of "5 non-shared-Modal
  surfaces" was a grep artefact and **3 of the 5 were wrong** — `QuickLauncherOverlay` renders `<Modal>`,
  `DashboardShareDialog` (behind `shareDialogContext`) renders `<Modal>`, and `App.tsx` renders no dialog at
  all. Enumerate by opening surfaces in the running app.
* **`grep 'overflow: hidden'` produces only false leads for ring clipping.** Every hit in the stylesheets
  carrying focus rings is text-ellipsis on a label. Clipping is rendered geometry; measure it.
* **Reading a CSS rule does not establish that a site is conforming or non-conforming.** Ten of the eleven
  suppression sites are conforming *in shape*; the eleventh looks non-conforming and is a documented exception.
  Shape is not evidence in either direction.

## Binding constraints for this change

1. **jsdom is structurally blind to AC2 and AC3.** `toHaveFocus()` and visibility assertions in Jest pass on
   markup no user can reach (MISTAKES.md). AC2/AC3 evidence MUST be rendered measurement — Playwright, computed
   style, real Tab keypresses. Jest/RTL is for AC4's trap/restore unit contract, and only that.
2. **Reuse, do not rebuild.** `e2e/support/stateContrast.mjs` already resolves an element's real painted
   backdrop by ancestor-walking and compositing (HEL-866); `stateContrastProbe.ts` supplies the population
   selector. The repo also has ~10 `*.css.test.ts` guards under `frontend/src/theme/`. Join the existing
   mechanism (precedent: HEL-444's design gate refuted a from-scratch guard on exactly this ground).
3. **A focus indicator can be present-but-invisible**: suppressed with no replacement, painted behind a
   sibling, at imperceptible contrast, or clipped by `overflow: hidden`. No DOM assertion sees any of these.
4. **Enumerate modal surfaces by OPENING them**, not by grepping.
5. **Every new guard must be proven RED against the pre-fix tree**, with the transcript recorded. An assertion
   whose precondition guarantees it is not evidence (MISTAKES.md, HEL-1060). Note that `theme.css:449`'s global
   rule makes any computed-style presence check vacuous by construction.
6. **DESIGN.md §8 is the binding conformance test** and must be read in full before any site is called
   conforming or non-conforming. It contains a genuine carve-out for bare `:focus` (persistent,
   modality-independent indicators) and the guard carries owned pins; a site matching either is not a defect.
7. **`INTERACTIVE_SELECTOR` excludes `input`/`textarea`/`select`** — most of the sites here are inputs. A
   separate `FOCUSABLE_SELECTOR` is required; widening the existing constant in place is forbidden.
8. **Measure both themes.**
9. **Playwright's `.focus()` does not match `:focus-visible`** — use CDP `CSS.forcePseudoState` or a real Tab
   sequence. This previously caused 100% false failures across the whole focus-state population.
