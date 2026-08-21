## Evaluation Report — Cycle 2 (evaluation-2.md)

Commit reviewed: `4386eb4b` ("Fix stale attemptFired reopening-closes-immediately
regression, remove dead IconButton inert prop") on top of cycle 1's `eb3bc693`.
Every gate run and every measurement below is my own fresh run
(`verification-before-completion`); nothing is taken from the executor's summary.

### Phase 1: Spec Review — PASS

Issues: none.

- Cycle-2 diff touches only `MobileNavSheet.tsx`, `MobileNavSheet.test.tsx`,
  `IconButton.tsx`, the e2e spec, and change artifacts. No spec/design/task item
  changed meaning, so cycle 1's Phase-1 PASS still stands.
- **Fences re-verified across BOTH commits** (`git diff --name-only main...HEAD`
  filtered): no `SidebarBody.tsx`, `SidebarItemList.tsx`, `DashboardList.tsx`,
  `features/onboarding/`, and none of the HEL-548 create-action hooks.
- **D9 "consumer-side" honoured**: `App.tsx` is *not* in the cycle-2 diff, and no
  `useCallback` was introduced anywhere (the only match for that string in the
  diff is my own cycle-1 report text). The fix lives entirely in the sheet's own
  session-flag lifecycle, which is what D9 requires.
- `files-modified.md` is corrected: the false "used by the phone 'New chat'
  trigger" claim is replaced with an accurate description (the control goes inert
  by sitting inside `CommandBar.tsx`'s `display: contents` wrapper), plus a
  cycle-2 root-cause note. Minor wording nit only: it calls `App.tsx` "fenced" —
  it isn't fenced by HEL-554; it was simply not the right place for the fix. Not
  worth a change request.
- Tasks unchanged; 7.1 remains the deliberately deferred archive-step item.

### Phase 2: Code Review — PASS

Gates, run by me in `WORKTREE_PATH`:

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS (exit 0, zero warnings) |
| `npm run format:check` | PASS |
| `npm test` | PASS — 247 suites / **2667** tests (2666 in cycle 1 + the new regression test) |
| `npm --prefix frontend run build` | PASS |
| `npm run check:openspec` | PASS (`openspec/ is clean`) |
| `npx playwright test e2e/hel773-…spec.ts` | **10/10 passed** (9 from cycle 1 + the new reopen test) |

No `backend/**` change; `sbt test` not applicable.

**CR1 — fixed correctly, at the right layer.** `MobileNavSheet.tsx:148-150` now
resets `attemptFired` on *every* `open` transition (the `if (open)` guard is
gone), and `:178-184`'s dismissal effect gained `!open` in its guard with `open`
added to the dep array. Both legs of the failure mode are closed: the flag can no
longer outlive its session, and even a stale read during the one-render race can
no longer act. I traced the surviving paths for collateral damage and found none —
flag-flip dismiss-on-fire, dashboards' stay-open-while-pending →
dismiss-on-success, stay-open-on-failure, and the no-stale-error-on-reopen
behaviour are all still exercised green by the existing suite and by live
measurement below.

**CR2 — the new regression test genuinely can fail.** I verified this myself
rather than trusting the claim: I built a throwaway scratch copy of `frontend/`
outside the delivery worktree, swapped in `git show eb3bc693:…/MobileNavSheet.tsx`
(the pre-fix component) while keeping the **new** test file, and ran jest against
it:

```
● MobileNavSheet › does not call the reopened session's onClose after a create
  action fired in a prior session, even with a fresh onClose identity every render
  expect(jest.fn()).not.toHaveBeenCalled()
  Expected number of calls: 0
  Received number of calls: 1
Tests: 1 failed, 27 passed, 28 total
```

Red against the old code, for exactly the right reason (the reopened session's own
fresh `onClose` fired once), and green against the new code. Note that **only that
one test went red** — which independently confirms cycle 1's diagnosis that no
other case in the file could observe the defect. The test does vary `onClose`
identity on every `rerenderWith` (`onCloseSession1` → `onCloseAfterClose` →
`onCloseReopen`), mirroring `App.tsx:199`'s per-render closure. Scratch copy
deleted afterwards; the delivery worktree was never modified.

The new e2e case is also non-vacuous: a ~14 ms flash could in principle slip past
the first auto-retrying `toBeVisible()`, but the `waitForTimeout(300)` +
re-assert + `aria-expanded="true"` check after it cannot pass against the old
behaviour.

**CR3 — done.** `IconButton.tsx` is now byte-identical to `main`
(`git diff --quiet main...HEAD -- frontend/src/shared/ui/IconButton.tsx` is
clean), so the dead prop is gone with no residue.

No new issues: no dead code, no untyped escape hatches, no hardcoded colors/
spacing/type introduced, comments accurate (the `pickerEmptyState.ts` → `.tsx`
drift I flagged as a nit is also fixed).

### Phase 3: UI Review — PASS

Environment: existing dev servers on 6205/9112 reused; my **own** headless
Chromium via the repo's `playwright` package — the shared MCP session was not
touched.

**The cycle-1 defect is genuinely gone, not merely untestable.** I re-ran the
*identical, unmodified* `MutationObserver` probe script from cycle 1, on both hook
classes:

| Scenario | Cycle 1 (`eb3bc693`) | Cycle 2 (`4386eb4b`) |
| --- | --- | --- |
| Dashboards, reopen #1 after "New dashboard" | `[{present:true,t:3920},{present:false,t:3934}]`, dialogs 0, `aria-expanded=false` | `[{present:true,t:3942}]`, dialogs **1**, `aria-expanded=true` |
| `/sources`, reopen #1 after "Add source" | `[{present:true,t:2961},{present:false,t:2975}]`, dialogs 0, `aria-expanded=false` | `[{present:true,t:2963}]`, dialogs **1**, `aria-expanded=true` |
| Control (no create fired) | single `present:true` | single `present:true` (unchanged) |

Reopen #2 now correctly *toggles closed* (single `present:false` transition),
which is D2's intended trigger behaviour — the earlier "reopen #2 works" was the
symptom of the flag being cleared by the failed reopen. Second, independent probe
agrees: "REOPEN AFTER CREATE — dialogs immediately: 1 | after 600 ms: 1 |
aria-expanded: true" (cycle 1: 0 / 0 / false).

**No cycle-1 regressions.** Re-ran the full cycle-1 sweep; every measurement is
identical:

- Dialog-scoped `getComputedStyle` 44px floors — **430px**: rows 44/44, header
  action 44 (rect 44), drag strip 44, empty CTA 44; **768px**: rows 44/44/44,
  header action 44, drag strip 44. Sources/pipelines/registry empty CTAs 44px.
- D1/D3 anchor: `sheetTop === barBottom` at 430/375/320 and on all six sections;
  `--app-safe-top` forced at 0/47/59 on `document.documentElement` gives three
  *distinct* tops, each coinciding with the bar's bottom.
- D2: `elementFromPoint` at the bar's and trigger's centres resolves inside the
  bar at both the 0 ms and 400 ms frames; both `.app-command-bar__inert-group`
  wrappers and `.app-command-bar__right` carry `inert` while open and drop it when
  closed; chevron `--open` class and `aria-expanded` track state.
- D4/AC4: upward drag (140px) dismisses, downward drag (150px) does not, backdrop
  tap and Escape dismiss, focus restored to the trigger every time, Tab trapped in
  a 4-element cycle.
- D5: drag-strip bottom above the bottom-nav top at 430px with 8 dashboards; at
  320px sheet bottom 352 < nav top 632.
- D6/D7/D10: exactly one create affordance in every state; registry header action
  absent with the empty CTA present; metrics/chat message-only; initial focus on
  `.mobile-nav-sheet__item--active`.
- D14: registry CTA and sources CTA both open a real `dialog[open]`.
- AC5: computed `animation-name: none` on panel, clip wrapper and backdrop under
  emulated reduced motion.
- Breakpoints 1440/1100/769/430/375/320: no layout breakage, no horizontal
  overflow, desktop command-bar geometry byte-identical to cycle 1.
- No console errors in any sheet flow on any section. (The two `401 /api/auth/me`
  entries occur only on the pre-login `/login` page — pre-existing, phase-tagged
  and confirmed unrelated in cycle 1.)

Playwright `test-results/` artifacts my runs created were removed; the worktree is
clean (`git status --porcelain` empty).

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- `MobileNavSheet.tsx` grew 411 → **427** lines, further past CONTRIBUTING.md's
  ~400-line threshold. I still would not block on it — the drag gesture, focus
  trap and D9 session flag genuinely share local state — but CONTRIBUTING asks
  that the split be *proposed in the PR description*, and that is still not
  recorded anywhere in the change artifacts. Please put it in the PR body (or file
  a spinoff) rather than leaving it silent.
- The three `design.md` "Planner Notes" spinoffs still need filing: (1) phone
  users cannot rename a quick-created dashboard; (2) metrics/assistant have no
  sheet create action while their desktop siblings do; (3) HEL-565 should note the
  inverted drag has no gestural feedback and no exit animation.
- `files-modified.md`'s cycle-2 note describes `App.tsx` as "fenced". It isn't —
  it was simply the wrong layer for the fix. Cosmetic.
