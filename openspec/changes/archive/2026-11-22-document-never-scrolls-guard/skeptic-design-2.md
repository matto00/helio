## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD c405b68179c46b59e3f7f06940e3acc5d2031999 (the branch equals main; the change dir is untracked planning work only).

### What I verified (with evidence)
- Spawn-cwd guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/document-never-scrolls-guard/HEL-1585`.
- Round-1 CR1 (rate-limit budget): this round adds D4a, with one user per viewport test, client-side navigation and the counter attached before `registerAndLogin`. That part is addressed. But see CR1 below: the arithmetic D4a asserts rests on a false claim about the counter.
- Round-1 CR2 (non-vacuous preconditions): D4b adds the 30+ context items, the long pipeline's inner region `scrollHeight > clientHeight` at both viewports, the seeded panel count, a no-error-state check and `count429 === 0`. The spec scenario's WHEN clause carries them. Addressed.
- Round-1 CR3 (timeout): D7 sets `test.setTimeout(150_000)`. The precedent is `e2e/hel1632-live-output.spec.ts:201`, and I confirmed `test.setTimeout(150_000)` is there. Addressed.
- Round-1 notes: all four are folded in. D1 states the main SHA, D4 covers the `/connect/mcp` early-return landmark, D5(a) requires the long `/pipelines/:id` route to be named, and the evidence JSON records tab-bar presence.
- Route list (D3) against `frontend/src/app/AppRoutes.tsx:113-160`. `ProtectedRoute` wraps `/connect/mcp` (outside `AppShell`) plus 15 shell routes, 16 `path=` literals in total. D3's list covers all 16. The public routes `/dashboards/:dashboardId/panels` and `/connectors/complete` (lines 104 and 109) are outside `ProtectedRoute` and correctly excluded. `path="/admin/usage"` sits on its own line but is still a `path="..."` literal the D3 regex matches.
- Single-call seed (D2): `schemas/pipelines/create-pipeline-request.schema.json` has properties `name, roots, tag, steps, outputs` (required `name, roots`). Inline steps and outputs are supported, so one pipeline costs one request.
- Context list: `frontend/src/features/pipelines/services/pipelineService.ts` sends no `limit`/`offset`/page-size. A 32-pipeline list is not paginated away.
- Per-user limit is 120 per 60 s (`RateLimitConfig.scala:18`, default; `e2e/support/apiRequestCounter.ts:11-12` has `RATE_LIMIT = 120`, `MAX_WINDOW_TARGET = 90`).
- **The counter already counts the seed calls.** `e2e/support/apiRequestCounter.ts:80-101`: `attachApiRequestCounter` records the page's own traffic and also wraps `page.request.fetch`. Its header comment (lines 5-7) says "the seeding calls by wrapping the `page.request` methods". The `hel1632` precedent asserts `maxWindow <= MAX_WINDOW_TARGET` alone (lines 204-213), with no added seed term.
- Scope and AC mapping are unchanged from round 1 and still complete: AC1 maps to D1 and 1.2, AC2 to D3/D4/D7 and 4.1, AC3 to the D4 wheel check, AC4 to D6 and 3.x. No Playwright config edit is planned (HEL-1816 is respected). No contract change is needed.

### Verdict: REFUTE

One blocking defect. D4a's budget assertion is built on a factually wrong premise about the tooling. Followed literally, it double-counts the seed and very likely goes red on a correct guard. The design's only permitted remedy (reduce the seed) cannot get below the 30+ pipelines the ticket requires.

### Change Requests
1. **Fix D4a's budget assertion. It double-counts the seed (design.md D4a, tasks.md 1.1 and 4.1).** D4a says the seed's `page.request` calls "are not seen by the browser-request counter", so it asserts `seedRequests + maxWindow <= 90`. That claim is false: `attachApiRequestCounter` wraps `page.request.fetch` (`e2e/support/apiRequestCounter.ts:89-99`), so `maxWindow` already includes every seed call made in that window.

   Rough sizing shows why this matters. The seed is about 1 source, 32 pipelines, 1 dashboard and its panels, so around 37 requests or more. It runs seconds before the client-side route tour, inside the same 60 s window. `maxWindow` then holds those ~37 plus boot and route traffic, and adding `seedRequests` charges the ~37 a second time. The ~37 seed requests then consume most of the 90 target before any browser traffic is counted. D4a and D7's only remedy, "reduce the seed's request count", cannot drop below the 30+ pipelines AC1 requires, and sleeping is forbidden. The executor is left with an unsatisfiable rule.

   Required:
   - (a) Correct the stated rationale.
   - (b) Assert `count429 === 0` and `maxWindow <= MAX_WINDOW_TARGET` exactly as `hel1632-live-output.spec.ts:204-213` does. Keep `seedRequests` as a recorded number only.
   - (c) Require the seed to go through `page.request`, so the counter sees it. A seed on the `request` fixture authenticated by the same session cookie would be uncounted but still charged.
   - (d) State a feasible remedy for a real `maxWindow > 90`. One option: seed through a separate `APIRequestContext` authenticated by a PAT. Per CLAUDE.md, a PAT-authenticated request is keyed by token id, a different bucket from the browser session. The executor must confirm that keying in `RateLimitDirective` before relying on it. Other options are trimming browser traffic, or splitting the route tour across the two users.

   Update tasks 1.1 and 4.1 to match.

### Non-blocking notes
- `registerAndLogin` → `uiLogin` already lands the page on an app route, so the D4 `page.goto("/home")` is a second full boot (`e2e/support/auth.ts:82-96`). That is harmless, but it costs budget. Navigating client-side from where login lands, or counting it, would save one boot's worth of requests.
- For the wheel check, "nearest scrollable ancestor of the element under the pointer" should be computed with `document.elementFromPoint` at the hover coordinates. Walking from the hovered locator gives a different element if a child overlays it. This is a minor wording point.
