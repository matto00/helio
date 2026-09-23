## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

1. **Spawn-cwd guard** — `pwd -P` = `/home/matt/Development/helio`; `assert-cwd.sh` returned
   `READY ambient=/home/matt/Development/helio branch=feature/sse-fan-out-panel-refresh/HEL-1094`.
   Proceeded normally.

2. **Diff scope matches proposal.md's Impact section.** Resolved the live review base via
   `resolve-review-base.sh` → `BASE_SHA=e75302e7a2d091628f0478ca52d5553331a0eb8b` (exit 0, checked).
   `git diff --stat e75302e7...HEAD`: 7 frontend/e2e code+test files (`pipelineRunFanout.ts/.test.ts`,
   `usePanelRunRefresh.ts/.test.ts`, `PanelCard.tsx`, `PanelCardBody.fanoutStatus.test.tsx`,
   `hel1094-sse-fan-out-panel-refresh.spec.ts`) plus only OpenSpec change-dir artifacts. A follow-up
   `git diff --stat ... -- backend/ schemas/ 'openspec/specs/**'` returned empty — no backend, schema,
   or committed-spec-tree changes, confirming the "frontend-only, no migration" claim in proposal.md
   and Standing Constraint C1.

3. **`head_sha` for this review**: `b4d8827be87078026a5ff8307dca64585ee930ac` (captured via
   `git rev-parse HEAD` immediately after reading the diff).

4. **C2 "show the red" — independently reproduced myself, not trusted from the evaluator's report.**
   I wrote my own mutation of `pipelineRunFanout.ts` (moved `connect()` outside the `if (!entry)`
   guard so every `subscribeToPipelineSucceeded` call opens a new connection — a distinct mutation
   from whatever the executor/evaluator used, to avoid inheriting their exact framing) and ran
   `npx jest src/features/panels/services/pipelineRunFanout.test.ts`:
   - Mutated: **3 failed** (`toHaveBeenCalledTimes(1)` received `2` in the task-1.1, task-1.2, and
     task-3.1/C5 tests), 7 passed.
   - Restored (`cp` back the original file): **10/10 passed.**
   This proves the core fan-out test is a real, falsifiable guard against the literal regression C5
   exists to prevent — not a tautological assertion.

5. **C5 "one SSE connection per pipelineId" — read the shipped source directly.**
   `frontend/src/features/panels/services/pipelineRunFanout.ts:35-57`
   (`subscribeToPipelineSucceeded`): a module-level `Map<string, FanoutEntry>` keyed by `pipelineId`;
   `connect()` is called exactly once, inside `if (!entry) { ...; void connect(...) }` — a second
   `subscribe` for an already-watched `pipelineId` only adds to `entry.listeners`, never calls
   `connect` again. This is genuinely one connection per pipeline, confirmed by code, not by trusting
   the test's name.

6. **D6 bounded exponential backoff — implemented and tested, not just documented.**
   `computeRetryDelayMs(attempt) = Math.min(1000 * 2 ** attempt, 30_000)` is exported and used in
   `scheduleRetry`; `connect()` calls `scheduleRetry` on a fetch-throw (non-AbortError), a non-2xx or
   non-`text/event-stream` response, a missing reader, a mid-stream throw, and a stream that ends
   without ever setting `terminalReceived` — matching spec.md's "non-2xx response, non-event-stream
   response, network error, or unexpected stream end" enumeration exactly.
   `pipelineRunFanout.test.ts`'s "bounded backoff retry (task 1.4, design.md D6)" describe block
   (fake timers) asserts exactly one retry `fetch` at `computeRetryDelayMs(0)=1000ms` (not before),
   and a separate test proves the attempt counter resets to 0 after a successful connection. Ran this
   suite myself (`npx jest .../pipelineRunFanout.test.ts`): 10/10 pass.

7. **C4/D5 a11y — genuinely a COMPUTED ARIA assertion, not markup presence.** Read
   `e2e/hel1094-sse-fan-out-panel-refresh.spec.ts:184-200`: it calls
   `page.accessibility.snapshot({ root: statusHandle, interestingOnly: false })` (a real CDP
   accessibility-tree read) and asserts `axSnapshotAfterFirst.children[0].name === afterFirstText`,
   i.e. the computed accessible name of the live region's child text node actually changes — not a
   `toHaveAttribute("aria-live", ...)` check. The component test
   (`PanelCardBody.fanoutStatus.test.tsx`) is jsdom-only (no real AX tree available there) and
   correctly limits itself to `textContent`/`getByRole("status")`, deferring the literal computed-ARIA
   claim to the e2e layer — a reasonable, disclosed split, not a vacuous substitute.

8. **e2e test genuinely proves the AC end-to-end against the real backend — ran it myself.**
   Read the full spec: registers a real user via `/api/auth/register`, seeds a real dataset/pipeline/
   output/two panels via the real REST API, runs the pipeline once via `/api/pipelines/:id/run` to
   seed baseline data, loads the real page, submits the real form panel via `page.click`, and waits
   real wall-clock time (`toHaveCount(2, { timeout: 120_000 })`) for the real 5s debounce + real 30s
   scheduler tick + real run + real SSE delivery — no mocked fetch, no short-circuited timers, no
   manual `page.reload()` or refresh click anywhere in the file. Confirmed dev servers healthy first
   (`scripts/concertino/assert-phase.sh servers` → `PASS servers`, reusing DEV_PORT=6526/BACKEND_PORT=9433).
   Ran `DEV_PORT=6526 BACKEND_PORT=9433 npx playwright test e2e/hel1094-sse-fan-out-panel-refresh.spec.ts`
   myself: **1 passed (41.3s)** (fresh run, distinct from the evaluator's own 58.7s run — both real,
   timing variance is expected given the real wall-clock waits involved).

9. **`PipelineRunRegistry` single-subscriber premise — verified in the actual backend source**, not
   assumed from design.md's narrative. `backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunRegistry.scala`:
   `subscribe` does `refs.put(pipelineId, ref)` unconditionally (no existence check), and `publish`
   removes the map entry only on a terminal event. This confirms the entire ticket's premise (a naive
   second per-panel subscription silently steals the first's slot) is real, not a hypothetical risk
   invented to justify the design.

10. **Gates independently re-run, fresh, full output read:**
    - `npm run lint` — clean, `--max-warnings=0`, no output (pass).
    - `npm run typecheck` — clean (`tsc --noEmit`, no errors).
    - `npx jest` on the three new/changed test files
      (`pipelineRunFanout.test.ts`, `usePanelRunRefresh.test.ts`, `PanelCardBody.fanoutStatus.test.tsx`)
      — 3 suites, 19/19 passed.
    - Full `sh .husky/pre-commit` chain (lint, typecheck, e2e/helio-mcp typechecks, format,
      schema-drift, spec-structure, OpenSpec hygiene + selftest, Dependabot config + selftest, Scala
      quality, test-temp-dir hygiene + selftest, no-credential-leak + selftest, token-resolution
      (`check:tokens`) + selftest, full test suite) — ran to completion in background,
      **exit code 0**; tail of output shows `check-tokens: OK` (confirms the new `.sr-only` usage
      resolves against `theme.css`), Jest `28 passed / 271 tests` (root) + `335 passed / 3652 tests`
      (frontend) — matches the evaluator's reported counts, independently reproduced.

11. **`files-modified.md` matches the actual diff** — every file it lists is in `git diff --stat`, and
    no diff file is missing from the list. No TODO/TBD/FIXME/placeholder/`console.log` found via
    `grep -rniE` across every new/changed source and test file (zero hits, confirmed exit code 1 on
    the grep).

12. **`.sr-only` reuse (not reinvented) — confirmed**, `theme.css:505` defines it canonically; the new
    region in `PanelCard.tsx:152` uses the class verbatim. The evaluator's non-blocking note (the new
    region omits `Toast.tsx`'s `aria-atomic="false"`) is accurate but inconsequential — my own e2e
    re-run confirms the announcement is still correctly computed and changes per refresh regardless.

13. **UI/visual check.** The only new UI surface is a `.sr-only`-clipped `role="status"` `<div>`,
    zero visual footprint by construction — confirmed by reading the full JSX diff (wrapped in a
    fragment, `PanelContent`'s own markup is otherwise byte-for-byte unchanged). Loaded the dashboard
    landing page fresh in a Playwright session: 0 console errors/warnings. No other visible UI changed
    in this diff, so there is no light/dark parity or layout-breakpoint surface to separately judge —
    this is a correct N/A read of the diff's actual shape, not a skipped check (I independently
    verified the diff shape myself rather than accepting the evaluator's "N/A-by-construction" framing
    at face value).

### Verdict: CONFIRM

Every AC traces to real, independently-reproduced evidence: the fan-out mechanism genuinely
consolidates to one SSE connection per pipeline (read in source, confirmed by a red/green mutation I
wrote myself), the retry/backoff (D6) is implemented and tested against the exact failure taxonomy
spec.md describes, the a11y announcement is a real computed-ARIA assertion verified via CDP, and the
literal AC (form submit → downstream auto-run → bound panel visibly updates, no manual refresh/reload)
is proven by an e2e test that drives the real backend end-to-end, which I ran myself and which passed.
The diff is scoped exactly to what proposal.md claims (frontend-only, no backend/schema/migration
changes). All gates (lint, typecheck, full pre-commit chain including the full Jest suite) were
re-run fresh by me, not trusted from the evaluator's report, and all passed with output I read in
full.

### Non-blocking notes

1. `tasks.md` task 3.3's literal text ("test-accelerated `SCHEDULER_TICK_INTERVAL_SECONDS`") no
   longer matches the implemented approach (default/unmodified interval, for a documented,
   well-reasoned reason — see the e2e spec's own header comment). The decision itself is sound; only
   the checklist text is stale. A trivial follow-up edit, not a reason to withhold this ticket.
2. The new sr-only status region omits `aria-atomic="false"` that `Toast.tsx`'s sibling convention
   sets explicitly (defaults to `aria-atomic="true"` instead). Confirmed functionally inconsequential
   via my own e2e re-run (the announcement still computes and changes correctly), but worth aligning
   for consistency the next time this file is touched.
3. `skeptic-design-2.md`'s open ambiguity (whether a mid-stream drop after an initial successful
   connection, but before any terminal `run-status`, resets the attempt counter at "response
   validated" time vs. "terminal status received" time) remains present in the shipped code exactly as
   flagged in the design gate — confirmed by reading `connect()`: `entry.attempt = 0` is set right
   after response validation (line 110), before the read loop. Either reading still satisfies the AC
   and spec.md's recovery requirement; not blocking.
