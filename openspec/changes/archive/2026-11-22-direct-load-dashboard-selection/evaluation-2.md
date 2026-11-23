## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `a3fbbe701bfb3c24bbfa06c5a7e4ffa122fed9bb` against the live-resolved base `07a1180016b8032c9c16f2514aa8a8c0319cb776`. The cycle-2 delta is `7b93e4f1e..a3fbbe701`.

### Phase 1: Spec Review — FAIL

The cycle-1 change requests:
- **CR1 (request-log guard failable): resolved.**
  - `mutation-e2e-panel-fetch-landing-default.txt` contains exactly one `Error:` (`grep -c` = 1). It is the `ownRequests` soft assertion ("requests keyed on the landing dashboard during the load"), and it received `GET /api/dashboards/<A>/panels`.
  - The run's line numbers (`:89`) match the spec as of 7b93e4f1e. Since then the spec gained only 3 comment lines, so the evidence is valid for the current assertion.
  - The spec comment at `e2e/hel1624-direct-load-selection.spec.ts:11-16` now describes what was recorded: removing the gate alone stays green, the effect-retargeting mutation turns it red, and the comment states what the guard cannot prove.
  - The note added to `tasks.md` 1.2 matches.
- **CR2 (audit rows): partly resolved.** The `DashboardMetaRow.tsx` row is now accurate: an owned default never polls (measured), and a shared default is marked inferred. The new `DashboardRefreshLine.tsx` row has a copy error. Its **After** cell repeats the Before text: "hooks keyed on the landing default first; see the DashboardMetaRow row ...". That says the transient keying persists after the fix, which contradicts the change and the jest and e2e evidence.
- **CR3 (task 3.3): resolved.** It is ticked with evidence, and my fresh runs below agree.

### Phase 2: Code Review — PASS

- `dashboardsSlice.ts:514` was simplified to `action.meta?.loadTarget !== undefined`, which is behaviour-identical. An absent key and an explicit `undefined` both fall back to the landing default, and an explicit `null` is still applied.
- I re-ran every gate fresh in `WORKTREE_PATH`:
  - `npm run lint`, `npm run format:check` and `npm run typecheck`: exit 0.
  - `npm test` (3 workers): root 73 suites / 645 tests and frontend 918 suites / 10588 tests, all passed.
  - `npm --prefix frontend run build`: exit 0.
- Output is in `/home/matt/Development/helio/.concertino/scratch/HEL-1624/eval2-*.txt`.

### Phase 3: UI Review — PASS

The only UI-affecting change this cycle is the one-line reducer simplification. With servers started through `start-servers.sh` (lane DB, empty `ANTHROPIC_API_KEY`), I ran Playwright with 2 workers on `hel1624-direct-load-selection`, `hel1575-delayed-restore-no-update-loop` and `hel1783-shared-dashboard-tabs`: 3 passed, exit 0. I stopped the servers with `stop-servers.sh`. My cycle-1 manual browser checks still apply, since the behaviour did not change.

### Overall: FAIL

### Change Requests
1. In `openspec/changes/direct-load-dashboard-selection/consumer-audit.md`, the `app/dashboardMeta/DashboardRefreshLine.tsx` row: replace its **After** cell, which currently duplicates the Before cell, with the post-fix behaviour. Example: "keyed on the target from the start (as the DashboardMetaRow row)". This is the only remaining issue.

### Non-blocking Suggestions
- (Carried from cycle 1) `dashboardsSlice.ts` is 608 lines. Propose a split in the PR description, as `CONTRIBUTING.md:24` asks.
