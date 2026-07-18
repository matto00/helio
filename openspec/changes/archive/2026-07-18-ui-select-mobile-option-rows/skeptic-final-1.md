## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Diff is exactly CSS + CSS-lock tests, no scope drift.**
   `git diff main...HEAD --stat -- frontend/` shows only:
   `ActionsMenu.css` (+17), `ActionsMenu.css.test.ts` (+70, new),
   `inputs.css` (+17), `inputs.css.test.ts` (+70, new). Matches
   `files-modified.md` exactly. Both CSS diffs are purely additive
   `@media (max-width: 768px)` blocks; nothing outside them touched.

2. **AC1 — `ui-select` popover rows ≥44px at 390px, both themes — TRUE, independently measured live.**
   Opened the real `Value field` `<Select>` inside `PanelDetailModal` (via
   panel card → Edit) at 390×844:
   - Light theme: all 31 options `getBoundingClientRect().height === 44`,
     `display: flex`, `align-items: center` (computed style).
   - Dark theme (toggled via `.topbar-theme-btn`, confirmed
     `document.documentElement.getAttribute('data-theme') === 'dark'`):
     same, 44px, flex-centered. Screenshots:
     `/tmp/.../scratchpad/05-select-open-mobile-dark.png` (light theme, mislabeled filename),
     `/tmp/.../scratchpad/06-select-open-mobile-dark2.png` (actual dark theme).
   - Popover scroll containment verified: `scrollHeight` 1372 >
     `clientHeight` 278, `overflow-y: auto`, `max-height: 280px` unchanged —
     the 30-option list scrolls inside the panel, no overflow.
   - No horizontal overflow: `document.documentElement.scrollWidth === window.innerWidth === 390`.

3. **AC2 — desktop density unchanged — TRUE, independently measured live.**
   Resized to 1280×800, reopened the same `Value field` select:
   `.ui-select__option` height = **34px**, `display: block` (all 4 sampled
   rows). Also opened a real desktop panel-card kebab (`ActionsMenu`):
   `.actions-menu__item` height = **31px**, `display: block` (Rename/
   Customize/Duplicate/Delete). Screenshots: `07-select-desktop.png`,
   `08-actions-menu-desktop.png`, `10-select-desktop-open.png`.

4. **AC3 — CSS-lock test actually locks the rule.** Read both
   `inputs.css.test.ts` / `ActionsMenu.css.test.ts` in full: they brace-match
   the `max-width: 768px` block and assert `min-height: 44px` +
   `display: flex` + `align-items: center` on the rule body. I did not just
   trust this — I **broke the rule and reran**: changed `inputs.css`'s
   `min-height: 44px` to `40px`, ran
   `npx jest --testPathPatterns=inputs.css` → test **failed** with the
   expected diff, then restored the file (`git diff` clean afterward). The
   test genuinely catches a regression, not a tautology.

5. **Gates re-run myself, not trusted from the evaluator's report:**
   - `npm test` → **106 suites / 1121 tests passed**.
   - `npm run lint` → clean (zero-warnings policy, exits 0).
   - `npm run format:check` → "All matched files use Prettier code style!"
   - `scripts/concertino/assert-phase.sh servers` → `PASS servers`.
   - Console: 0 errors in the browser across all interactions; only the
     pre-existing, unrelated `selectPipelineOutputDataTypes` memoization
     warning (confirmed via `browser_console_messages`), matching the
     evaluator's disclosure.

6. **DESIGN.md compliance:** `768` is one of the four canonical breakpoints
   (`DESIGN.md` line 152). The literal `44px` (not a `--control` token) is
   consistent with the already-ratified precedent I confirmed directly in
   `MobileNavSheet.css:147-155` and `PanelDetailModal.css` (many `44px`
   occurrences, same HIG-minimum rationale, same "literal, not a token"
   convention) — not a new violation.

7. **Independently re-derived the evaluator's most interesting finding
   (did not just accept their claim): the `.actions-menu__item` fix is
   currently unreachable on a real phone viewport.** I traced this myself
   from source, not from `evaluation-cycle-1.md`:
   - `grep -rl "<ActionsMenu" frontend/src` → exactly 3 call sites:
     `PanelCard.tsx`, `DashboardList.tsx`, `SidebarItemList.tsx`.
   - `MobilePanelStack.tsx` (which replaces `PanelCard` below the grid's
     `sm` breakpoint) renders `PanelCardBody` directly and never imports
     `ActionsMenu` — confirmed by reading the file in full.
   - `DashboardList`/`SidebarItemList` only render inside `SidebarBody`,
     which mounts inside `<aside className="app-sidebar">`, and
     `App.css:394-398` sets `.app-sidebar, .app-sidebar-toggle,
     .app-sidebar-collapse { display: none }` inside the same
     `@media (max-width: 768px)` threshold, with an explicit comment: "the
     desktop sidebar is simply not rendered here" (mobile-pwa "no
     CRUD/editing on phone" policy).
   - Live-confirmed in the browser: at 390×844, `document.querySelectorAll('.actions-menu__trigger')`
     returns 20 elements, **all with `offsetParent === null`** (hidden);
     at 1280×800 the same selector finds 3 *visible* triggers (real desktop
     panel kebabs).
   - Net effect: this specific CSS rule is inert in the shipped app today —
     harmless, tested, on-convention, but not exercised by any real user
     flow at ≤768px. This is a documentation/justification gap in the
     proposal (which claims "mobile-reachable via panel-card, dashboard-list,
     sidebar kebab menus"), not a functional defect, and not something this
     ticket's formal ACs (which only cover `ui-select`) require to be
     reachable. I agree with the evaluator's judgment call to not block on
     it — flagging as a non-blocking note per below.

8. **Screenshot hygiene:** Playwright's `browser_take_screenshot` wrote to
   the *main* checkout's cwd (`/home/matt/Development/helio/*.png`), not the
   worktree, on each call — the known parallel-Playwright-session hazard.
   I moved every stray PNG into the session scratchpad
   (`/tmp/claude-1000/.../scratchpad/`) and re-checked `git status` on the
   main repo (clean) after each. None entered the repo.

### Verdict: CONFIRM

### Non-blocking notes

- Recommend correcting `proposal.md`/`design.md`'s claim that
  `.actions-menu__item` is "mobile-reachable via PanelCard / DashboardList /
  SidebarItemList" — none of those three are reachable at ≤768px in the
  current app (verified independently, see #7 above). The fix itself is
  harmless, well-tested, and on-convention; only the stated justification is
  inaccurate.
- The evaluator's flagged pre-existing bug (chart-type `<Select>` in
  `PanelCreationModal` rendering its popover off-screen at 390×844 due to a
  `usePortalPopover` positioning discrepancy) is confirmed out of scope —
  `Select.tsx` / `usePortalPopover.ts` / `PanelCreationModal.css` are all
  absent from this diff. Worth a spinoff ticket as recommended.
