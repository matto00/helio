## Context

`FormPanelView.tsx` (compact branch, ~line 375-404) renders `FormFieldControl` (counter row, plus a caption for a
non-owner) followed by two always-mounted paragraphs, `<p role="alert" class="form-panel-view__alert">` and
`<p role="status" class="form-panel-view__status">`, inside `.form-panel-view__compact-counter`
(`CounterControl.css`): `display: flex; flex-direction: column; justify-content: center; gap: var(--space-4);
height: 100%; padding: var(--space-4)`. Base region styling (`margin: 0`, text colour under `:not(:empty)`) lives in
`FormPanel.css`. An empty `<p>` is 0 px tall, but as an in-flow flex item it still adds one `gap` each (2 x 16 px).
The state is `""` when empty (`useState("")`), and React renders no text node for `""`, so `:empty` matches the
idle regions (the existing `:not(:empty)` colour rules already rely on this; the executor MUST confirm it in the
real browser, not only jsdom). In the phone stack the card is intrinsic-height since HEL-1791
(`MobilePanelStack.css`, `.mobile-panel-stack__item--form`), so the phantom slots show as blank space. See
proposal.md for motivation.

## Goals / Non-Goals

**Goals:** no gap slot for an empty region in the compact layout; regions stay mounted and in the a11y tree; a
message renders in flow exactly as today; every other stack card keeps its height.

**Non-Goals:** the multi-field form layout (`.form-panel-view__fields`); message wording/timing; `FormPanelView.tsx`
markup changes (none are expected; the live regions' element, order and roles stay unchanged).

## Decisions

### D1: Take an empty region out of flex flow with `position: absolute` (CSS only)

Add, in `CounterControl.css`, a rule scoped to the compact layout:
`.form-panel-view__compact-counter > :is(.form-panel-view__alert, .form-panel-view__status):empty { position:
absolute; }` and give `.form-panel-view__compact-counter` `position: relative` so the empty box is contained by the
card. Absolutely-positioned children of a flex container are not flex items and do not take part in `gap`. The
element keeps its box (0 x 0), its role and its live-region semantics; when text arrives `:empty` stops matching and
it returns to flow with its usual gap.

Alternatives rejected:
- `display: none` / `visibility: hidden` / `hidden` while empty: removes the node from the accessibility tree, and a
  region that enters the tree at the same moment as its text is not reliably announced (the reason HEL-1087 D8/D9
  made them always-mounted). Forbidden by the ticket's "still announced" AC.
- Conditional mount: explicitly forbidden by the ticket.
- Negative `margin-top: calc(-1 * var(--space-4))` on an empty region: couples to the gap token; breaks silently
  when either changes.
- `display: contents`: Chromium has a history of dropping roles from `display: contents` elements in the a11y tree.
- Replacing `gap` with sibling margins: larger diff, touches every child of the layout.

### D2: Scope to the compact layout only, in every container (grid and stack)

The selector is scoped under `.form-panel-view__compact-counter`, so the multi-field form (a measured "other kind")
is untouched. It is not scoped to the phone stack: in the desktop grid the same phantom slots offset the
`justify-content: center` centring by 16 px; removing them there is the same correction. The executor records a
desktop-grid before/after screenshot of the compact card in the evidence to show the change there.

### D3: Tests

Expected after-state: only padding remains below the last content (compact layout padding 16 + `.panel-content`
padding-bottom 12 + phone card padding 14, about 42 px at 390 px), matching the ~41 px above the field label. Today
it is ~74 px (the extra 32 px are the two phantom gap slots). "Blank space gone" means the phantom band is gone; the
padding stays.

- Extend `e2e/hel1791-compact-counter-stack-height.spec.ts` (no new heavy spec). In the owner/editor x light/dark
  loop, at each width, assert the gap between the bottom of the last visible content (caption for the editor, the
  counter row for the owner) and the bottom of the `.form-panel-view__compact-counter` BORDER box
  (`getBoundingClientRect`) is at most that element's computed `padding-bottom` + 1 px, read with
  `getComputedStyle` (no hardcoded padding value). Also assert both regions are attached and carry their roles.
  Must fail on the unmodified code (record + commit the red run as `.txt` before the CSS change).
- Message test: one new test, declared LAST in the file and run on the EXISTING counter panel on the existing
  dashboard (no new panel; `fullyParallel: false` in `playwright.config.ts` keeps file order, so the geometry and
  per-kind tests run first; the 7-card count and the per-kind JSON keys are unchanged). It checks that a status
  message (successful `+` step: "The row was added.") and an alert message (a step whose submit is rejected via
  `page.route` on the panel submit returning a 400 with a message) each render on the SAME element handle captured
  before the step, via `getByRole("status"|"alert")`, visibly inside the card, AND IN FLOW: while it has text the
  region's computed `position` is `static`, and its top is at or below the bottom of the last content element (counter
  row or caption) with no overlap.
- Per-kind heights: run the existing per-kind test with `HEL1791_LABEL=before` on the base and `HEL1791_LABEL=after`
  with the change; diff the two JSON files; every card other than the counter card must match within 0.5 px. That
  test only records, so commit the diff transcript as evidence.
- Mutations (task 3.2), with the expected red test for each:
  - M1: remove the new rule entirely -> the blank-space geometry assertion goes red (all roles/themes/widths).
  - M2: keep the rule but drop `:empty` (regions always absolute) -> the message test's in-flow assertion goes red
    (the message sits centred over the counter, `position: absolute`).
- Optional jest guard (`CounterControl.css` rule present, scoped, uses `:empty`, never `display: none` /
  `visibility`), in the style of `MobilePanelStack.css.test.ts`, labelled as a guard.
- Regression (D2 moves the compact card's content in the desktop grid by ~16 px of centring): run, in full, at most 2
  Playwright workers and never alongside another Playwright batch: `hel1088-compact-counter-chrome`,
  `hel1087-form-submit-path`, `hel1095-optimistic-pending-writing-panel-a11y`,
  `hel1169-network-vs-rejection-reconcile-a11y`, `hel1090-form-panel-assembled-a11y` (+ the hel1791 spec). A failure
  that also fails on the base (stash the change) is pre-existing and is recorded, not fixed here.

## Risks / Trade-offs

- [`:empty` fails if a whitespace text node is ever rendered] → the e2e red/green proves it on real DOM; any future
  whitespace regresses a test, not silently.
- [Absolute box escapes and causes overflow] → 0 x 0 and contained by `position: relative` on the layout.
- [Desktop compact card content shifts ~16 px] → intended (D2); captured in evidence.

## Planner Notes

- Self-approved: D2's grid-wide scope (same defect, same rule; no product choice). The multi-field form's identical
  12 px phantom gaps stay out of scope and may be offered as a follow-up at Delivery.
