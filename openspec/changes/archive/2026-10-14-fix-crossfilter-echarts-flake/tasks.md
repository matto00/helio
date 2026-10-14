## Standing Constraints

- [C1] No raised timeouts and no retries as the fix; no speculative patch without a probe-confirmed root cause.
- [C2] All probes: jest <= 3 workers, `nice -n 19`, <= 3-4 parallel processes, run in this worktree only.
- [C3] Judge the root cause and the fix by render-to-visible time (echarts node in DOM), not lazy-import resolve time.

### Tests

- [x] 1.1 Inspect CI run 38553599277's frontend job: exact jest command and cache state (single invocation, no retry — verified)
- [x] 1.2 Baseline: run the file repeatedly with CI=true, cold cache per run (fresh --cacheDirectory), and warm cache; record pass/fail
- [x] 1.3 Baseline under contention: full frontend suite with CI=true, --maxWorkers=3, nice -n 19, several runs; record pass/fail
- [x] 1.4 Probe H1: temp instrumentation of render-to-visible (echarts node in DOM), split import vs reveal, fallback-shown flag; never committed
- [x] 1.5 Probe H2: run test in isolation vs whole file; trace the jsdom XHR AggregateError source and its relevance
- [x] 1.6 Record root-cause verdict (or "not reproduced" + hypothesis) in measurements.md
- [x] 1.7 If confirmed: apply the design.md D2/D3 fix in PanelCard.crossFilter.test.tsx with a why-comment
- [x] 1.8 After: repeat the reproducing condition with the same N; record pass/fail and render-to-visible timings in measurements.md
- [x] 1.9 Run lint, typecheck, prettier and the panels test folder; commit
