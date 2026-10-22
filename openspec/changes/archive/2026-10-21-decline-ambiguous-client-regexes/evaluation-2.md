## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `a5e79b981` (cycle-2 delta over `e872cf975`: `e2e/hel1683-regex-main-thread.spec.ts`,
`javaRegex.test.ts` +7 lines, evidence/report files). Base resolved live: `4f729eed7`.

### Phase 1: Spec Review — PASS
Issues: none new. The cycle-2 delta changes only the test harness. `javaRegex.ts`, `javaRegexCost.ts` and `javaRegexSets.ts` are
unchanged since cycle 1, so the cycle-1 D2 verification still holds. The new dot-run boundary test (`.*....` accepted,
`.*.....` declined, `.*.{4}` / `.*.{5}`) closes cycle 1's D4 suggestion. Its arithmetic is right: an unfenced `.*`
followed by four or five dot atoms gives a tail weight of 4 or 5 against the cap of 4.

### Phase 2: Code Review — FAIL
Gates, run fresh (load < 3):
- `npm run lint`: exit 0.
- `format:check`: clean.
- `npm run typecheck`: exit 0.
- `npm run check:e2e-types`: exit 0.
- `HELIO_JEST_MAX_WORKERS=2 npm test`: root 524 tests passed; frontend 9340 tests passed (one more than cycle 1).
- `npm --prefix frontend run build`: OK.

e2e under the e2e lock:
- 3 sequential runs with `--workers=1`: 3/3 passed, about 11.7 s each.
- `--repeat-each=6 --workers=2`: 6/6 passed (36.7 s).
- Every probe's longest main-thread task was 0.0 ms, and every probe sent a draft-preview request.

How I checked the executor's cycle-2 claims:

1. **Red is still provable with 2 rows: CONFIRMED.**
   - In the dev app's Chromium (the same engine Playwright uses), the base tree's translated regex for
     `^(.*.*.*.*.*.*.*.*x)` took 364, 368 and 367 ms over two cells, each on a freshly compiled RegExp. A `longtask`
     PerformanceObserver recorded each run as one long task (363, 367, 366 ms), about 3.6x the 100 ms bound.
   - Once V8 has warmed the regex up, two cells cost 113-126 ms, which is only just over the bound. The red therefore relies
     on the probe pattern being compiled fresh in the window. That is true by construction: it is entered once, in one `fill`,
     and the page has never seen it before.
   - This is consistent with the executor's 494.0 ms.
2. **The new control is not vacuous: CONFIRMED.**
   - The saved `(x)` yields an empty `out`. The control `(a+)!` yields `"a"x28`, asserted with `exact: true`, and the source
     cell `"a"x28+"!"` cannot match that.
   - Together with the no-draft-preview-request assertion, this proves the client computed the value inside the window.
   - The control's 0.0 ms long-task reading does not by itself prove the observer works. Red does that, and item 1 corroborates it.
3. **Server-timing margin: real on this machine, not proven for CI.** Fresh `POST /api/pipelines/:id/run` timings from the dev
   backend, probe pattern, quiet machine, three runs each:

   | Rows | Run times (s) | Per run |
   | --- | --- | --- |
   | 1 | 0.386, 0.362, 0.367 | |
   | 2 | 0.653, 0.694, 0.681 | about 0.31 s per cell |
   | 5 | 1.596, 1.577, 1.626 | |

   The executor's root cause is confirmed: 5 cells use 79% of the 2 s step budget. Two cells use about 33%, so there is about
   3x headroom when the machine is quiet. But the orchestrator's full local run already pushed the 5-row step past 2 s, a
   slowdown of at least 1.27x. CI runs this spec on `ubuntu-latest` (`.github/workflows/ci.yml`) and has not measured it.
   There, slower cores plus Chromium, Vite, the JVM and Postgres sharing 4 vCPUs could plausibly multiply that, which would
   put two cells within reach of the budget. See Change Request 1.
4. **Overrun edit: not timing-fragile in the dangerous direction.**
   - Raw `java.util.regex`, with no time box, on `^(a*a*a*a*a*a*a*a*a*a*)$` over one `"a"x28+"!"` cell took 2.618, 2.597 and
     3.014 s. That is already over the budget before the time-box wrapper adds its overhead.
   - The wrapper's overhead is about 3x, judging from the probe pattern: 0.107 s raw versus about 0.31 s in the server.
   - Load and slower hardware only push the overrun further over the budget. The 30 s visibility timeout is ample.
5. **Other timing waits in the spec:**
   - The control's `waitForTimeout(1500)` (line 125) can only cause a false pass, not a flake.
   - The probe's `waitForTimeout(3000)` (line 144) needs the debounced draft-preview request to be issued within 3 s. It always
     was in 9/9 runs.
   - A `429` from `DRAFT_PREVIEW_MAX_IN_FLIGHT` is retried by `draftPreviewScheduler.ts`, so it is not a failure path.

### Phase 3: UI Review — PASS
No UI code changed this cycle. The e2e runs above exercised the control, probe and overrun flows: the server result showed,
the server time-budget error showed, and no long tasks were recorded. A manual Chromium pass on 7115/10022 covered the
red-timing check. Cycle 1's manual UI pass still applies.

Test data from this cycle was deleted by exact id:
- 3 pipelines via API (204 each): 6dacdce7-da6f-4714-bea1-4a585ca20acb, cf556db2-94f5-4b9e-9229-9ae0525e53cd,
  a88eefe5-60f9-4075-8409-b5f7bc205a5d.
- 3 sources via API (204 each): 820bfede-939c-435c-a153-cd2371053ece, 24864ac5-9b06-44cf-9eff-1eb83962f042,
  ba6c23b0-9432-46ef-94fd-8aff3ef611ae.
- User 2795f693-861a-4cbb-abf5-3417a2f3ad24, via `buildUserDeleteSql` with the exact id and email.
- The e2e users were removed by the run's global teardown.

### Overall: FAIL

### Change Requests
1. `e2e/hel1683-regex-main-thread.spec.ts:160-161`: make the probe's server-outcome assertion independent of how fast the server
   is. The assertion is currently `getByLabel("Preview is live")` followed by `rows.getByText("2 rows")`. That passes only if
   the Scala engine finishes the probe inside the 2 s step budget, which is exactly the coupling that failed in cycle 1's full
   run. Moving from 5 rows to 2 widened the local margin to about 3x but did not remove the dependency, and the spec runs in
   CI on unmeasured `ubuntu-latest` hardware.

   The required change: once the existing draft-preview-request assertion (lines 155-158) has passed, assert that the step shows
   **either** of the server's two possible results for this pattern:
   - the server rows: "Preview is live" plus "2 rows", or
   - the server time-budget step error (`/exceeded the 2 s regex time budget for this step/`).

   For example, use `expect(liveLocator.or(budgetErrorLocator).first()).toBeVisible({ timeout: 10_000 })`, then branch on which
   one is visible. Both outcomes are "the server result for that step", which is what design D5a asks for, so this does not
   weaken the AC1 proof. AC1 is proved by the long-task assertion and the request assertion.

   Keep the 2 rows: red still has about 3.6x margin in Chromium (item 1 above). Record the change in `evidence/cycle2-flake.md`.

### Non-blocking Suggestions
- Lines 160-161 cannot tell the server's probe result apart from stale state: the saved `(x)` and the probe both give a null
  `out`. If you touch these lines for CR1, consider asserting on a server-specific signal, for example waiting for the
  draft-preview response before reading the status.
- The comment at line 9 says "~165 ms per cell". I measured about 180 ms per cell cold and about 60 ms warm in Chromium. The
  number matters less than the fact that the red relies on a fresh compile, so consider stating that dependency in the comment.

### Critical Path
Not final cycle (2 of 3): not required.
