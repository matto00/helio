## Evaluation Report — Cycle 2 (evaluation-2.md)

- **Reviewed:** HEAD `9bb431cce5f42bd2e9708c82f3189560fe3d3a78`.
- **Base:** `d8cdfb460f65d130af533770aeadc798dbe30daf`, resolved live with `resolve-review-base.sh`.
- **Cycle diff:** `d83d404a6..HEAD`, made of `3b3d4a029` (red tests) and `9bb431cce` (fixes).

### Phase 1: Spec Review — PASS

Issues: none. evaluation-1's Phase 1 items are resolved:

- **CR1.**
  - spec.md now says "Add panel" in the palette requirement body and in both scenario names and THEN lines.
  - design.md now says it in D3, D8 and the Context section.
  - Grep confirms no "New panel" remains in the change's spec or design.
- **CR4.** tasks.md has 0 unchecked items (`grep -c "\- \[ \]"` = 0).

### Phase 2: Code Review — PASS

**Gates I ran myself in WORKTREE_PATH** (nice -n 19, jest 3 workers):

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm --prefix frontend run build` | exit 0 |
| `npm test` (root) | 70 suites / 617 tests passed |
| `npm test` (frontend) | 870 suites / 10249 tests passed (exit 0) |

**e2e** (lane DB `helio_hel1782`; the backend log shows it connected to `helio_hel1782`; Playwright 2 workers):

- **Batch 1: 72/72 passed.**
  - `hel1782-viewer-shell`, `hel1773-viewer-grantee-dashboard`, `hel1578-home-page`, `hel503-palette-global-resource-search`, `hel813-mobile-touch-target-floor`, `hel813-mobile-touch-target-floor.regression` and `hel1575-dashboard-tabs`.
- **Batch 2: 73/73 passed.**
  - `hel773-top-anchored-mobile-nav-sheet`, `hel1583-glass-nav-light`, `hel1583-glass-nav-dark`, `hel1681-refresh-control` and `hel1656-pull-to-refresh`.

**C16 grep for this cycle's diff.** I grepped for `.dashboard-list__name`, "Getting started", "Set up step by step", `mobile-nav-sheet__item`/`__footer`, "No dashboard open", the checklist and emphasis. The hits were:

- **hel1578.** Home step-by-step.
- **hel503.** `.dashboard-list__name` filtered by text, on owned names.
- **hel813, both files.** The `.mobile-nav-sheet__item` touch floor.
- **hel773.**
- **The glass-nav helper.** It contains "Getting started".
- **hel1575.**

All of them were run in full.

**Specs not run.** hel1665 (the four Home phone-stability files) has no hit for any selector or string this cycle alters, and this cycle does not touch Home, so it was not run. hel1656 and hel1681 have no cycle-2 hit either. I ran them anyway, because cycle 1 changed `DashboardRefreshLine` and pull-to-refresh is an AC.

**Fix review:**

- **CR2.**
  - `DashboardList.tsx:693` now wraps the label in `.dashboard-list__name`.
  - `DashboardList.css:505` keeps the icon from shrinking (`flex-shrink: 0`).
  - The e2e asserts no overflow and the same font size and weight as a sibling row.
- **CR3.**
  - `PanelList.tsx:207-211` now includes the shared-only state in `onboardingSupersedesEmptyState`.
  - The "No dashboard open" branch (`:541`) is now guarded by `!wouldShowSharedOnlyEmptyState`.
  - A test was added: `PanelList.onboarding.test.tsx`, "shows only the checklist after 'Set up step by step' for a shared-only user". The CR3 regression this cycle (Phase 3) comes from this guard.
- **Adopted suggestions.**
  - The `Plus` icon is now on the sheet footer row (`MobileNavSheet.tsx:437`, with `.css:394`).
  - Zero-dashboard no-row tests were added to both build-own test files.

**Mutations, re-run by me** (each file restored afterwards; `git status` clean):

| Mutation | Result |
|---|---|
| R2: label as a bare text node | red |
| R3a: guard reverted to `!showFirstRunDropZone` | red |
| R4: sheet icon dropped | red |
| E1: `items.length > 0` dropped from the build-own hook (survived in cycle 1) | now red, in `DashboardList.buildOwn` |
| R3b: shared-only case removed from `onboardingSupersedesEmptyState` | survives; only the checklist's emphasis variant changes (non-blocking) |

On E1, the sheet's zero-dashboard test stays green under the mutation. The sheet renders its empty-state branch instead of the list for zero items, so the footer can never render there. That test is structurally redundant, not wrong.

### Phase 3: UI Review — FAIL

**Method:**

- Servers were started with `start-servers.sh` (7214/10121) against `helio_hel1782`, with `ANTHROPIC_API_KEY` empty.
- I seeded my own throwaway owner, viewer and editor. The viewer holds viewer grants on two of the owner's dashboards.
- I tested as the viewer at 1440 and 390, in both themes.
- Afterwards the users were deleted by exact id with `buildUserDeleteSql`, which left 0 rows.

**Durable evidence** in `/home/matt/Development/helio/.concertino/runs/HEL-1782/evidence/e2e-evidence/HEL-1782/`:

- `eval2-sidebar-dark.png`
- `eval2-sidebar-light.png`
- `eval2-stepbystep-dark.png`
- `eval2-dismiss-dark.png`
- `eval2-sheet-light.png`

**Verified fixed:**

- **CR2.** Measured in dark at 1440:
  - Button box: 221 to 253.
  - Text box: 228 to 246.
  - `scrollHeight` 30 = `clientHeight` 30.
  - Label: 14px / 500 / nowrap, the same as the sibling `.dashboard-list__name`. The label is not truncated.
  - The label is one line in both themes (`eval2-sidebar-dark.png`, `eval2-sidebar-light.png`).
- **CR3.**
  - Path: Build your own dashboard, then Set up step by step.
  - Dark result (`eval2-stepbystep-dark.png`): the checklist only, with primary emphasis.
  - Light result, from a DOM probe: checklist true, "No dashboard open" false, drop zone false.
- **Sheet footer.** The `Plus` icon leads the "Build your own dashboard" row (`eval2-sheet-light.png`).
- **Viewer's empty shared dashboard.** "No panels yet / This dashboard has no panels yet." with no CTA, in both themes. This covers AC2.

**Issues:**

1. **A blank `/dashboards` pane, introduced by this cycle's CR3 fix.** Reproduced in dark (`eval2-dismiss-dark.png`).
   - **Repro:** as a shared-only user, choose "Build your own dashboard", then "Set up step by step", then dismiss the checklist (X).
   - **Result:** the panels region renders nothing. There is no drop zone, no checklist and no empty state.
   - **Choosing the row again does nothing visible.** A DOM probe after clicking the sidebar row again shows the `panels` region with empty `innerText`, `dropZone: false` and `checklist: false`.
   - **Why it stays blank:**
     - `stepByStep` is local PanelList state that stays `true`, so `showFirstRunDropZone` is false (`PanelList.tsx:203-206`).
     - The checklist is no longer visible.
     - "No dashboard open" is now suppressed for every shared-only state (`:541`).
   - **The entry stays blank until a remount.** Navigating away or reloading resets it.
   - **Why this fails:** it breaks the Phase 3 "no blank screens" check. It also breaks the spec, which says the drop zone SHALL be shown whenever a shared-only user has no dashboard open on `/dashboards`. The new e2e and Jest tests do not cover the dismiss step.
   - **Before this cycle,** the same path ended on "No dashboard open". That was wrong, but it was not blank.
   - **For comparison,** a zero-dashboard account on the same path falls back to "No dashboards yet" with a CTA (`:498`, `wouldShowZeroDashboardEmptyState && !onboardingVisible && !showFirstRunDropZone`).

### Overall: FAIL

### Change Requests

1. **Give a shared-only user a non-blank `/dashboards` after the checklist is dismissed.**
   - **Where:** `frontend/src/features/panels/ui/PanelList.tsx`.
   - **Required behavior:** once `onboardingVisible` is false, show the first-run drop zone again.
   - **Suggested fix:** derive the step-by-step suppression from the checklist actually being visible. Change `!stepByStep` in `showFirstRunDropZone` (`:203-206`) to `!(stepByStep && onboardingVisible)`. Alternatively, reset `stepByStep` to false when the checklist is dismissed.
   - **Also cover the re-choose path:** choosing "Build your own dashboard" again must show the drop zone. With either change above, it will.
   - **Test:** add a test to `PanelList.onboarding.test.tsx`, next to the cycle-2 test:
     - Setup: shared-only user, `selectedDashboardId: null`.
     - Steps: click "Set up step by step", then click "Dismiss getting-started checklist".
     - Assert: the "Build your first dashboard" drop-zone region is present, and "No dashboard open" is absent.
     - Red check: confirm it is red at HEAD `9bb431cce`.
   - **Verify:** on the running app.

### Non-blocking Suggestions

- **Mutation R3b survives.** Removing the shared-only case from `onboardingSupersedesEmptyState` only demotes the checklist's emphasis to "secondary". If the primary emphasis matters, assert the checklist's emphasis variant in the cycle-2 test.
- **The sheet's zero-dashboard test is redundant for E1** (see Phase 2). It could be dropped, or kept as a guard on the empty branch.
