## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `d83d404a693562a7d12be6dce43ad385b791cea8`. The base `d8cdfb460f65d130af533770aeadc798dbe30daf` was resolved live with `resolve-review-base.sh`. Commits reviewed: `02eb5def9` (red tests, `--no-verify`) and `d83d404a6` (implementation).

### Phase 1: Spec Review — FAIL

Issues:

1. **spec.md and design.md name the wrong palette entry.**
   - The palette's panel entry is titled **"Add panel"**: `builtInActions.ts:148` uses `panel.cta.label`, and `useCreatePanelAction.tsx:37` sets that label to `"Add panel"`. No "New panel" action exists anywhere in `frontend/src` (grep).
   - spec.md's requirement "The command palette offers no editing entry to a viewer" says "New panel" in its body and in both scenarios. design.md D3/D8 do the same.
   - The executor's claim is correct and the spec text needs correcting. As written, the spec asserts the absence of an entry that never exists, so it passes vacuously for a viewer and is false for an editor. These deltas get archived into `openspec/specs/`, so the error would become canonical.
2. **tasks.md is entirely unchecked.** Every item in sections 1 to 5 is still `- [ ]`, although the work is done (the tests, the code, mutations.md, cta-audit.md and files-modified.md all exist).
3. **A spec requirement is violated on one path** (detail in Phase 3, issue 2). spec.md: "Whenever a user who owns no dashboard has no dashboard open on `/dashboards`, the first-run drop zone SHALL be shown instead of the generic 'No dashboard open' state."
   - After the drop zone's own "Set up step by step", a shared-only user sees the onboarding checklist and the generic "No dashboard open" EmptyState together.
   - design.md D6 also requires that the step-by-step path never render the drop zone and the checklist together. It does not render them together, but the generic state that the requirement removes comes back.

Otherwise PASS:
- **Ticket ACs.** AC1 to AC7 are addressed. AC8 (both themes) was checked by me; see Phase 3.
- **Owner rulings 1 and 2** are implemented as ruled.
- **No scope creep.** C15 is respected: there are no tabs, warm-cache, usePanelData or CI files in the diff, and the only `dashboardsSlice.ts` edit is `getMostRecentDashboardId`.
- **CONSTRAINTS.** C12 holds: the red tests were committed before the implementation. The red-run record lives in the gitignored `.concertino/scratch/HEL-1782/red-run.md` and was not committed. C12 says "record and COMMIT the red run", so this is a reading question that I am noting, not failing. C13, C15 and C16 are honoured (see Phase 2).

### Phase 2: Code Review — PASS (with notes)

**Gates I ran myself in WORKTREE_PATH** (nice -n 19, jest 3 workers):
- `npm run lint`: exit 0
- `npm run format:check`: exit 0
- `npm run typecheck`: exit 0
- `npm test`: root 70 suites / 617 tests, frontend 870 suites / 10244 tests, all passed, exit 0
- `npm --prefix frontend run build`: exit 0
- Backend not touched, so no sbt run.

**e2e** (lane DB `helio_hel1782` via `DATABASE_URL`; I confirmed from the backend log that the backend is connected to `helio_hel1782`; Playwright with 2 workers):
- `hel1782-viewer-shell`, `hel1773-viewer-grantee-dashboard`, `hel1786-shared-dashboard-freshness`: 16/16 passed.
- `hel1575-dashboard-tabs`, `hel1583-refresh-line-no-shift`, `hel1646-skeleton-refresh-slot`, `hel773-top-anchored-mobile-nav-sheet`, `hel1583-glass-nav-light`, `hel1583-glass-nav-dark` (the two files split from the glass-nav helper): 78/78 passed.

**Selector grep (C16).**
- I grepped `e2e/` for every altered selector and string: `.dashboard-chip__shared`, "No dashboard open", `.first-run-drop`, "Build your first dashboard", `.dashboard-refresh-line*`, `.dashboard-meta-row__fact(s)`, "View only", "Build your own", `.mobile-nav-sheet__item`, `.dashboard-list__item(s)`, `.dashboard-list__button`, `.home-card__shared`.
- The new footer reuses `ul.dashboard-list__items > li.dashboard-list__item` and `.mobile-nav-sheet__item`. The specs that count those (`hel1573-motion-primitives:60/115/123`, `hel813-mobile-touch-target-floor.regression:270`, `hel1750`) use owned dashboards, where the footer is never rendered, so they are unaffected.
- The split glass-nav specs were run in full (above).

**Tests edited after the red commit** (`git diff 02eb5def9 d83d404a6`):
- **`DashboardRefreshLine.test.tsx:430`: legitimate.**
  - Before, it asserted no line for any non-owner. Ruling D1 now requires a viewer's line to always render.
  - The new assertion is stronger than a bare "not null": a viewer's line text must be exactly `"View only"`, which still proves the owner hook's mocked facts never leak. The editor branch keeps the null assertion.
- **`DashboardChipRow.css.test.ts:49`: legitimate and narrowly scoped.**
  - Only the first `.dashboard-chip__shared {…}` block (the badge, whose accent use is the ruled D5 recipe) is removed before the no-accent check. The active-chip and other rules are still checked.
  - The new active-badge rule `.dashboard-chip--active .dashboard-chip__shared` uses surface/text with no accent, and is still covered by the check.
- **`e2e/hel1786-shared-dashboard-freshness.spec.ts:366`: legitimate.**
  - The line's text span now reads "View only · refreshed …" for a viewer. The selector is narrowed to `.dashboard-meta-row__refresh`, which is RefreshFact's own element (`RefreshFact.tsx:31`).
  - The fact assertion is unchanged in strength, and the spec passed in my run.
- **`dashboardsSlice.accessRole.test.ts:46`: legitimate.**
  - It was rewritten in the red commit (not after it), by name, citing owner ruling 1, as design.md D8 prescribes.
  - Two new guards were added: an owned dashboard still beats a newer shared one, and deleting the last owned dashboard falls back to a shared one.
- **`PanelList.test.tsx`: addition only, not a weakening.**
  - A new owner control with `status: "succeeded"` was added after the implementation. It was needed because the executor's M9 mutation survived against the original control, whose status was idle.
  - The original `:313` test is unchanged.

**Mutations, re-run by me** (each file restored afterwards, `git status` clean):
- M1 (undo guard dropped): red
- M2 (slice fallback dropped): red, 2 tests
- M9 (ownsNoDashboard forced true): red
- M11 (build-own always offered): red in both files
- E2 (run() does not clear the selection): red in both files
- E3 (active-chip inverse dropped): red
- E4 (viewer "View only" span `aria-hidden`): red
- E5 (sheet footer does not close the sheet): red
- **E1 survived:** dropping `state.dashboards.items.length > 0` from `useBuildOwnDashboardAction` stays green. No test covers a user with zero dashboards, who must not get the "Build your own dashboard" row next to the existing "New dashboard" CTA. This is a gap (see the suggestions).

**Code quality.**
- DESIGN tokens are used throughout: `--space-*`, `--app-*` and `ICON_SIZE.sm`. There are no literal px values except the `2px` padding, which is copied verbatim from the existing sidebar and Home badges and kept equal to them by a test.
- No `any`.
- One mechanical defect, in `DashboardList.tsx:681-697`: the footer button renders its label as a bare text node instead of inside `.dashboard-list__name` (`--text-sm`, `--weight-medium`, nowrap and ellipsis), which every sibling row uses.
  - The label therefore inherits 16px / weight 400 (`--text-base`) where every list row is 14px / 500.
  - It also wraps inside the fixed `height: var(--control-md)` (32px) button. Phase 3 has the measured overflow.
- **Pre-existing file size.** `PanelList.tsx` is 583 lines and `DashboardList.tsx` is 700, both over the ~400-line "propose a split" threshold in CONTRIBUTING.md. The additions are small (+23 and +17), so this is not blocking.

### Phase 3: UI Review — FAIL

Method:
- Servers started with `start-servers.sh` on 7214/10121, against `helio_hel1782` with `ANTHROPIC_API_KEY` empty.
- Seeded my own owner, viewer and editor throwaway users, with two shared dashboards (the newer one has an Output panel) and one owned by the owner. The users were deleted afterwards by exact id with `buildUserDeleteSql`.
- Checked as the viewer in both themes at 1440, 1100, 768 and 390.
- Console errors on :7214: only the expected unauthenticated `401 /api/auth/me` before login. The errors on :7207 come from another lane's earlier session in the shared browser, not this run.

Passing observations:
- Desktop meta row: "View only" with an Eye icon comes first in the facts and matches the facts' type. It is present at 1100 and the document does not overflow.
- A shared-only user auto-opens the newest shared dashboard (ruling 1).
- Home shows the shelf with the Shared badges and then the drop zone below it.
- Phone meta line: "View only · refreshed …" at fixed height. The chip badge is a pill in both themes, and the active chip's inverse pill is legible in light and dark.
- The phone sheet lists "Build your own dashboard" after the rows.
- Choosing the sidebar row shows the drop zone on `/dashboards`.
- e2e covers ⌘Z being inert, the palette, pull-to-refresh on per-panel routes, and the editor's sheet having no Share.

Screenshots and measurements are stored durably at `/home/matt/Development/helio/.concertino/runs/HEL-1782/evidence/e2e-evidence/HEL-1782/`: `eval-viewer-desktop-a.png` (dark), `eval-viewer-desktop-light.png`, `eval-buildown-light.png`, `eval-stepbystep-light.png`, `eval-home-light.png`, `eval-phone-light.png`, `eval-phone-sheet-light.png`, `eval-phone-dark.png`.

Issues:
1. **The sidebar "Build your own dashboard" label overflows its row, in both themes.**
   - Measured at 1440 dark:
     - The button box is 221 to 253 (32px).
     - The label's text box is 217 to 257 (40px).
     - `scrollHeight` 35 > `clientHeight` 30.
     - Label computed style: `font-size: 16px; font-weight: 400`. The sibling `.dashboard-list__name` spans are `14px / 500`.
   - In `eval-buildown-light.png` (the row hovered or focused after the click), the white row band cuts through the two-line label, and "dashboard" sits on the band's bottom edge.
   - This is objective layout breakage, independent of taste.
   - It is visible in both `eval-viewer-desktop-a.png` (dark) and `eval-viewer-desktop-light.png`.
2. **"Set up step by step" brings back "No dashboard open" for a shared-only user.**
   - Repro: from the `/dashboards` drop zone, click "Set up step by step".
   - Result: the onboarding checklist renders above the generic "No dashboard open" EmptyState (`eval-stepbystep-light.png`).
   - Cause: `PanelList.tsx:207-208` `onboardingSupersedesEmptyState` covers only the zero-dashboard and zero-panel states. The "No dashboard open" branch at `PanelList.tsx:534-538` is guarded only by `!showFirstRunDropZone`, which goes false once `stepByStep` is true.
   - For a zero-dashboard user, the checklist supersedes the empty state on this same path. The shared-only path does not mirror that, which contradicts the spec requirement quoted in Phase 1, issue 3.

### Overall: FAIL

### Change Requests

1. **Fix the palette entry name in the spec.**
   - In `openspec/changes/read-only-viewer-shell-polish/specs/dashboard-grantee-access/spec.md`, requirement "The command palette offers no editing entry to a viewer": replace "New panel" with "Add panel" in the body (`(including "New panel")`), in the "Viewer palette has no New panel" scenario (its name and its THEN line), and in the "Editor palette keeps New panel" scenario. This is the real title from `useCreatePanelAction.tsx:37` via `builtInActions.ts:148`.
   - Make the same correction in design.md D3 and D8.
2. **Fix the sidebar row's label.**
   - In `frontend/src/features/dashboards/ui/DashboardList.tsx:689`, wrap `{buildOwn.label}` in `<span className="dashboard-list__name">…</span>`, the same element the dashboard rows use at `:423`. It then takes `--text-sm` / `--weight-medium` and truncates with an ellipsis instead of wrapping out of the 32px `--control-md` row.
   - Add a Jest or e2e assertion that the row's label does not overflow. For example, the e2e checks that `.dashboard-list__build-own` has `scrollHeight <= clientHeight` and that the label's font-size equals a sibling `.dashboard-list__name`'s. Re-check both themes on the running app.
3. **Keep "No dashboard open" hidden on the step-by-step path for a shared-only user.**
   - In `frontend/src/features/panels/ui/PanelList.tsx`, guard the "No dashboard open" branch (`:534-538`) with `!wouldShowSharedOnlyEmptyState` in addition to `!showFirstRunDropZone`.
   - Also include `wouldShowSharedOnlyEmptyState` in `onboardingSupersedesEmptyState` (`:207-208`), so the checklist takes the primary emphasis, as it does for a zero-dashboard user.
   - Add a PanelList test: shared-only, `selectedDashboardId: null`, with "Set up step by step" clicked or the `stepByStep` state set. Assert that the checklist is present, that "No dashboard open" is absent, and that the drop zone is absent. Confirm the test is red before the fix.
4. **Check off tasks.md items 1.1 to 5.4** that are done, so the artifact reflects the implemented state.

### Non-blocking Suggestions

- **Cover the zero-dashboard case of `useBuildOwnDashboardAction`.** My mutation E1, which drops `items.length > 0`, survives. Add an assertion that a user with zero dashboards gets no "Build your own dashboard" row in the sidebar or the sheet.
- **The phone sheet's footer row has no leading icon, while the sidebar row has `Plus`.** design.md D6 names an icon for "the row". Consider an icon on both, or note the deliberate difference.
- **The tab stays open when the selection is cleared.** After "Build your own dashboard" the previous tab stays in the tab bar, inactive, rather than closing. This matches design.md D6's `clearActiveTab()` path, but spec.md says "close the open dashboard". Consider wording it as "no dashboard is active".
- **C12 wording versus practice.** C12 says to commit the red-run record, but `.concertino/scratch/` is gitignored, so only the red tests were committed. Either reword C12 at Delivery or quote the red-run summary in the PR body.
