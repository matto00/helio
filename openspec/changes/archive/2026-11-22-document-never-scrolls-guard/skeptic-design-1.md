## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD c405b68179c46b59e3f7f06940e3acc5d2031999 (worktree on `bug/document-never-scrolls-guard/HEL-1585`, equal to main).

### What I verified (with evidence)
- Spawn-cwd guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/document-never-scrolls-guard/HEL-1585`.
- Route list (D3) vs `frontend/src/app/AppRoutes.tsx`: the `ProtectedRoute` block has 16 `path="..."` literals: `/connect/mcp` (outside `AppShell`), plus `/home`, `/dashboards`, `/dashboards/:id`, `/sources`, `/sources/:id`, `/pipelines`, `/pipelines/:id`, `/connectors`, `/chat`, `/settings`, `/admin/usage` (wrapped in `OwnerOnly fallback={<NotFoundPage/>}`), `/proposals/review`, `/patch-sets/review`, `/pipeline-proposals/review`, `/combined-proposals/review`. D3's list covers all 16. The `>= 15 paths` floor is consistent. The spec's scope ("inside AppShell, plus /connect/mcp") matches the `ProtectedRoute` block exactly.
- Shell structure claims: `frontend/src/app/App.css:6-23` `.app-shell` is a grid with `height: 100vh; height: 100dvh`, `grid-template-rows: auto minmax(0, 1fr)` (and `auto auto minmax(0,1fr)` for `.app-shell--tabs`, line 302). theme.css:524-525 has `min-height: 100vh/100dvh`. Mutation (a), `height` -> `min-height`, is a plausible red-maker: the grid would size to its content.
- Existing coverage claim: `e2e/hel1579-pipeline-spine-layout.spec.ts:168-202` asserts `scrollHeight <= innerHeight` on `/pipelines/:id` only, with a short seeded pipeline. Confirmed.
- Helpers exist: `e2e/support/evidencePath.ts` (it accepts any `[A-Za-z0-9._-]+` filename, so JSON works), `e2e/support/auth.ts`, `e2e/support/apiRequestCounter.ts` (HEL-1620), `frontend/src/app/App.css.test.ts`, and the `check:e2e-*` scripts in root `package.json`.
- Playwright config: `fullyParallel: false` (line 191), so tests in one file run serially in one worker and a `beforeAll`-shared user works. Default `timeout: 30_000` (line 189).
- No per-user pipeline-count or step-count cap in `backend/src/main/scala`: the only caps are Home's display `MaxPipelines = 8` and the draft preview's `MaxSteps = 50`. Seeding 32 pipelines and 20 steps is feasible.
- Scope: the ACs map to tasks. AC1 maps to D1 and task 1.2. AC2 maps to D3/D4 and tasks 1.1 and 4.1 (CI cost). AC3 maps to the D4 wheel check. AC4 maps to D6 and task 3.2. No Playwright config edit is planned (HEL-1816 is respected). No contract change is needed.

### Verdict: REFUTE

The plan is close. But as written the guard can pass vacuously, and the design budgets the rate limiter only for seeding. Under this plan's own conditions, the failure mode most likely to make the guard pass vacuously (429s producing short error states) gets no assertion.

### Change Requests
1. **Budget the route-visit traffic against the per-user rate limiter, not only the seed (D2/D4).** D2 measures only the seed's request count. But D4 has one user visit 17 routes at each of two viewports. If each route is a `page.goto`, that is a full app reload each time, with session, preferences, list and summary fetches, draft-preview and sample calls on the pipeline pages, and so on. The two tests share one user per D2, and serially they land in the same 60 s window. That can plausibly exceed `RATE_LIMIT_REQUESTS_PER_WINDOW` (120). A 429 on, for example, the pipelines list renders a short error or empty state, and the guard then passes on exactly the long-content condition it exists to test. Required: attach `attachApiRequestCounter` before `registerAndLogin`, as `hel1632-live-output.spec.ts:203-214` does. Assert `count429 === 0` and `maxWindow <= MAX_WINDOW_TARGET` (90) per test. State in the design how the budget is met: client-side navigation instead of `page.goto`, a separate seeded user per viewport test, or both. The measured `maxWindow` goes into `evidence/ci-cost.txt`.
2. **Add precondition assertions so the guard cannot pass vacuously (D2/D4).** D2 says the long step list must be "enough that the spine overflows 900px", but nothing asserts it. Required: before the document measurement on each route that depends on the seed, assert the condition that makes the check meaningful, and fail loudly naming the route if it is missing:
   - the Pipelines context list renders at least 30 items;
   - on the long pipeline, the inner scroll region's `scrollHeight > clientHeight` at both viewports, so content really overflows and the document stays put only because the shell bounds it;
   - `/dashboards/:id` renders the seeded panels.
   Add this to D4 and to the spec scenario's WHEN clause ("...and the long content is actually rendered and overflows its region").
3. **State the test timeout explicitly (D7).** The config default is `timeout: 30_000`. D7's "under 60 s per test" target cannot hold under that default with 32-pipeline seeding plus 17 routes, so the design must name the `test.setTimeout(...)` value and why. Precedent: `hel1632-live-output.spec.ts:201` uses 150 s. Otherwise the executor will discover it as a red run and guess a value.

### Non-blocking notes
- D1: the red-first run happens on unmodified `main`. The branch currently equals main (c405b6817), so this is fine. Say so in the evidence file.
- D3: `/connect/mcp` with no `?request=` param returns early (`ConnectMcpPage.tsx:52`). Its ready landmark should be whatever that early state renders. Name it in the spec, not a consent-form element.
- D5(a): require the mutation run to go red on the long `/pipelines/:id` route specifically, named in the output, not merely "on the long-content routes". That ties the mutation to the seed precondition in CR2.
- D4: rendering a dashboard tab may switch the shell to `.app-shell--tabs` (three rows) on later routes. That is legitimate shell coverage. Record in the evidence JSON whether the tab bar was present per route, so a later reader can tell the two shell layouts apart.
