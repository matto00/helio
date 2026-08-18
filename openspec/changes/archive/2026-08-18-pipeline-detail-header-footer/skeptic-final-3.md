## Skeptic Report — final gate (round 1 of the amendment's fresh budget, skeptic-final-3.md)

Cold review of commit `3d907908` ("HEL-719 Header action-menu consolidation + footer overflow
menu (scope amendment, cycle 4)"), which implements the human-directed scope amendment
(design.md D5-D8) raised after skeptic-final-2.md's pre-amendment REFUTE budget was exhausted.
Treated ticket.md, proposal.md, design.md, tasks.md, both spec deltas, files-modified.md's Cycle
4 section, and evaluation-3.md as claims to independently re-verify — not as fact.

### What I verified (with evidence)

**1. Primary target defect — `__schedule-next-run` truncation at 1440px (CONFIRMED FIXED)**
Live against the fixture `/pipelines/555f4bae-7c76-4566-84eb-036bc33b4485` (Playwright, dev
server on :6151/:9058). Toggled the schedule on via the header's own Toggle (confirmed
`aria-label` flipped "Enable schedule" → "Disable schedule", `checked: true`), producing a real
computed `nextRunAt`. Measured `.pipeline-detail-header__schedule-next-run` directly:
- 1440px: `getBoundingClientRect().width = 169.19px`, `scrollWidth = 169px` → no truncation, full
  text "next run Aug 17, 2026, 9:05 PM" renders. Screenshot-confirmed both dark and light theme.
- 1100px (stacked layout): field group gets a full row; screenshot confirms "next run Aug 17,
  2026, 9:05 PM" fully legible with ample margin.
- 768px / 430px: identical — full text, no ellipsis, in both a live DOM measurement and a
  full-page screenshot at each width.
- At 430px also confirmed the header's/footer's `ActionsMenu` triggers and `Dry
  run`/`Run pipeline` all measure exactly 44×44px (`getBoundingClientRect()`), matching the
  HEL-687 tap-target floor.
- Restored the fixture's schedule to disabled afterward; confirmed via a fresh page reload
  (`aria-label="Enable schedule"`, `checked: false`) before finishing.

**2. Self-discovered `ActionsMenu`/`usePortalPopover` `align` fix (CONFIRMED WORKING, independently
re-derived, not accepted on the commit's claim)**
- Diff-read `ActionsMenu.tsx`/`usePortalPopover.ts`: `align` defaults to `"below"`; the `"below"`
  branch is untouched from the pre-amendment code; `bottom` is `undefined` on that path, so
  React omits it from the rendered `style` — the three pre-existing consumers get a byte-identical
  DOM output.
- Grepped every `ActionsMenu` call site: `PanelCard.tsx`, `DashboardList.tsx`,
  `SidebarItemList.tsx` do not pass `align` (confirmed via `grep -n "ActionsMenu"` across
  `frontend/src`). Ran their test suites plus the shared component's:
  `npx jest --testPathPatterns="(ActionsMenu|PanelCard|DashboardList|SidebarItemList|PipelineDetailHeader|PipelineDetailPage|PipelineDetailFooter|usePortalPopover)"` → **8 suites / 179 tests
  passed**.
- Grepped the four *other* direct `usePortalPopover` consumers beyond the three `ActionsMenu`
  ones — `Select.tsx`, `UserMenu.tsx`, `DashboardAppearanceEditor.tsx`,
  `AllowedDimensionsPicker.tsx` — and confirmed each sets `top` unconditionally in its own
  `computePos` (`handleOpen((rect) => ({ top: rect.bottom + …, … }))`), so the `top?: number`
  type-widening is inert for all of them at runtime.
- Live-verified the footer's "More actions" trigger genuinely opens usable, not just
  claimed: at 1440×900, opened DOM inspection showed `role="menu"` panel `top: 751, bottom: 854`
  — fully inside the 900px-tall viewport (screenshot-confirmed as a correct "dropup", items
  "Run history"/"Preview"/"Share" in the documented order). Re-confirmed in light theme too
  (`top`/`bottom` both inside viewport, screenshot-confirmed).
- Exercised the menu items for real behavior, not just role/DOM presence: "Preview" opened the
  actual "Pipeline output preview" modal with real row data; "Run history" opened the actual
  "Run history (13)" modal (the run count is still fully recoverable there — see non-blocking
  note below); the header's "Edit schedule" menu item opened the real `PipelineScheduleDialog`
  pre-filled with the current schedule.
- Escape-to-close still works correctly on the new `align="above"` panel (verified: `[role="menu"]`
  absent from the DOM immediately after `Escape`).

**3. D8 CSS/test cleanup (CONFIRMED genuinely dead, not just unused)**
- `grep -n "edit-btn\|history-btn\|preview-btn\|share-btn" PipelineDetailPage.css` → only match
  left is the unrelated `__step-card-preview-btn` selector; the four retired selectors' base
  rules and their `@media (max-width: 768px)` combined-selector entries are gone (read the file
  directly, not just the diff).
- `grep -rn` for all four retired class name strings across every `.tsx`/`.ts` file → zero
  matches — genuinely dead, no residual markup.
- `PipelineDetailPage.css.test.ts`'s `it.each` list is narrowed to
  `[".pipeline-detail-page__dry-run-btn"]` only (read directly, matches D8/task 8.4).
- `ActionsMenu.css.test.ts` (pre-existing, unmodified by this commit) independently asserts
  `min-height`/`min-width: 44px` on `.actions-menu__trigger`/`.actions-menu__item` inside its own
  `@media (max-width: 768px)` block — read directly, confirms the "independent coverage" claim is
  real.

**4. Fresh gates, re-run myself in `WORKTREE_PATH`**
- `npm test` (full suite): **210 suites / 2265 tests passed** — matches the commit's claimed
  count exactly.
- `npm run lint` → 0 warnings/errors.
- `npm run format:check` → clean.
- Targeted suite (item 2 above) → 179/179 passed.

**5. Acceptance criteria traced to evidence**
- "One header region, one footer region; no more than one info bar above the step list" —
  screenshot-confirmed at 1440/1100/768/430px, single bordered header container, single bordered
  footer container.
- "All existing actions... remain reachable with no loss of function" — Edit source/type/schedule,
  Run history, Preview, Share, Dry run, Run pipeline all live-exercised and confirmed functional
  (see items above); test suite covers ownership gating for Edit source/type/Share.
- "Works cleanly at 430px" — screenshot + 44px tap-target measurements above.
- "Header is drastically more compact... single action-menu button" — confirmed: one
  `aria-label="Pipeline actions"` trigger replaces the three edit buttons; field groups render as
  single compact lines (screenshot).
- "Footer keeps only Dry run/Run pipeline always visible... at 430px" — confirmed: `__footer-right`
  renders exactly `Dry run`, `Run pipeline`, and one "More actions" trigger at every tested
  viewport including 430px (screenshot).

**6. Spec deltas** — read both `specs/pipeline-editor-page/spec.md` and
`specs/pipeline-schedule-config-ui/spec.md` in full; internally consistent with each other and
with the live implementation (menu-based header actions, footer's pinned-vs-overflow split,
last-run metadata scenarios) — no contradictions found.

**7. Environmental finding — independently re-investigated, not trusted from evaluation-3.md**
`browser_console_messages({all: true})` initially surfaced accumulated
`ReferenceError: FontAwesomeIcon is not defined` / `ReferenceError: overflowItems is not defined`
from `PipelineDetailFooter` — the same category evaluation-3.md flagged and diagnosed as a stale
Vite HMR artifact. Rather than accept that diagnosis, I re-derived it independently: read
`PipelineDetailFooter.tsx` directly (`overflowItems` defined at line 104, used correctly at line
285; zero `FontAwesomeIcon` references anywhere in the file); then did a **fresh navigation**
followed by exercising the exact interaction sequence (open both `ActionsMenu`s) and checked
`browser_console_messages({level: "error"})` (default, since-last-navigation scope, not `all`) —
**zero errors** on every check. Conclusion: the accumulated-history errors were stale entries
from the shared long-lived Playwright/dev-server session (matches the documented parallel-worktree
Playwright hazard), not a defect in the code as currently served — independently reproduced, not
just accepted on the evaluator's word.

### Verdict: CONFIRM

### Non-blocking notes

1. **Literal px spacing values in `PipelineDetailHeader.css`** (`gap: 8px`, `padding: 8px 14px`,
   `padding: 0 14px`) don't use DESIGN.md's `--space-*` tokens (the "[mechanical]" rule: "All
   margin/padding/gap use a `--space-*` token"). This is carried-over debt from the original
   consolidation (D1), and all three prior review rounds (evaluation-1/2, skeptic-final-1/2)
   treated the pre-amendment version of this same debt as non-blocking. Worth flagging precisely
   because this cycle *did* touch these exact declarations (`gap: 12px`→`8px`,
   `padding: 10px 20px`→`8px 14px`) rather than leaving them byte-identical, so the "unchanged
   since round 1" framing no longer fully applies — a real opportunity to convert to
   `var(--space-2)` (8px matches exactly) and a value near `var(--space-3)`/`var(--space-4)`
   (12/16px) for the 14px value was available and not taken. Not blocking given the ticket's own
   established precedent and the purely cosmetic nature of the gap.
2. **`Run history`'s visible run-count** (previously "Run history (N)" on the always-visible
   button) is dropped from the collapsed menu item's plain-string label. Verified this is not an
   actual information loss: opening "Run history" from the overflow menu shows the modal's own
   title as "Run history (13)" — the count is still present, one click away, which is a
   reasonable trade-off inherent to any overflow-menu consolidation (matches
   `files-modified.md`'s own disclosure that this was a deliberate, traced removal, not a stray
   regression).
3. Fixture pipeline `/pipelines/555f4bae-7c76-4566-84eb-036bc33b4485`'s schedule was restored to
   its original disabled state at the end of this review (confirmed via a fresh page reload),
   matching the discipline every prior review round on this ticket has followed for the shared
   dev DB.
