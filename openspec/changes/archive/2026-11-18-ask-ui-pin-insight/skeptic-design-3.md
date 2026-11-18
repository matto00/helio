## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD `ecefad62a191e68d32fdf333acb695f296671f1e`. The planning artifacts are untracked in the change dir. I
checked every claim below against the live tree, not against the round-2 summary.

### What I verified (with evidence)

**Round-2 CR1: the BottomSheet `size` passthrough (resolved)**

- `BottomSheet.tsx` today hard-codes `size="full"` on `Modal` and has no `size` prop. D3 and task 3.0 add an optional
  prop that defaults to `"full"`. The only existing caller is `features/pipelines/ui/mobile/MobileStepSheet.tsx:61`,
  and the default leaves it unchanged.
- `Modal.tsx:10` declares `ModalSize = "sm" | "md" | "lg" | "xl" | "full"`, and `Modal.tsx:232` emits
  `ui-modal--${size}`. `.ui-modal--md` is `width: min(540px, calc(100vw - 32px))` (`Modal.css:75-77`), so the 540 px
  figure is correct.
- **The specificity claim holds.** Inside `@media (max-width: 768px)`, `BottomSheet.css:7` is `.ui-modal.bottom-sheet`
  (specificity 0,2,0). It sets `width: 100%` and `max-width: 100%`. Every size class is a single class (0,1,0):
  `.ui-modal--sm/md/lg/xl/full`. So at or below 768 px the sheet rule wins whatever the source order, with no
  `!important`. `BottomSheet.css:6` already records that intent. Nothing else in the tree targets `.ui-modal--md` or
  `.ui-modal--full` with a higher-specificity width: grep finds only a comment in `PanelDetailModal.mobile.css:8`.
  The only `max-width: 768px` block in `Modal.css` (`:272`) touches `.ui-modal-btn` hit areas, not the dialog width.
- DESIGN.md §10 "Bottom sheet" is at `DESIGN.md:1293`, and its signature line omits `size`. Task 3.0 amends it. The
  proposal Impact now lists `shared/motion/BottomSheet.tsx` and `DESIGN.md (§9, §10)`. D3 also forbids
  feature-CSS overrides of `.ui-modal--*`.

**Round-2 CR2: 429 and upsell copy (resolved)**

- D5's 429 row names the shared assistant limit. It explains why, by citing `checkConverseCap`. It never shows
  `limit`, and it requires a test that no digit of `limit` appears. Task 2.6 carries the same test.
- The free-tier upsell has its own exact sentence: "Asking about your data is on the beta plan." plus "Request Beta
  access". It has its own element and classes (`AskUpsell`, `.ask-upsell`, `.ask-upsell__link`) and is decoupled from
  `output-editor-sheet__*`. The `/settings#beta-access` target exists: `SettingsPage.tsx:112` has
  `<section id="beta-access">`, with hash scroll at `:44`.

**Round-2 non-blocking notes (folded in)**

- Icon fallback: D3 and task 3.3 make `CircleHelp` the fallback if the glyphs read as one.
- CommandBar: D3 says "inside the existing dashboard kebab (`dashboardActionItems`)", with no top-level control. That
  matches `CommandBar.tsx:74` and `:247`.
- Proposal Impact now lists `CLAUDE.md`, `BottomSheet.tsx` and `CommandBar.tsx`.
- The 429 gap is now recorded in `red-evidence.md` and the PR, not in design.md.

**Re-checked for regressions**

- The focus-restore selector precedent is still in place: `DashboardMetaRow.tsx:31` and `:92`. D6 has each opener
  pass its own selector. That matters because `KEBAB_TRIGGER_SELECTOR` is scoped to `.dashboard-meta-row` and so does
  not match the CommandBar kebab.
- `App.tsx:10` imports `RefinementChatDrawer` and reads `selectedDashboardId` at `:72`, so the mount point in D3 and
  task 3.1 exists.
- The proposal, design, tasks and both spec deltas agree on: the size, the openers, the pin rule, the tier and error
  states, the seam cases (200 with pin, 200 with null pin, both 422s and the 403, with 429 conditional), and C1. I
  found no TBDs or placeholders, and every ticket AC and driver ruling maps to a task (4.1, 4.2, 2.5, 1.1-1.4, 3.x).

### Verdict: CONFIRM

### Non-blocking notes

1. **Make the "phone presentation is unaffected" test real (task 3.0 / D3).** Jest maps `*.css` to
   `src/test/styleMock.js` (`frontend/jest.config.cjs:11`), so a jsdom render of `<BottomSheet size="md">` cannot
   observe the phone width. A test that only asserts the class list would pass vacuously. The repo has a precedent for
   CSS-text guards (`shared/ui/Modal.css.test.ts`, `IconButton.css.test.ts`). Use one:
   - Assert that the `max-width: 768px` block of `BottomSheet.css` keeps `.ui-modal.bottom-sheet` with
     `width: 100%` and `max-width: 100%`.
   - Assert that every `.ui-modal--*` width rule in `Modal.css` stays a single class.
   - Mutation-check it, per R6.
   - Better still, have the phone run in D8 assert that the drawer's dialog width equals the viewport width.
2. **Name the shared budget the same way on both surfaces.** The assistant composer says "Daily chat limit
   reached ... resets at the start of the next UTC day." (`features/assistant/ui/MessageComposer.tsx:15`). D5 says
   "today's assistant limit". It is the same budget, under two names. Consider "You've reached today's chat limit",
   or reuse the composer's wording, so a user who sees both messages recognises them as one budget.
3. `ModalSize` is a non-exported local type (`Modal.tsx:10`). `BottomSheet` must either export it or restate the
   union. Exporting it is cleaner.
4. Editorial: D7's 429 bullet repeats the sentence "The gap goes in `red-evidence.md` and the PR, not in this file."
   twice.
