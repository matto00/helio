## Standing Constraints

- [C1] The in-app-switch regression test must exercise the real route: it renders exactly what `AppRoutes.tsx` renders for `/pipelines/:id` (or the key lives inside the exported `PipelineDetailPage`), never a test-only wrapper, and must be shown red on base.
- [C2] A guard for a shared `pipelines` slice field (error, status, run state, currentPipeline) must scope by pipeline id and must never leave `currentPipelineStatus` stuck at "loading"; a previous pipeline's error must not display on the new pipeline's page.

## 1. Probe (root cause before fix)

- [x] 1.1 Reproduce in the running app on this worktree's own dev ports with a throwaway user: open A (3 steps), navigate in-app to B (1 step) via pipelines list/sidebar, command palette, recents, and browser back/forward; record which routes show stale cards. Capture created ids up front; delete by exact id afterwards.
- [x] 1.2 Instrument/probe to confirm the cause (e.g. log `id`, `stepsInitialized`, `steps.length`, `persistedSteps.length` across the switch) and record the transcript as evidence.
- [x] 1.3 Widen: on base, with stale cards showing on B, edit a stale card and record what request (URL + step id) is sent; check the analyze/fingerprint request after the switch; check late A responses (pipeline, steps, analyze) against B's render.
- [x] 1.3a Probe on base: (i) A -> edit+save A -> B -> back to A shows pre-edit config (stale cache seed, design D2a); (ii) A fails to load -> switch to B stays on A's error (D5a); (iii) A's run resolving after the switch lands on B (D5b); (iv) A's name/header flash on B (D5c); (v) the other switch sites in D6.
- [x] 1.4 Write the failing jest regression test that drives the in-app switch within one render; record it red on base.

## 2. Fix

- [x] 2.1 Apply the fix chosen by the probe (design D2 preferred: key the page by `:id` via a thin route wrapper).
- [x] 2.2 Enumerate what the fix resets (drafts, debounce timers, open sheets/modals, SSE, run history, output name, pending AI drafts) and justify each in the evidence.
- [x] 2.2a Seed steps only from this mount's own steps fetch (design D2a), red-first.
- [x] 2.2b Fix the singleton-field leaks (D5a failed-load latch scoped to id, D5b late run result ignored, D5c `currentPipeline.id !== id` treated as loading), each red-first; no guard may leave status stuck at "loading".
- [x] 2.3 Fix any cross-pipeline write / late-response overwrite found in 1.3 (design D3), each with a red-first test.

## 3. Verify

- [x] 3.1 Regression test(s) green; existing PipelineDetailPage/pipelines jest suites green.
- [x] 3.2 Running-app re-check of every route from 1.1 shows B's steps only; request log shows no request after the switch carrying an A step id in URL or body and no duplicate/excess boot requests vs a fresh open.
- [x] 3.3 No Playwright e2e added: back/forward, palette and sidebar were verified in the running app (evidence dir probe-fixed-*.txt) and the jest suite covers the in-app switch through the real exported page.
- [x] 3.4 lint (zero warnings, no new eslint-disable), typecheck, format:check, full jest pass (respect local resource caps; check MemAvailable first).
