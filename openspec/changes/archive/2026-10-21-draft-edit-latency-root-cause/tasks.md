## Standing Constraints

- [C1] The assertions `latencies[0] < 100` and `max(latencies 2-10) < 50` and the count-cell MutationObserver scope stay unchanged unless the owner rules (OVERNIGHT: escalate, never relax).
- [C2] Owner ruling prod-build-measurement: opted-in latency assertions run against a production build (vite build + vite preview) in CI; budget unchanged. If the prod build adds meaningful minutes to an e2e shard, escalate rather than raise timeouts. Never read/print any .env file (CON-261).

### Tests

## 1. Instrumentation (done, diagnosis)

- [x] 1.1 Add the D1 per-edit `Performance.getMetrics` breakdown to the burst test (log line per edit); verify it prints locally.
- [x] 1.2 Add the D2 trace capture (console.timeStamp marks, Δts/Δtts per edit) behind HEL1691_TRACE; verify trace file and summary lines locally.
- [x] 1.3 Local baseline: dev vs prod, unthrottled and 6x, with and without tracing; numbers in scratch.

## 2. CI evidence (done, diagnosis)

- [x] 2.1 Collect >= 6 traced CI runs of the leg running this spec.
- [x] 2.2 Collect >= 6 untraced CI runs classified from D1 ThreadTime.
- [x] 2.3 Classify by D3; write `evidence.md`; STOP and return.

## 3. Prod-build harness (owner ruling, D7-D11)

- [x] 3.1 Env-exclusive projects (unset: `dev` only; set: guard + `prod-build` only) + `serviceWorkers: "block"` (D7, D8a); verify both `--list`s.
- [x] 3.2 Add the D8 setup-project guard; verify red against the dev server and green against vite preview (record both).
- [x] 3.3 Add `check:e2e-prod-build-projects` (by projectName) + selftest incl. guard-only fixture (D8b); wire both into CI frontend; verify red/green.
- [x] 3.4 Tag the burst test only; remove D2 trace + local switches, keep D1 (D10); verify assertion lines byte-identical to main.
- [x] 3.5 `scripts/e2e-shard.mjs`: `--project=dev` on list, re-list and run; verify `npm run check:e2e-shard:selftest` passes.
- [x] 3.6 `npm run e2e:prod-build` + CONTRIBUTING.md (D11); stop lane dev server via stop-servers.sh first; verify green run and port free after.
- [x] 3.7 `e2e-prod-build` CI job (timeout 20, artifact `playwright-json-prod-build`) + ci-complete needs (D9); verify `npm run check:ci-complete-needs` passes.
- [x] 3.8 PR CI: record D9's three cost measurements in evidence.md; escalate per D9 thresholds (C2); tighten the job timeout.
- [ ] 3.9 AC2: driver watches 10 main CI runs after merge (D6).
