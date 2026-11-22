## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `0e221534756010f25daa4ec1a15c5a0cdbb72802` against the live-resolved base `c405b68179c46b59e3f7f06940e3acc5d2031999`.
Changed files: `e2e/hel1585-document-never-scrolls.spec.ts` plus `openspec/changes/document-never-scrolls-guard/**`. No
`frontend/**`, `backend/**`, `playwright.config.ts` or `e2e/shard-weights.tsv` change (checked by `git diff --name-only`).

### Phase 1: Spec Review — FAIL

- AC1 (reproduce or rule out): addressed. Per-route numbers for 17 route visits at both viewports are in
  `evidence/red-run-main.txt` and `evidence/main-run-long-dashboards.txt`. The "30+ item context-list pipeline list" became
  "32 pipelines on the overview + 32 dashboards in the Dashboards context list" (design D4b, tasks 3b.1). I checked the
  premise: `MAX_ROWS = 8` at `frontend/src/app/shell/ScheduledContextList.tsx:18`, applied at :134 and :153. The
  amendment is recorded in the plan and still seeds 32 pipelines. Accepted.
- AC2 (guard on every authenticated route, CI cost stated): addressed (`evidence/ci-cost.txt`).
- AC3 (wheel): addressed. Evidence shows `innerRegion: aside.spine-body__spine`, `innerScrollTop: 600`, `scrollY: 0`.
- AC4 (offenders listed): `evidence/offenders.md` says none.
- `workflow-state.md` CONSTRAINTS is `[]`, so nothing to honor.
- **Issue: task 3.1 is ticked but was not done.** `tasks.md` 3.1 ("Shell-level cause: smallest fix ... commit the green
  run as `evidence/green-run.txt`") is `[x]`. No fix exists and `evidence/green-run.txt` does not exist. The branch was
  not applicable, so the box is a false completion claim in an artifact that gets archived. See CR1.

### Phase 2: Code Review — FAIL

I ran these gates myself in `WORKTREE_PATH`. All exited 0.
- `npm run lint`: 0 warnings.
- `npm run format:check`: clean.
- `npm run check:e2e-types`: clean.
- `npm run check:e2e-evidence-paths`: clean, 219 files.
- `npm run check:e2e-user-cleanup`: clean, 219 files.

Full-file run of the spec on the lane servers (DB `helio_hel1585`, `ANTHROPIC_API_KEY` empty, worker cap 2): 4 passed in
24.5 s. At 1440x900: 72 /api requests, maxWindow 72, 0 x 429. At 1280x800: 74 /api requests, maxWindow 74, 0 x 429.
Teardown deleted the 3 recorded users. No frontend/backend files changed, so jest, the frontend build and
`sbt testFull` were not triggered.

Things checked specifically:
- **Non-vacuity preconditions.** Each one is real and runs before the measurement:
  - Dashboards context list has 30 or more `li` rows (measured 32).
  - Panel count equals 3.
  - `/pipelines` lists 32 or more links.
  - Spine row counts are 24 and 2.
  - The long pipeline's inner region overflows (`scrollHeight=1904 clientHeight=763`). The soft assert, plus a wheel
    result of `{}`, makes `toMatchObject` fail when the region is missing.
- **Error-state selector.** The spec's probe test proves the selector matches a real 500 on `/sources`. I also checked
  that the tour's timing would catch one: the tour counts immediately after the shell heading and two animation frames,
  with no auto-wait. I ran a scratch probe that copies that timing with forced 500s on `/sources`, `/connectors` and
  `/settings`. The tour-timing count was 3, 3 and 1, the same as after waiting 3 s. One caveat: the `/connectors` and
  `/settings` counts may include alerts left over from the earlier `/sources` 500, so only the `/sources` result cleanly
  confirms the timing. Output: `/home/matt/Development/helio/.concertino/scratch/HEL-1585/eval/probe/probe-run.txt`
  (scratch, not persisted). Its one throwaway user was deleted by the registry teardown.
- **AppRoutes check is failable.** `evidence/mutation-route-list.txt` shows red naming `/connectors`. The slice runs from
  `<ProtectedRoute />` to `path="*"` (`frontend/src/app/AppRoutes.tsx:112-170`) and covers every protected path,
  including `/connect/mcp` and the multi-line `/admin/usage`. It also has a floor of at least 15 literals.
- **Mutations really went red.** `evidence/mutation-shell-height-long-dashboards.txt` fails 2 tests. The long
  `/pipelines/:id` is named at both viewports (scrollHeight 2041 > 900 / 800).
- **Rate-limit and PAT keying.**
  - `afterEach` asserts `count429 === 0` and `maxWindow <= MAX_WINDOW_TARGET`.
  - Every seed call asserts a status below 300, so a 429 during the seed fails too.
  - Keying is confirmed in `backend/src/main/scala/com/helio/api/http/RateLimitDirective.scala:69-80`: a cookie
    resolves to `user:<id>`, and a request with no cookie and a Bearer PAT resolves to `pat:<tokenId>`.
  - The seed context comes from `request.newContext` with no storage state, so it carries no cookie.
- **Evidence and cleanup rules.** The measurements JSON goes through `evidencePath("HEL-1585", ...)`. Users come from
  `registerAndLogin`, which uses the registry, and the minted PAT goes with the user.
- **Dead code (CR2).** `waitReady(page, s, route)` at `e2e/hel1585-document-never-scrolls.spec.ts:260` never uses
  `s`. Lint passes because args are not checked, but CONTRIBUTING's no-dead-code rule still applies.

### Phase 3: UI Review — N/A

No trigger path changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). The change's own
`specs/` delta is under `openspec/changes/`. The guard itself was exercised against the running app in Phase 2.
Servers I started were PIDs 3499964 (backend) and 3500958 (frontend). Both were stopped with `stop-servers.sh`.

### Overall: FAIL

### Change Requests
1. `openspec/changes/document-never-scrolls-guard/tasks.md` task 3.1: it is `[x]` but no shell fix was made and
   `evidence/green-run.txt` does not exist. Reword it as not applicable, for example
   `- [x] 3.1 N/A: no offenders on main (evidence/offenders.md), so no shell fix and no green-run.txt`, so the archived
   task list matches what was implemented.
2. `e2e/hel1585-document-never-scrolls.spec.ts:260`: remove the unused `s: Seeded` parameter from `waitReady`, and drop
   the argument at its call site (line 352).

### Non-blocking Suggestions
- `wheelOverSpine` (:415) uses the selector `.app-header, header`. No `.app-header` exists in `frontend/src`, so it
  matches the first `<header>`. Use `.app-command-bar` (`frontend/src/app/CommandBar.tsx:128`) so "command bar did not
  move" is about the command bar by construction.
- `tallestOverflower` names `div.sr-only` or `span.motion-indicator.app-rail__indicator` in the mutation runs. These
  are absolutely positioned helpers, not the culprit. Skipping `.sr-only` and `position: absolute/fixed` elements would
  make the red message point at the real overflowing element.
- `seed` (:106-110) accepts both `T[]` and `{items}` for `GET /api/pipelines/:id/outputs`. Pin the one real shape.
- Routes with no seed precondition (`/home`, `/sources`, `/connectors`, `/chat`, `/settings`, the review pages) wait
  only for the shell's sr-only `<h1>`, which is set from the pathname. D4 asked for a visible landmark specific to the
  route. Per the probe this is adequate today, but a page-content landmark would make the measurement independent of
  fetch timing.
- The file is 505 lines, over CONTRIBUTING's ~400-line "propose a split" line. Mention it in the PR description.
