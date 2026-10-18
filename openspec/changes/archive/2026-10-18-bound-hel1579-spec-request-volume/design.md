## Context

See proposal.md for the motivation. Facts that shape the approach:

- **The limiter.** It is keyed by session user id, uses a fixed 60 s window, and allows 120 requests by default (`RATE_LIMIT_REQUESTS_PER_WINDOW`). It is per instance, and the e2e backend is one instance. The seeding `page.request` calls share the browser context's session cookie, so they count against the same user as the page's own requests.
- **Static request map.** This comes from a code read, not a trace, so it must be confirmed live.
  - Each full load of `/pipelines/:id` costs about 8 page requests (pipeline, steps, analyze, schedule, outputs, data-sources, a source sample per root, and one preview for the default step), plus about 4 to 6 shell requests (auth/me, dashboards, a selected dashboard's panels, pipeline-schedules, pipelines, dashboard-changes).
  - Each spine-row click costs one `GET /api/pipelines/:id/steps/:stepId/preview`.
- **The accent audit's cost.**
  - Seeding (`manyKinds` plus a branch) is about 22 POSTs, plus registration and login.
  - The audit then runs four `page.goto` calls, and on each one clicks every spine row (about 19).
  - Estimate: 25 + 4 x (13 + 19) ≈ 150 requests in about 58 s.
- **The per-selection preview fetch is specified behaviour.** `pipeline-detail-spine-layout` D8 says "a settled response is never reused, so every selection ... fetches fresh". Caching previews would change a spec requirement and is out of scope for this bug.
- **Other heavy tests.** The 820/900/1100 and 769-1100 sweep tests in the same file also reload repeatedly with one user, so they are measured too.

## Goals / Non-Goals

**Goals**
- A measured per-user `/api` count and worst 60 s window for every test in the spec, both before and after the change.
- Every test's worst window is at or below 90 per user, leaving at least a quarter of the limit as margin.
- Zero 429s across 10 consecutive runs.
- The accent audit keeps its full coverage: every seeded step kind, both themes, both accent presets, and the tab-focus check.

**Non-Goals**
- Changing the rate limit, its configuration, or exempting or re-keying test users.
- Caching step previews or otherwise changing D8's fresh-on-selection contract.
- Fixing other specs. Any other spec found near the limit is listed as a follow-up candidate and not fixed here.

## Decisions

**D1. Measure first: the systematic-debugging law.**
- Add a small helper, `e2e/support/apiRequestCounter.ts`. It attaches a `page.on("response")` listener and records the timestamp, method, path template and status of every `/api` response the page context sees, including `page.request` calls.
  - Before writing it, verify whether `page.request` traffic fires `page.on("response")`. If it does not, count `page.request` calls separately in `seedPipeline`. The counter must cover everything the limiter counts for that user.
  - The helper's job is to compute the total count, the maximum number of requests in any sliding 60 s window, the 429 count, and a top-N breakdown by path template.
- Run the unmodified spec locally with the counter wired in temporarily, to produce the red evidence: a window over 120, or observed 429s. If the local machine is too fast to exceed the window in under 60 s, use the max-window figure together with an observed 429.
  - If neither 429s nor more than 120 requests in a window can be reproduced locally, say so plainly and use observed CI evidence (429s in a CI trace/log). Arithmetic on a total count is never red evidence (design-gate note 1).
  - The counter attaches before `registerAndLogin`, so it also captures the post-login `/home` page's requests that fire during seeding. It counts requests (`page.on("request")`) as well as responses, so aborted or in-flight requests are not missed. Align it with the inline counter in `e2e/hel1392-remount-request-burst.spec.ts` (design-gate notes 2, 4, 5).
- Write the breakdown to the change directory as `measurements.md`.
- Alternative considered: estimating the count by reading code. Rejected, because the law requires a probe-confirmed root cause, and the static map above is only a hypothesis.

**D2. Decision rule: product fix or test fix.**
- From the D1 breakdown, a request is a **product defect** only if one of these holds:
  - it is issued twice for the same data within one load;
  - it refetches data unchanged since the last fetch, with no spec requirement asking for freshness;
  - it fires on a route where nothing renders its result.
- A product defect found this way is fixed, preferring that path as the ticket asks, provided the fix:
  - changes no spec requirement (otherwise stop and re-plan);
  - is covered by a unit test that fails before the fix and passes after;
  - stays out of files the HEL-1630 lane is editing. Check this against open PRs and branches (`gh pr list`) and report any overlap in `measurements.md` and the hand-back.
- The per-selection preview GET (D8) is never treated as a defect.
- Candidates to check live, from the static read:
  - `ScheduledContextList` dispatching `fetchScheduledItems` on every mount with no guard;
  - the selected dashboard's panels fetched on `/pipelines/:id`.

**D3. Test restructure: the expected main fix.**
- The dominant cost is 4 loads x about 19 preview GETs, all charged to one user.
- Split the accent audit into one test per theme/accent pair. That gives four tests, generated from a loop over the pairs. Each test:
  - registers its own fresh user, using the existing `registerAndLogin`, unique label per pair;
  - seeds its own pipeline;
  - performs exactly one `page.goto`;
  - keeps the identical per-row audit and tab-focus assertion.
- Expected cost per user: about 25 seed + about 13 load + about 19 clicks ≈ 57, inside the ≤ 90 goal.
- Alternatives considered:
  - **(a) Switch theme and accent in-page, without reloading.** This needs a product hook or a localStorage event that the theme provider may not honour, and it changes what is under test.
  - **(b) Audit fewer rows.** This loses coverage.
  - **(c) Throttle with waits until the window rolls over.** This adds time and is still fragile. It is a timing workaround, not a structural fix.
- Splitting also shortens each test from about 58 s to about 15 s, which improves shard balance.
- **Other over-budget tests.** Any other test in the file whose D1 window exceeds 90 is restructured the same way (fresh user per block), or has its reload count reduced where the reload is not what is being tested.

**D4. Durable guard.**
- Every test in the spec wires the counter, through a `test.beforeEach`/`afterEach` or a fixture, and asserts at the end that:
  - zero 429s were observed;
  - the max 60 s window is ≤ 90.
- The assertion message prints the top-N breakdown.
- This is a guard, so it must be shown failable. Mutation check: temporarily revert the split (or lower the threshold below the measured value) and observe the guard fail with the count message, then restore. Record the transcript in `measurements.md`.

## Risks / Trade-offs

- [Local runs are faster than CI, so a local count under 120 per window may hide CI pressure] → The guard measures the count of requests, not their rate. The ≤ 90 threshold applies to the max window, and the total per user is also reported. Because CI is slower, the same number of requests spreads over more time on CI, so the local window is the worst case.
- [Four seeds instead of one add CI time] → About 3 x 3 s. Offset by shorter individual tests. The leg's total time is reported, given the 18-minute cap.
- [`page.on("response")` may miss `page.request` traffic] → Verified explicitly in D1. If it is missed, it is counted at the call site.
- [The spec is shared with in-flight lanes (HEL-1582 adds phone specs, but in other files)] → Re-check `gh pr diff` for edits to this file before delivery.
