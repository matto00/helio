## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `f77cba7099938ce21ae2862a5a87bfecec5b7d51` (branch `bug/phone-skeleton-refresh-slot/HEL-1646`).
Diff base: `49021293b96c55fc9d80a6ed79b5b55d925fb6b7`, resolved live with `resolve-review-base.sh` (origin/main).

### Phase 1: Spec Review — PASS

- AC1 (frame-sampling e2e, slowed panels fetch, light and dark): `e2e/hel1646-skeleton-refresh-slot.spec.ts` covers
  375 and 430 in light and dark. I ran it myself: green on HEAD, red on the base frontend (see Phase 3).
- AC2 (markdown-only unchanged): covered by e2e (cold open, and the fed->md switch) and by unit tests. My own probe
  measured markdown-only placeholder and card tops at 128px on both HEAD and base, with CLS 0.
- AC3 (schema and contract in the same change): `schemas/dashboards/dashboard.schema.json` declares the optional
  boolean, `helio-mcp/src/types.ts` adds it, `DashboardProtocol` moves to `jsonFormat9`, and `check:schemas` passes.
- tasks.md: every item is ticked and matches the diff. design.md D1-D4 match what was built: one batched query, a
  list-route-only method, `withKnownFlag` at every replace site, `panelsSettledFor`/`panelsKnownFor`, and the sync hook.
- Constraints:
  - C4: no HEL-1668 (pipelines) or HEL-1665 (home) files are touched.
  - C4: desktop is unchanged. At 1280 in both themes, grid-item and `main` boxes are byte-identical between HEAD and
    base, and the refresh line is absent.
  - C5: `DashboardRefreshLine` and `usePipelineFedFlagSync` both use `panelsKnownFor`, and `App.tsx` keeps
    `panelsSettledFor`.
  - C5: the e2e switch-back case really goes through the slowed fetch. The delete-last reopen logged `fetches:1`.
- `openspec validate --strict`: valid. OpenSpec hygiene check: clean.
- No scope creep. The one change outside the plan is `feedingOutputIds` tolerating a panel with no config (see
  Suggestions). It does not change behaviour for well-formed panels.

### Phase 2: Code Review — PASS

Gates, all run fresh in WORKTREE_PATH (CLEAN_WORKTREE not set):

- `npm run lint`: clean, zero warnings.
- `npm run format:check`: clean.
- `npm run typecheck`: clean.
- `npm run check:schemas`: in sync.
- `npm test` (`HELIO_JEST_MAX_WORKERS=2`, nice 19): exit 0. Root: 61 suites, 524 tests. Frontend: 726 suites, 9102
  tests. All passed.
- `npm --prefix frontend run build`: success.
- `sbt -J-Xmx3g testFull` (under the sbtfull lock): exit 0, 9203 succeeded, 0 failed. This includes
  `DashboardPipelineFedFlagSpec` on the NOBYPASSRLS app pool.

Review findings:

- Backend:
  - `pipelineFedDashboardIds` is a single `inSet` query per page under `withUserContext` (RLS applies), and returns
    early on an empty page.
  - `findAll` is owner-only, so no shared dashboard reaches the list and no grantee panel-visibility question arises.
  - No inline FQNs. IDs stay value classes.
- Frontend:
  - `withKnownFlag` is applied at upsert, rename, appearance, layout (both branches plus `keepLocalLayout`) and repair.
  - `fetchDashboards.fulfilled` overwrites the flag from the wire, as designed.
  - The effect cannot write `false` for a dashboard whose panels are not yet known, and unit tests cover that.
- Tests are meaningful. Unit tests cover:
  - the pre-dispatch switch frame;
  - the restore path;
  - settled-empty and stale-empty states;
  - a failed fetch.

  The e2e spec is red on base (verified).
- No dead code, no TODO/FIXME, no `any`.

### Phase 3: UI Review — PASS

Servers: HEAD on 7078/9985 via `start-servers.sh` (PASS servers). A throwaway detached worktree at the base commit
ran on 7079/9986, also via `start-servers.sh`. It was stopped with `stop-servers.sh` and removed afterwards.

1. **Targeted e2e on HEAD.** I ran `hel1646-skeleton-refresh-slot`, `hel1583-refresh-line-no-shift` and
   `hel1583-mobile-dashboard` (2 workers, nice 19, e2e lock, trace retain-on-failure): 39/39 passed.
   - Pipeline-fed, at 375 and 430, light and dark: placeholder 155 equals card 155, chip row 103, layout-shift total 0.
   - Markdown-only: 128 equals 128, no slot in any frame.
   - Switch md->fed: 155 equals 155.
   - Switch fed->md: 128, no slot.

   Evidence ref: `/home/matt/Development/helio/.concertino/runs/HEL-1646/evidence/.concertino/scratch/HEL-1646/eval-c1-e2e-targeted.log`.
2. **Red first, verified.** The same spec against the base frontend and backend failed all 4 pipeline-fed cases on "a
   slot exists in every skeleton frame": skeleton at 128, real card at 155, a 27px jump. All 4 markdown-only cases
   passed. This confirms the executor's 128 vs 155 claim.

   Evidence ref: `.../eval-c1-e2e-red-baseline.log` (same evidence directory).
3. **Independent probe (my own spec, not the executor's).** It samples, per animation frame, the layout top of the
   first item (offsetParent rect plus offsetTop), sums a `PerformanceObserver('layout-shift')`, and uses a 2.5s
   panels delay. Results for 375 and 430, light and dark:

   | Run | Dashboard | Placeholder / card tops | CLS |
   |---|---|---|---|
   | HEAD | pipeline-fed | 155.2 / 155.2, no jump | 0 |
   | HEAD | markdown-only | 128 / 128 | 0 |
   | Base | pipeline-fed | skeleton moved 128 -> 155.2 | 0.0256-0.0257 |

   Evidence refs: `.../eval-c1-{head,base}-phone-{375,430}-{light,dark}.json`.
4. **Desktop 1280, light and dark.** Measured boxes are identical between HEAD and base, and there is no refresh-line
   element. Refs: `.../eval-c1-{head,base}-desktop-{light,dark}.json`.
5. **Visual comparison against the running app.**
   - Dark 375: on HEAD the empty slot sits above the chips and the placeholders land where the cards land. Base
     shows the placeholders 27px higher.
   - Light 430: the fed skeleton has the slot and the markdown-only skeleton has none.

   Refs: `.../eval-c1-head-fed-skeleton-375-dark.png`, `.../eval-c1-base-fed-skeleton-375-dark.png`,
   `.../eval-c1-head-fed-loaded-375-dark.png`, `.../eval-c1-head-fed-skeleton-430-light.png`,
   `.../eval-c1-head-md-skeleton-430-light.png`. All screenshots are in
   `/home/matt/Development/helio/.concertino/scratch/HEL-1646/eval-c1-*`.
6. **Console.** The only errors are two `401` resource loads before login. They appear identically on base, so they
   are not attributable to this change. There were no pageerrors.
7. **Accessibility and design.** The reserved element is the existing `aria-hidden` empty `<p>` (unchanged markup and
   CSS). No new tokens or components, so there are no DESIGN.md mechanical findings.

Evidence soundness: every claim above rests on content (pixel tops, CLS sums, test output). None rests on mtime or
ordering.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- `frontend/src/features/panels/state/dashboardMeta.ts:38-45`: `feedingOutputIds` now casts `panel.config` to
  `{ outputId?: string } | undefined` because the sync hook runs on every `PanelList` render. A panel without a config
  can only come from hand-built test fixtures that violate the `Panel` type, for example
  `PanelList.onboarding.test.tsx:299`; the server always sends a config. It is behaviour-neutral for real data, but it
  widens production code to suit malformed fixtures. A follow-up could give those fixtures a `config` and drop the
  cast.
- `frontend/src/app/dashboardMeta/DashboardRefreshLine.tsx:45-53`: `panelsKnownFor` is evaluated in two separate
  selectors. Deriving `panels` from the `panelsKnown` boolean would remove the duplication.
- `frontend/src/features/dashboards/state/dashboardsSlice.ts` (564 lines) and `PanelList.tsx` (543 lines) were already
  over CONTRIBUTING's ~400-line split threshold before this change, and this change adds to them. Per CONTRIBUTING,
  propose a split in the PR description.
- My targeted e2e run overwrote the worktree-local, gitignored `e2e-evidence/HEL-1646/*.png` with fresh HEAD captures.
  The content is the same kind of evidence, but the executor's originals should be read from the scratch directory if
  needed.

Test data: every throwaway user from my runs was deleted by exact recorded id by the HEL-1301 global teardown: 39
(targeted), 8 (red baseline), 6 (probe on HEAD) and 6 (probe on base). Their seeded dashboards, pipelines and sources
are owned by those users.
