## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and both spec deltas.
- Read the actual implementation rather than the narrative:
  - `frontend/src/shared/chrome/MobileNavSheet.tsx` (full file)
  - `frontend/src/app/MobileShell.tsx`, `frontend/src/app/App.tsx` (shell composition)
  - `frontend/src/features/dashboards/ui/DashboardList.css:236-249`
  - `frontend/src/app/App.css:519` (`@media (max-width: 768px)`) and `:606-609`
  - `e2e/hel1003-premise-probe3.spec.ts` (the probe that produced R5)
- Confirmed R2 independently: `git log -1 --format='%h %ad' affbec86e` -> `affbec86 2026-05-10`,
  and `DashboardList.css:244` does carry the `:focus-within` rule. R2 stands.
- Confirmed no migration is planned and main is at V102 (max of
  `backend/src/main/resources/db/migration/` = 102). Correct.
- Confirmed the plan's file list touches nothing owned by HEL-973
  (`PipelineStepRepository`, pipelines schema) or HEL-845 (Connectors/REST source).
- **R5's mechanism is refuted by source ground truth** (details below).

### Verdict: REFUTE

The plan is unusually rigorous in method — D0a/D0b, the both-arms guard, the
bidirectional trap requirement, and D2's no-fix-without-a-probe are all correct
instincts, and I want them preserved. But defect (b)'s mechanism (R5) is wrong,
and it is wrong in a way that makes D2, task 4.1, and the
`mobile-dashboard-sheet` spec delta point an executor at a non-cause — and, in
D2's case, at the exact leak D3 forbids.

**The refutation.** R5 asserts "at 430 the dashboard list renders inside
`MobileNavSheet`". It does not.

1. `MobileNavSheet.tsx` renders its own list from an `items` prop. Each
   `li.mobile-nav-sheet__item-row` contains exactly two controls: the
   `button.mobile-nav-sheet__item` selection button, and an optional
   `button.mobile-nav-sheet__item-secondary` from the `secondaryAction` prop —
   which `MobileShell.tsx` supplies as a single hardcoded `"Share"` for the
   dashboards section only. **There is no `ActionsMenu` anywhere in
   `MobileNavSheet`.** The observed cycle `Share -> New dashboard -> row button`
   is not a truncated cycle; it is the complete and correct set of the sheet's
   own tabbables.
2. `DashboardList` (which does render the kebab) lives in `Sidebar`, and
   `frontend/src/app/App.css:606-609`, inside `@media (max-width: 768px)`
   (block opens at `:519`), sets `.app-sidebar { display: none }`. At 430 the
   entire sidebar subtree — kebab included — is display-none'd.
3. Probe 3 marks `.dashboard-list__item-row .actions-menu__trigger` and then
   walks the tab order *inside the sheet*. That element is in a `display:none`
   ancestor, in a different subtree from the portalled sheet panel. It was never
   going to be reached. **The probe committed the D0b error one level up from
   the one D0b warns about**: not a wrong component sharing a class, but the
   right component in a surface that is not rendered at the measured width.
   Note the probe's own `visible` filter is `(r) => r.getClientRects().length > 0 || true`
   — the `|| true` makes the visibility filter a no-op, so the marking step
   could not have caught this.

Consequences that must be fixed in the artifacts:

- The `MobileNavSheet` focus trap (`panel.querySelectorAll(FOCUSABLE_SELECTORS)`
  over `panelRef`) is **behaving correctly** by excluding the kebab. It is not
  in the panel. D2 instructs the executor to find "why the trap's tabbable
  enumeration excludes the trigger" and "fix that specific cause" — the only way
  to do that is to make the trap enumerate outside `panelRef`, which is
  precisely the sheet-leak D3 identifies as a worse defect than the one being
  fixed. D2 and D3 are in direct conflict once R5 is corrected.
- No CSS change to `.dashboard-list__item-row .popover.actions-menu` can satisfy
  the `mobile-dashboard-sheet` spec delta ("row actions ... Rename, Duplicate,
  Share, Export, Delete MUST be openable"), because those actions have no
  rendered host at 430. Satisfying that delta requires **adding an actions
  affordance to `MobileNavSheet`'s item row** — a feature addition, not a focus
  fix, and materially larger than the restated scope.
- Ticket AC 1 / task 3.2 require `.focus()` on the resting row trigger to land
  on the trigger **at 430**. With `.app-sidebar { display: none }` that is
  unachievable by any treatment of the trigger itself; no descendant of a
  `display:none` ancestor is focusable. As written this AC cannot be met.

Defect (a) at 1440 remains real and unaffected by all of the above; D1 is a
sound fix for it (see Q3 below).

### Change Requests

1. **Correct R5's mechanism in `design.md`.** Replace "the sheet's focus trap
   plus `display: none`" with the measured truth: at 430 `.app-sidebar` is
   `display: none` (`frontend/src/app/App.css:606`, inside the `:519`
   `@media (max-width: 768px)` block), so `DashboardList` and its kebab are not
   rendered at phone width at all; `MobileNavSheet` is a separate portalled
   surface whose item row exposes only a selection button and a hardcoded
   "Share" secondary action, and which contains no `ActionsMenu`. Record this as
   a further refutation (R6) so the archive does not preserve R5's false
   mechanism the way this change correctly refused to preserve R1-R3's.

2. **Withdraw D2 as written.** The trap's exclusion of the kebab is correct
   behaviour, not a bug. Do not instruct an executor to make
   `MobileNavSheet`'s trap enumerate elements outside `panelRef` — that is the
   D3 leak. If any trap change survives re-scoping, it must be justified on its
   own probe evidence, not on R5.

3. **Re-scope defect (b), and escalate the re-scope rather than absorbing it.**
   The real gap is that phone users have no host for Rename/Duplicate/Export/
   Delete, because `MobileShell.tsx` hardcodes `secondaryAction` to Share only.
   Fixing that means rendering an actions affordance inside `MobileNavSheet` —
   a new mobile affordance with its own design (DESIGN.md) review, not a
   keyboard-reachability fix. State explicitly whether HEL-1003 now covers that
   or whether it is a spinoff; do not let an executor discover the scope change
   mid-implementation. This is a second material re-framing of the same ticket
   and warrants the coordinator's ruling, as the first one did.

4. **Fix ticket AC 1 and task 3.2.** Drop "and 430" from the programmatic-focus
   criterion for the dashboard-row trigger, or state the width-scoped truth: at
   430 the trigger has no rendered host, so the criterion applies at 1440 (and
   at any width above the 768px breakpoint). As currently written it is
   unsatisfiable and would push an executor toward un-hiding the sidebar at
   phone width — a far larger regression.

5. **Rewrite the `mobile-dashboard-sheet` spec delta to match the corrected
   mechanism.** Its "Row actions are keyboard-reachable inside the sheet"
   requirement presupposes the actions exist in the sheet. Either make the
   requirement conditional on the affordance CR3 decides to add, or drop it from
   this change. Keep the "focus trap holds in both directions" requirement —
   it is good and should survive re-scoping regardless (see Q1 below).

6. **Fix the guard's target (D4 / tasks 6.1-6.2).** A guard built on probe 3's
   technique would encode the same wrong surface. Whatever (b) becomes, the
   guard must locate the trigger by a unique marker **within the sheet panel**
   (`panelRef`'s subtree), and must assert the element it marks is actually
   rendered — probe 3's `getClientRects().length > 0 || true` filter is a
   no-op and must not be carried forward.

7. **Close D3's leak-mode gap.** The bidirectional wrap requirement (Tab from
   last, Shift-Tab from first) is necessary but **not sufficient**, and the plan
   should say so. `handleFocusTrapKeyDown` is bound to `panel`, not `document`,
   and only acts when `document.activeElement` is exactly `first` or `last` of a
   *live* `querySelectorAll` taken per keystroke. Three leak modes the stated
   two-directional check would miss: (i) focus already outside the panel — the
   listener never fires, nothing wraps it back; (ii) the tabbable set changing
   between keystrokes (opening the kebab's popover mutates it), so the element
   that was `last` no longer is and no wrap fires at the real boundary; (iii) a
   popover portalled outside `panelRef` — the menu's own items would then sit
   outside the enumeration entirely. Require the trap verification to walk the
   **full cycle** (N+1 tabs from the first element, asserting every stop stays
   inside the panel and that the walk returns to the start) **with the actions
   menu both closed and open**, not just the two boundary presses.

8. **Tighten D4/task 6.3's red arm so it cannot be weakened.** The prose intent
   is right, but "reproduce the actual failure" is a description, not a
   constraint an executor can be held to. Specify the assertion shape: the guard
   must compute `reachedAt` (the tab index at which the uniquely-marked trigger
   receives focus) over a bounded walk and assert `reachedAt` is a positive
   number within the bound; the red arm must show it failing with the sentinel
   (`-1` / never reached), and the recorded output must include the tab trail.
   Explicitly forbid satisfying 6.3 with `toBeVisible`, `toHaveCount`, a
   snapshot diff, or any element-presence assertion — those are the weaker forms
   an executor reaches for when a mutation will not go red.

### Non-blocking notes

- **Q3 (D1's chosen fix) is sound, with one caveat to state explicitly.** For
  the 1440 defect, "visually-hidden-but-focusable" does make `.focus()` succeed
  in Chromium *provided* the treatment is the clip/opacity family
  (`opacity: 0`, `clip-path`, `clip` + 1x1) — all of which keep the element
  laid out and focusable. It must NOT be `visibility: hidden`,
  `display: none`, `content-visibility: hidden`, or an `inert` ancestor: those
  are the variants browsers refuse to focus, and `visibility: hidden` in
  particular is the easy mistake because it reads as "just hidden". Name the
  permitted and forbidden treatments in D1 rather than leaving "zero-opacity /
  clipped" to interpretation. On density: `opacity: 0` alone keeps the trigger
  occupying its 24x24 box, which *does* change the resting row — the row button
  is `flex: 1`, so it will reflow narrower even though nothing new is painted.
  Task 3.3 correctly asks for this check; the likely resolution is
  `position: absolute` + clip so the trigger is focusable without consuming row
  width. Worth saying so, since 3.3 as written only asks the executor to
  *detect* the shift, not what to do about it.
- **Q4 (can D2's probe be short-circuited?)** Moot once CR2 lands, but for the
  record: as structured it could not be skipped cleanly — task 2.2 requires the
  root cause in `files-modified.md` before the fix, and 4.1 requires
  demonstrating rather than assuming that task 3 incidentally resolved it. That
  is the right shape. Preserve it for whatever (b) becomes.
- D5's per-instance triage (12 assertions, reasoning per instance not blanket)
  and the HEL-1005 boundary are well drawn; no objection.
- D6's "prefer the narrower placement" (`DashboardList.css` over
  `ActionsMenu.css`) is the right call and correctly reasoned.
- Task 8.1 (delete the three scratch probe specs) is important — all three are
  currently untracked in the worktree and `hel1003-premise-probe3.spec.ts` is
  the artifact that produced the false R5.
