## Evaluation Report — Cycle 4 (evaluation-3.md)

Resumed after a human-directed scope amendment (post-final-gate escalation). Planning artifacts
were NOT stable since my last PASS (`evaluation-2.md`) — the amendment rewrote ticket.md's ACs,
proposal.md's What Changes, design.md's Goals/Non-Goals (adding D5-D8), tasks.md (task groups
6-8), and both spec deltas — so, per the orchestrator's explicit instruction, I re-read all of
them fresh this cycle rather than treating them as stable. Diff reviewed: `git diff 902e7e08
3d907908` (cycle 3 → cycle 4 commit `3d907908`).

### Phase 1: Spec Review — PASS

- ticket.md's amended ACs ("Header is drastically more compact"... single action-menu button;
  "Footer keeps only Dry run/Run pipeline always visible"...) match the implementation exactly —
  confirmed live (see Phase 3).
- proposal.md's "Scope amendment" section, design.md's D5-D8, and tasks.md's task groups 6-8 are
  mutually consistent and match the diff: one `ActionsMenu` replaces the header's three edit
  buttons (D5), field groups compact to single-line (D6), footer pins Dry run/Run pipeline and
  moves Run history/Preview/Share into a second `ActionsMenu` (D7), and the four now-dead CSS
  selectors are removed with the guard test correctly narrowed (D8).
- All 24 tasks (1.1-8.6) marked done; spot-checked the amendment's task groups (6-8) line-by-line
  against the diff — each corresponds to a real, verifiable code change, not a rubber-stamp.
- Both spec deltas (`pipeline-editor-page`, `pipeline-schedule-config-ui`) were updated during
  this cycle's design-gate phase (skeptic-design-3/4.md) and verified accurate against the final
  implementation — the "Header actions consolidate into one menu" and "Footer pins primary
  actions..." requirements' scenarios match what actually renders.
- The amendment itself is properly provenanced: design.md's Planner Notes correctly labels D5-D7
  "Human-directed, not self-approved," citing the actual `escalation.answered` timestamp —
  consistent with `workflow-state.md`'s `AMENDMENT:` field. No architecture decision was
  self-approved that required human sign-off.
- No scope creep beyond the amendment's own declared bounds. The one item outside the assigned
  task list — the `ActionsMenu`/`usePortalPopover` `align` prop fix — is a self-discovered,
  in-cycle defect (not a new feature), disclosed prominently rather than silently absorbed, and
  is itself required for the amendment's own footer overflow menu to function at all (see Phase 3
  item 2 below) — this is exactly the "fix the actual bug, flag non-trivial ones separately"
  discipline CONTRIBUTING.md's AI-collaborator section asks for, correctly applied (it's trivial
  and directly blocking, not deferred as a spinoff, and the writeup makes that judgment call
  explicit for the orchestrator/skeptic to review).

### Phase 2: Code Review — PASS

Fresh gates re-run in `WORKTREE_PATH`:

- `npm run lint` → 0 warnings/errors.
- `npm run format:check` → clean.
- `npm test` (full suite) → **210 suites / 2265 tests passed** (matches the commit's claimed
  count exactly).
- `npx jest --testPathPatterns="PanelCard.test|DashboardList.test|SidebarItemList.test|ActionsMenu.test|ActionsMenu.css.test"`
  → **5 suites / 47 tests passed** — run explicitly and directly per the orchestrator's request,
  not accepted from the commit message.
- `npm --prefix frontend run build` → succeeds.

**Item 2 (shared `ActionsMenu`/`usePortalPopover` change) — independently verified non-regressive**,
not accepted on the commit's claim:
- Diff-reviewed `ActionsMenu.tsx`/`usePortalPopover.ts`: `align` defaults to `"below"`; the
  `"below"` branch's `handleOpen` call is byte-identical to the pre-amendment code; the new
  `bottom: panelPos.bottom` style property is `undefined` in that branch (React omits `undefined`
  style values), so the rendered `style` attribute for every existing consumer is unchanged.
  `PortalPopoverPos.top` widened `number` → `number | undefined` — grepped all four *other* direct
  `usePortalPopover` consumers (`UserMenu.tsx`, `AllowedDimensionsPicker.tsx`,
  `DashboardAppearanceEditor.tsx`, `Select.tsx`, beyond the three `ActionsMenu` consumers the
  orchestrator named) and confirmed each sets `top` unconditionally in its own `computePos`, so
  the type widening doesn't change runtime behavior for any of them either.
- Confirmed none of `PanelCard.tsx`/`DashboardList.tsx`/`SidebarItemList.tsx` pass the new `align`
  prop (grepped their JSX call sites directly) — they get the unchanged default.
- Ran their three test suites explicitly (above) — 47/47 pass.
- Live spot-check: opened `DashboardList`'s existing kebab menu — rendered `style="position:
  fixed; top: 8px; right: 430px; left: auto;"` — no `bottom` property present at all, confirming
  the default path never emits it.

**Item 3 (D8 cleanup) — verified genuinely dead, not just unused**:
- `git diff` on `PipelineDetailPage.css` confirms `.pipeline-detail-page__edit-btn`'s base rule,
  `.pipeline-detail-page__history-btn`/`__preview-btn`'s combined base rule, and
  `.pipeline-detail-page__share-btn`'s base + hover rules are fully removed; the `@media
  (max-width: 768px)` combined-selector list now reads `__dry-run-btn, __run-btn, __save-btn,
  __cancel-btn, __cancel-confirm-btn` only.
- `grep -rn` for all four retired class names across every `.tsx`/`.ts` file: **zero matches** —
  genuinely dead, not residual unused CSS with lingering markup.
- `PipelineDetailPage.css.test.ts`'s `it.each` list narrowed to `[".pipeline-detail-page__dry-run-btn"]`
  only — read `ActionsMenu.css.test.ts` directly and confirmed it independently asserts
  `min-height: 44px`/`min-width: 44px` on `.actions-menu__trigger`/`.actions-menu__item` inside its
  own `@media (max-width: 768px)` block; read `ActionsMenu.tsx`'s JSX and confirmed every instance
  (both the header's and footer's new triggers, plus the three pre-existing consumers) renders
  those exact class names unconditionally — so the claimed "independent coverage" is real, not
  asserted.

Test-diff review (`PipelineDetailHeader.test.tsx`, `PipelineDetailPage.test.tsx`,
`ActionsMenu.test.tsx`): every `getByRole("button", ...)` → `getByRole("menuitem", ...)` migration
opens the owning menu first via a small named helper (`openActionsMenu`/`openMoreActionsMenu`/
`openPipelineActionsMenu`), preserves the exact same accessible names, and adds new coverage for
the amended spec's "one trigger exposes every action"/"menu narrows to available actions"
scenarios and the footer's pinned-vs-overflow split (including confirming "Preview" from the
overflow menu genuinely opens the preview dialog, not just that the menu item renders). This is
migrated coverage, not weakened coverage — no assertions were dropped, only relocated to match
the real new DOM structure.

No dead code, no untyped escape hatches, no magic values. `runHistoryCount` prop removal traced
end-to-end (dropped from `PipelineDetailFooter`'s props, its one call site in
`PipelineDetailPage.tsx`, and confirmed zero remaining references anywhere) — clean, not a stray
unused variable (lint's 0-warnings run confirms this).

### Phase 3: UI Review — PASS

Dev servers reused for initial checks, then **deliberately restarted mid-cycle** (see note below).
Independently re-verified all three items the orchestrator flagged, plus standard breakpoint/theme
coverage, against the same fixture pipeline used throughout this ticket's review history.

**Item 1 (primary target defect) — CONFIRMED FIXED**, verified with an **enabled schedule with a
computed next run** (not the disabled fixture every earlier round used): toggled
"Profit (migrated)"'s schedule on via the header's own Toggle control, then measured
`.pipeline-detail-header__schedule-next-run` via `getBoundingClientRect()`/`scrollWidth`:
- 1440px: `width: 164.56px` vs `scrollWidth: 165px` — full text "next run Aug 17, 2026, 7:16 PM"
  renders, no ellipsis. Re-confirmed after a full dev-server+browser restart at a later
  timestamp: `width: 168.58px` vs `scrollWidth: 169px` (the date advanced a few minutes between
  runs) — same result, no truncation.
- 1100px / 768px / 430px: identical — full text, no truncation at any canonical breakpoint.
- Screenshot-confirmed visually at 1440px and 430px, both light and dark themes.
- Restored the fixture's schedule to disabled afterward (matching every prior review round's
  discipline, since the dev DB is shared across parallel worktrees) — confirmed via a fresh page
  reload that `aria-label="Enable schedule"`/`checked: false` again.

**Item 2 (self-discovered `ActionsMenu` viewport-collision fix) — CONFIRMED WORKING**: opened the
footer's "More actions" trigger at 1440px — panel `top: 751, bottom: 854` inside a 900px-tall
viewport (fully visible, not clipped), listing "Run history"/"Preview"/"Share" in the documented
order. Screenshot-confirmed as a correctly-rendered "dropup" directly above the trigger. Clicking
"Edit schedule" from the header's "Pipeline actions" menu correctly opened the same
`PipelineScheduleDialog` as before the amendment (no behavior regression from the button→menuitem
role change).

**Item 3 (D8 cleanup)**: fully verified in Phase 2 above (mechanical/code-level, not a live-render
concern).

**Environmental finding — investigated and ruled non-blocking, not silently dismissed**: mid-review,
`browser_console_messages({all: true})` surfaced accumulated `ReferenceError: FontAwesomeIcon is
not defined` / `ReferenceError: overflowItems is not defined` crashes from `PipelineDetailFooter`.
Investigated per the systematic-debugging discipline rather than either ignoring it or reflexively
failing the cycle over it:
1. Read the actual source file directly — internally consistent (`overflowItems` defined and used
   correctly, zero `FontAwesomeIcon` references remain).
2. `curl`'d the module straight from the Vite dev server — clean, matching the source on disk.
3. Checked the frontend vite process: **running continuously for 2h44m, spanning all four of this
   ticket's git commits without restart** (`ps` showed `STARTED Mon Aug 17 18:19:02`, i.e. since
   Cycle 1).
4. Confirmed no stale service worker was involved (`navigator.serviceWorker.getRegistrations()` →
   empty).
5. Killed the stale process, restarted via `start-servers.sh` (genuine cold start), then repeated
   the full interaction sequence (navigate, resize, toggle schedule, open both menus, toggle
   theme) — **zero errors**, every screenshot rendered correctly.

Conclusion: this was a transient Vite HMR artifact from one dev-server process absorbing four
separate out-of-band `git commit`s' worth of file changes underneath it without ever restarting —
not a defect in the code as committed. Combined with the fresh Jest suite (real module evaluation,
no HMR) and fresh production build (full recompile from disk) both passing cleanly, I'm confident
this doesn't reflect the shipped code. Flagging for the orchestrator's awareness: a dev server
that survives many cycles' worth of git-level file swaps is a known source of exactly this kind of
false alarm — worth a process note (e.g. restart between cycles, or before a final verdict) even
though it isn't a code-quality issue in this diff.

**Breakpoint/theme sweep**: 1440/1100/768/430px all render correctly in both themes (dark
confirmed via screenshot after the theme toggle; light was the default). No console errors in any
tested state after the clean restart. All four `ActionsMenu`-related tap targets (header trigger,
footer trigger — both measured, plus Dry run/Run pipeline which reuse the pre-existing,
already-covered `__dry-run-btn`/`__run-btn` treatment) measure exactly 44×44px at 430px.

### Overall: PASS

### Non-blocking Suggestions

- (Process note, not a code issue) Consider restarting long-lived dev servers between review
  cycles, or immediately before a final verdict — see the "Environmental finding" above. A dev
  server that has absorbed many `git commit`s' worth of underlying file changes without a restart
  can produce spurious client-side `ReferenceError`s from stale HMR state that don't reflect the
  actual committed code, and chasing these down (as this cycle required) costs real review time.
- Carried over from evaluation-2.md, still non-blocking: the ~1101–1150px tight-clipping window
  this ticket's earlier cycles found for the schedule field group is superseded by this cycle's
  compaction (D6) — worth re-confirming there's no reintroduced version of it, but not observed in
  any of this cycle's measurements at the four canonical breakpoints.
