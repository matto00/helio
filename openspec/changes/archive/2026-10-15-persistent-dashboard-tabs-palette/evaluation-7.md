## Evaluation Report — Cycle 7 (evaluation-7.md)

Reviewed head: `7b5945234570402fea6056c5e966ee9bdcc2956c` (worktree
`/home/matt/Development/helio/.claude/worktrees/feature/persistent-dashboard-tabs-palette/HEL-1575`, clean tree).
Review base (resolved live with `resolve-review-base.sh`): `38de7610a` (origin/main, HEL-1576). Since the cycle-6 PASS on
`76fca5fa6`: `10130d021` (two-device test wait), `4f492359d` (merge of HEL-1576), `7b5945234` (hel1575 drag helper turns
Edit layout on). No `backend/**` or `schemas/**` file changed since `76fca5fa6` (`git diff --stat 76fca5fa6 HEAD -- backend schemas`
is empty), and HEL-1576 brought no backend change or migration, so `sbt testFull` was not needed. Shared DB `helio` at V135
(`flyway_schema_history`), the same `DATABASE_URL` for the backend and Playwright.

Transcripts: `/home/matt/Development/helio/.concertino/scratch/HEL-1575/eval7/`. Each starts with `pwd=<this worktree> head=7b5945234...`.

### Phase 1: Spec Review — PASS
Issues: none.
- **`10130d021` diagnosis verified from the CI trace** (`SCRATCH/ci-art/tr/*-trace.network`, extracted myself). Device A (`2-trace`) sent
  `PATCH /api/users/me/preferences` at 01:29:11.892 (one tab, active A) and again at 01:29:15.167 (the full three-tab set, `lastViewedAt` 12.388 /
  13.289 / 14.031). Device B (`0-trace`) saved its one-tab set at 01:29:14.579, between them. A's second PATCH is the ~1.1 s coalesced save of A's own
  tab opens (last stamp 14.031), so B saved before A's own writes had settled. That is a test race, as the executor said. The diff (`git show 10130d021 -- e2e`)
  changes only the pre-B wait, from `expectSavedActive(A)` to `expectSaved([A,B,C], A)`. The assertions after B's save are unchanged: B's set held at
  every 25 s check over 125 s, and zero PATCHes from A. The test is stricter, not weaker.
- The **cross-lane predicate fold** is correct. `app/dashboardChrome.ts` has one private `isRailDashboardView` (`!isPhoneShell && isDashboardViewPath`) and two
  exports, `usesDashboardMetaRow` and `usesDashboardTabBar`. `App.tsx` `showTabBar` uses `usesDashboardTabBar`, the meta-row branch uses `usesDashboardMetaRow`,
  and `hidesBreadcrumbItemName` takes its dashboard clause from `usesDashboardTabBar`. No parallel conditional is left (grep for `isDashboardViewPath`
  in non-test sources: `App.tsx:74` `onDashboardView`, `CommandBar.tsx:69`, `AppRail.tsx:28`, `tabsBrowserTriggers.ts:33`; none of these is a chrome-mount
  decision). `dashboardChrome.test.ts` pins that the two predicates agree on 6 paths x 2 shells.
- Constraints C1-C7 are unaffected by the three commits (test-only plus merge resolution; no dependency change in `package*.json` vs base, so C6 holds).

### Phase 2: Code Review — FAIL
Gates (fresh, this head, `nice -n 19`):
| gate | result | transcript |
| --- | --- | --- |
| `npm run lint` / `typecheck` / `format:check` / `npm --prefix frontend run build` | all exit 0; "All matched files use Prettier code style!"; PWA `precache 41 entries` | `static.txt` |
| `HELIO_JEST_MAX_WORKERS=2 npm test` | exit 0: root 55 suites / 485 tests; frontend 650 suites / 7761 tests | `jest.txt` |
| hel1575 spec (`--workers=2`) | 21 passed (5.6 min), exit 0 | `hel1575.txt` |
| two-device test `--repeat-each 3` | 3 passed (2.2 min each), exit 0 | `two-device.txt` |
| overlays (`state-surface-contrast-guard.spec.ts:760`) `--repeat-each 5` | 10 passed (light + dark x 5), exit 0 | `overlays.txt` |
| FULL e2e under `flock ... e2e.lock`, `--workers=2` | **332 passed, 1 skipped, 1 failed**, 19.9 min, exit 1; load 2.2 at start, 4.7 at end | `e2e-full.txt` |
| `hel1457-stale-tab-layout-save.spec.ts --repeat-each 8` (reproduction) | **14 passed, 2 failed** (`:92`, repeats 4 and 16), load 4.7 | `hel1457-repeat.txt` |

Merge review:
- **CSS pins = 144.** `find frontend/src -name '*.css' | wc -l` = 144 on this head. Both guards pin 144 (`elevationTokenGuard.css.test.ts`, `motionTokenGuard.css.test.ts`)
  with the provenance comment. Neither guard is loosened.
- **`processedWidth` allowlist entry.** It is absent on this head, which is correct. The executor's explanation is slightly off: HEL-1576 itself (`38de7610a`) already
  removed the entry on main and stubbed `getOutputById` / `getAssertionStatus` in that test. The merge just took main's side (`git show 4f492359d -- frontend/src/test/networkGuard.ts`).
  The allowlist now holds only HEL-1579's five `PipelineDetailPage*` entries, and the full jest run is green with the guard active.
- **AppShell test adaptations.** `AppShell.dashboardMetaRow.test.tsx` adds only the `dashboardTabs` reducer, preloaded as hydrated. Without it the slice is missing and the
  tab listeners have nothing to read, and no assertion changed. In `AppShell.rail.test.tsx` the dashboard-view case now asserts *no* breadcrumb, because the meta row replaces the command bar there. That is HEL-1576's
  owner ruling `meta-row-replaces-command-bar`, not a weakening, and the name-in-breadcrumb rule is still covered in `CommandBar.test.tsx`.
- **`7b5945234`.** `enterLayoutEditMode` clicks only if "Edit layout" exists, then asserts "Done" is visible. `dragFirstCardDown` still asserts "Unsaved changes", so the
  drag is proven to take effect. The helper is called long after load, and the test passed in my full run (`:711`, 13.6 s).
- `hel813 ... surface 7: Connectors page` passed at 430 and 768 in my full run, consistent with the executor's flake judgement.

**Defect (mechanical, blocks PASS): `e2e/hel1457-stale-tab-layout-save.spec.ts:92` fails on this head about 1 run in 4 (3 failures in 9 runs).**
The spec text is identical to main (`git diff 38de7610a HEAD -- e2e/hel1457-stale-tab-layout-save.spec.ts` is empty), but the merged tree is what CI runs.
- Symptom: `TypeError: Cannot read properties of null (reading 'x')` at `hel1457-stale-tab-layout-save.spec.ts:125`, because `handle.boundingBox()` returned null.
- Root cause, from the failing trace (`eval7/tr1457/test.trace`, repeat 7): after `goto`, `expect(.react-grid-item).toHaveCount(1)` passes, and
  `Query count getByRole('button', {name: 'Edit layout'})` runs. **No click step follows**, so the count was 0. Then the bounding box of a non-existent handle is null.
- Why the count is 0: `DashboardMetaRow.tsx` renders the Edit layout toggle only when `gridIsMovable` (the DesktopPanelGrid is mounted). `.react-grid-item` count 1 is
  also satisfied by `PanelGridSkeleton` (one item per saved layout entry, HEL-528 D10). On this branch, panels are fetched only after the tab set hydrates
  (D1, intended), which widens the skeleton-before-grid window. This is the same mechanism `ci-fix-cycle.md` already recorded and fixed for hel1028's `openDashboard`. HEL-1576's
  idempotent `if ((await toggle.count()) > 0) await toggle.click()` then silently skips the toggle instead of waiting for it.
- Product behaviour is intended (the toggle appears with the movable grid). The defect is a test race that this merge makes visible, and it will flake in CI on the merged head.
  I did not measure main's own frequency for this test. The claim that the branch widened the window rests on the trace plus the hel1028 precedent, not on a main-side run.

Other review notes: nothing new outside the above. No `any`, no dead imports, no new TODO. Lint and format are clean.

### Phase 3: UI Review — PASS
Servers: `start-servers.sh` (READY frontend `:7007`, backend `:9914`), `assert-phase.sh servers` PASS. Own Chromium (standalone script, every page URL checked to be `localhost:7007`),
a throwaway user deleted afterwards by exact id with `buildUserDeleteSql`.
Measurements (`eval7/visual/`, screenshots `{light,dark}-{1280,820,768}.png`):
| theme / width | tab bar box | meta row box | tabs | console errors | horizontal overflow |
| --- | --- | --- | --- | --- | --- |
| light 1280 | x304 y0 w976 h49 | x304 y49 w976 h48 | 1 | 0 | none (1280/1280) |
| dark 1280 | x304 y0 w976 h49 | x304 y49 w976 h48 | 1 | 0 | none |
| light 820 | x304 y0 w516 h49 | x304 y49 w516 h48 | 1 | 0 | none (820/820) |
| dark 820 | x304 y0 w516 h49 | x304 y49 w516 h48 | 1 | 0 | none |
| light / dark 768 (phone shell) | absent | absent | 0 | 0 | none |

The meta row sits directly under the 49 px tab strip, with the same x and width, at both widths in both themes. At 1280 the full actions show
(Edit layout, Share, Add panel). At 820 the meta row's own HEL-1576 tier collapses the Edit layout and Share labels into the kebab, which is HEL-1576 behaviour and outside this lane's scope.
The phone shell at 768 is unchanged (top title + switcher, glass bottom nav, no tab list, no meta row). The full Playwright suite exercises the remaining objective checks (keyboard,
breakpoints, contrast guard). Subjective cohesion is the skeptic's call.

Evidence note: the screenshots and transcripts live under `/home/matt/Development/helio/.concertino/scratch/HEL-1575/eval7/` in the main checkout, not in the worktree, so `cleanup.sh --phase4`
cannot remove them. All claims above rest on content (trace step lists, box measurements, counts), not on mtimes.

### Overall: FAIL

### Change Requests
1. **`e2e/hel1457-stale-tab-layout-save.spec.ts` (`dragA`, lines 116-131, and the wait at line 113): make the Edit layout toggle wait for the movable grid instead of skipping it.**
   After `page.goto(...)` and the `.react-grid-item` count wait (line 113), also wait for the skeleton to be gone, as `hel1028`'s `openDashboard` already does:
   `await expect(page.getByLabel("Loading panels")).toHaveCount(0, { timeout: 15_000 })`. In `dragA`, after the conditional click, assert edit mode is on:
   `await expect(page.getByRole("button", { name: "Done" })).toBeVisible()`, so a skipped toggle fails loudly at the cause instead of at `bb.x`. This is the same pattern as the
   hel1575 `enterLayoutEditMode` helper. Prove it with `--repeat-each 8` (or more) on this spec under the e2e lock, 0 failures, and re-run the FULL e2e suite under the lock afterwards.
   This spec belongs to HEL-1576, but the race appears only on the merged tree, which is this branch's head.
2. **Audit the other skeleton-satisfied waits before a meta-row action.** Grep `e2e/` for `toHaveCount(` on `.react-grid-item` that is followed by an Edit layout `count()` guard or a
   handle `boundingBox()` (currently `hel1028` is fixed, `hel1230` uses an auto-waiting `.click()`, and `hel1575` calls its helper long after load). Apply the same skeleton-gone wait to any
   other site found, or record that there are none.

### Non-blocking Suggestions
- On the rail dashboard view the command bar is no longer mounted (the meta row replaces it), so `hidesBreadcrumbItemName`'s dashboard clause and `CommandBar`'s
  `onDashboardView && ... && !breadcrumbNameHidden` term cannot be true where `CommandBar` renders. It is harmless, and correct if the slots ever change again, but a one-line comment saying it is a
  guard for a currently-unreachable combination would keep a future reader from hunting for the case.
- In `ci-fix-cycle.md`, correct the `processedWidth` line: HEL-1576 already drained that entry on main. The merge kept main's side; it was not a removal driven by this branch.

### Critical Path
(CYCLE 7 is past `EXECUTION_CYCLES` = 3.)
- What is needed for a PASS: CR1, a test-only wait in one HEL-1576 spec, plus a fresh full e2e run under the lock. Everything else on this head is verified green: static gates, jest 650/7761, hel1575 21/21,
  two-device 3/3, overlays 10/10, 332 of 333 non-skipped e2e. The visuals and the predicate fold are correct.
- Recommendation for the human: this is a small, mechanical, test-side fix with a probe-confirmed cause. Allow one more executor cycle limited to CR1/CR2, rather than shipping
  a head whose CI will flake about 1 in 4 on `hel1457:92`.
