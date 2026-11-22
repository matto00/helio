## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 79288722ac0e0c73bb0a6dc2984588aead783767 (no change commits yet; planning artifacts only).

### What I verified (with evidence)

- **Markup claim holds.** `FormPanelView.tsx:373-404`: the compact branch renders `FormFieldControl` then
  `<p role="alert" className="form-panel-view__alert">{alertText}</p>` and
  `<p role="status" className="form-panel-view__status">{statusText}</p>` inside `.form-panel-view__compact-counter`.
  Both are always mounted. State is `useState("")` (lines 66-67) and is reset to `""` at 184/185 and 303/304.
- **Layout claim holds.** `CounterControl.css`: `.form-panel-view__compact-counter` is
  `display:flex; flex-direction:column; align-items:center; justify-content:center; gap:var(--space-4); height:100%;
  padding:var(--space-4)`. No `position` is set today, so adding `position: relative` does not conflict.
- **`FormPanel.css:22-34`** has `margin:0` on both regions and colour rules under `:not(:empty)`, as the design says.
- **The 75 px adds up.** Two 16 px gap slots (32), compact padding 16, `.panel-content` padding-bottom 12
  (`PanelContent.css:6`) and the phone card padding `calc(var(--space-3) + 2px)` = 14 (`MobilePanelStack.css:182`)
  make 74. That matches the HEL-1791 skeptic note (`archive/2026-11-20-fix-phone-compact-counter-height/skeptic-final-1.md:58-64`,
  "caption ends about 75 px above the card bottom ... Widgets label starts about 41 px below the title"). After
  the fix about 42 px of padding remains below the caption, which matches the ~41 px above the label. The design
  reads "blank space gone" as "the phantom band gone, the padding stays". I think that reading is correct.
- **The mechanism is sound.** An absolutely positioned child of a flex container is not a flex item, so it takes no
  `gap` slot. It stays in the DOM and in the accessibility tree, unlike `display:none`, `visibility:hidden` or a
  conditional mount, which the design correctly rejects. No other stylesheet targets the compact-counter children
  (grep for `compact-counter` across `frontend/src` and `e2e`: only `FormPanelView.tsx:376` and the hel1088 evidence path).
- **The e2e spec exists as described.** `e2e/hel1791-compact-counter-stack-height.spec.ts` (262 lines) has the owner/editor x
  light/dark loop over `WIDTHS = [390, 768, 1100]` and a per-kind test that only records the JSON and checks that 7
  cards were measured. `openStack` asserts `toHaveCount(7)` on `LIVE_STACK_ITEMS`.
  `playwright.config.ts:191` sets `fullyParallel: false`, so tests in one file run in order and "run it last" is meaningful.
- **The red-first plan works for the geometry test.** Today the space between the last content and the compact
  border-box bottom is 32 + 16 = 48 px, and the bound is padding-bottom + 1 = 17 px, so the test goes red. After the
  fix it is about 16 px, so it goes green.
- **Scope matches the ACs.** AC1 maps to the geometry test and task 2.1. AC2 maps to the message test (1.3). AC3 maps
  to the before/after heights (1.1, 3.1). No API or schema contract is affected. The spec delta covers all three ACs.

### Verdict: REFUTE

The fix design is sound. The test plan has one defect: a mutation the design says would be caught is not caught by
the test it relies on, so the claim would be false. Two smaller plan ambiguities would otherwise cause rework.

### Change Requests

1. **The "drop `:empty`" mutation survives the planned message test (design.md D3, mutation bullet; tasks 1.3 and 3.2).**
   If `:empty` is dropped, the regions are always `position:absolute`. A message-bearing `<p>` then sits at its static
   position. For an absolutely positioned child of a flex container, that is computed as if it were the only flex
   item, so with `justify-content:center; align-items:center` it lands centred over the counter. It is still inside
   the card, it is visible, and it carries its role. The planned message test checks only "renders visibly inside the
   card" plus the role, so it stays green, and the empty-state geometry test is also green. The mutation would
   survive, yet D3 asserts that it goes red. Add an in-flow assertion to the message test, for example: the message box's top is
   at or below the bottom of the last content element (counter row or caption) and does not overlap it, and/or
   `getComputedStyle(el).position === "static"` while it has text. State in tasks 3.2 which test is expected to go red
   for each mutation.
2. **Choose one way to isolate the message test (design.md D3, second bullet).** "Use a separate panel or run it
   last" leaves two options, and one of them breaks the existing spec. A separate panel on the SAME dashboard changes
   `openStack`'s `toHaveCount(7)` and the per-kind test's 7-key check. It also adds a key to the "after" heights JSON
   that the "before" JSON (task 1.1, recorded before the spec changes) lacks, which pollutes the 3.1 diff. Pick one
   option: run it last on the existing counter panel (valid, because `fullyParallel:false`), or use a separate
   dashboard. State it in the design.
3. **Add regression runs for the desktop-grid change (design.md D2, tasks 3.x).** D2 moves the compact card's
   content in the desktop grid as well (about 16 px of centring). Task 3.4 runs only lint, typecheck, format and
   jest. Add a task to run the existing compact-counter and form-message e2e spec files in full, at most 2 Playwright
   workers: `hel1088-compact-counter-chrome`, `hel1087-form-submit-path`,
   `hel1095-optimistic-pending-writing-panel-a11y`, `hel1169-network-vs-rejection-reconcile-a11y` and
   `hel1090-form-panel-assembled-a11y`. Every one of them drives the live regions or the compact layout this rule now changes.

### Non-blocking notes

- D3 says to measure to the bottom of the compact layout's "content box" and allow padding-bottom + 1. Measured to the
  content box, the expected gap is about 0, so the padding allowance only makes sense against the border box
  (`getBoundingClientRect`). Name the border box so the executor writes the tighter, intended check. Either reading
  is red today (32 or 48 px against 17).
- Write the expected after-state in the design ("about 42 px of card padding remains below the caption, matching the
  ~41 px above the label"). Then the final gate does not read the remaining padding as "blank space not gone".
- The heights recorder measures only the light theme. AC3 does not mention a theme, and this rule does not depend on
  the theme, so it is acceptable as is.
