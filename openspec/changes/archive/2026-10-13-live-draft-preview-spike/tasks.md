## Standing Constraints

- [C1] Before self-approving any decision instead of escalating it, the doc must show why only one option is viable (or name the owner ruling that settles it); otherwise it goes in the owner escalation.
- [C2] Owner rulings: A = choose transport by lowest latency and cost only (size irrelevant; re-escalate only on a genuine tie); B ts-evaluator-plus-corpus; C client-memory; D head-1000-manual-refresh; E new-atomic-bulk-endpoint; F never-before-save (no Preview-with-AI button).

## 1. Evidence: browser latency prototype (throwaway, design.md D2)

- [x] 1.1 Write `prototype/index.html`: plain JS, no imports; deterministic 1,000-row `runs` generator; filter → sort → compute evaluator incl. a small expression tokenizer/parser; `edit()` recomputes from the edited step down; render = preview table + SVG line + 2 metric tiles; verify by loading it and checking row counts by hand
- [x] 1.2 Write `prototype/measure.cjs` (delivered as `.cjs` with `require.resolve`; Node's ESM loader ignores `NODE_PATH`): own headless Chromium via repo `playwright-core`, `file://` load, 50 warm-up + 500 measured edits, recompute-only and recompute+render timings, unthrottled and 4x CDP CPU throttle; render time includes a forced sync layout and, separately, time to next frame; thresholds vary across the 500 edits; verify it prints median/p95/max
- [x] 1.3 Run it (`nice -n 19`, one browser) and write `measurements.md` with the exact command (explicit `playwright-core` module path, since the worktree has no node_modules), resolved playwright-core version+path, `browser.version()`, headless shell vs full Chromium, CPU/OS, node version and the numbers; verify a second run is within noise
- [x] 1.4 Add `prototype/README.md` stating it is throwaway, what it includes/omits vs a faithful port, and that nothing imports it; verify `grep -r live-draft-preview-spike frontend backend` is empty

## 2. Evidence: transport measurements (design.md D4)

- [x] 2.1 Start this worktree's servers with `scripts/concertino/start-servers.sh` (DEV_PORT 7012, BACKEND_PORT 9919) and verify `/health` on 9919
- [x] 2.2 Create a board-shaped dataset source + 3-step pipeline; time ≥20 `GET .../steps/:stepId/preview` calls; record median/p95 in `measurements.md` labelled local; verify by re-running
- [x] 2.3 If cheap, time `run-events` open-to-headers; record or state why skipped
- [x] 2.4 Delete every created row by exact id, record the ids, verify they are gone; stop servers with `scripts/concertino/stop-servers.sh`

## 3. Docs: `docs/live-draft-preview.md`

- [x] 3.1 Q1 step-kind table: all 27 registered kinds from `PipelineStep.scala` Registry, client-evaluable / server-only / client-with-caveat, reason and file:line each; verify the count matches the Registry
- [x] 3.2 Q1 parity plan: shared vector corpus, two runners, coverage + registry-agreement check, and the concrete mutation each check catches; manifest-based classification checked by a Registry-iterating ScalaTest; say per area whether the client reuses existing TS (`aggregate.ts` + `output-summary-reducer.json`, `parseChartInstant`) or duplicates Scala logic (window rolling: duplication, no TS evaluator exists)
- [x] 3.3 Q2 sample policy (name which HEL-505 limiter, if any, applies to a sample refresh and to a server draft preview), Q3 change unit and per-step cache, with recommendation + rejected alternatives each
- [x] 3.4 Q4 transport, citing D4 measurements, the run-events/fanout code and HEL-1438 item 2; recommendation + rejected alternatives
- [x] 3.5 Q5 Output render via the existing prop seam (`OutputPreviewPane`/`OutputPanelContent`); Q6 draft vs saved vs patch-sets/undo, against the approved boards
- [x] 3.6 Latency section quoting `measurements.md`; HEL-1581 scope section walking its 5 ACs one by one (stands / adjusted / split), resolving the no-network-request vs "difference vs last run" conflict; AI steps in a server draft preview addressed
- [x] 3.7 Verify `npm run format:check` passes and every cited path exists (`ls` each)

## 4. Owner escalation (design.md D5)

- [x] 4.1 Raise ONE multi-part ESCALATION for the remaining genuine calls (candidates: transport, evaluator approach, sample cache location, Save & run write path; self-approve only per C1), with bounded options and the recommendation; on answer, record the exact answer tokens in the doc and update the affected sections

## 5. Verification

- [x] 5.1 Commit through the full pre-commit hook (no `-n`); verify `git status` is clean and no product file changed outside `docs/` and this change dir

## 6. Delivery (orchestrator-owned, not executor)

- [x] 6.1 Orchestrator posts the doc's HEL-1581 scope section as a comment on HEL-1581 after the final gate; HEL-1581's description is never edited; verify the comment URL is recorded in the PR body
