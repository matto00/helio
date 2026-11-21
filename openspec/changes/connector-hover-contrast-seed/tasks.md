## Standing Constraints

- [C1] Lane constraints C1-C14 from the orchestrator brief bind every sub-agent (no .env reads, quoted heredocs, exact PIDs, lane DB helio_hel1805, ANTHROPIC_API_KEY empty, red committed first).
- [C2] Owner ruling: exempt ONLY the connectors table scroll region's hover (own isExempt entry, written reason, focus still asserted). Root-cause the Credential/Dependents sort headers at 390 with probe evidence first: a probe artifact near the sticky Actions column is fixed in the probe; a real defect gets the DESIGN.md section 5 Ghost hover on .sortable-th__btn inside @media (hover: hover) in SortableTh.css, and every guard cell rendering a sortable table is re-run.

## 1. Seed and red

- [x] 1.1 Confirm `ConnectorEntityService.create` / `checkCreateTimeEgress` makes no HTTP/TCP connection for a `.invalid` base URL with `authType: "none"`; confirm the lane backend has a master key (seed POST succeeds; else export ci.yml's fixed test-only key for the lane backend, else BLOCKER); record in evidence
- [x] 1.2 Add an opt-in connector seed to the guard's cell setup (1440 route cells and the narrow helper), keyed on the route being `/connectors`, plus a readiness wait on the connector name in `<main>` (overlays-chrome needs no seed: it never probes /connectors)
- [x] 1.2a In every `/connectors` cell (1440 and narrow) assert the seeded row, its actions trigger and (where mounted) "Test connection" are in the sampled set, logged per cell; verify by a run showing the assertion lines
- [x] 1.3 Run the affected guard spec files in full on current CSS with `HEL_GUARD_LOG_RATIOS=1`; verify the row, actions trigger and (where mounted) "Test connection" fail in both themes at 1440/1100/768/390; record which controls are mounted at each width and the before/after sampled counts
- [x] 1.4 Commit the seed change plus the red log under `openspec/changes/connector-hover-contrast-seed/evidence/` before any CSS edit

## 2. Fix

- [x] 2.1 Row hover (and the sticky actions-cell override) → `--app-surface-raised` inside `@media (hover: hover)`; verify by the guard ratio dump
- [x] 2.2 "Test connection" Secondary hover scoped to `.connectors-page__row-actions` → `--app-border-strong` + `--app-surface-raised` + `--app-text`; modal-hosted buttons unchanged; verify by the guard ratio dump
- [x] 2.3 Actions trigger (§5 Secondary hairline icon): `.connectors-page__row-actions .actions-menu__trigger:hover:not(:disabled)` → `--app-border-strong` + `--app-surface-raised`; verify by the guard ratio dump
- [x] 2.4 Run `featureHoverGating.css.test.ts` and the connectors jest tests; verify green

## 3. Verification

- [x] 3.1 All affected guard spec files green in both themes (full files), plus routes-dense and overlays-chrome unaffected; logs in evidence
- [x] 3.2 Mutation: revert each of the three hover rules one at a time; verify the guard goes red for exactly that control; logs in evidence
- [x] 3.2a Edit modal "Replace credential" hover (bearer/api_key connector, both themes) unchanged and visible on `--app-surface-strong`; probe or screenshot in evidence
- [x] 3.3 Measure wall time of the affected spec files before (main) and after; write `ci-impact.md` with the stated delta
- [x] 3.4 Visual check in the running app (both themes, 1440 and 390 with a mouse pointer): hovered control inside a hovered row is still distinguishable. Done by the evaluator, not the executor: see evaluation-1.md Phase 3 (screenshots under .concertino/runs/HEL-1805/evidence/.concertino/scratch/HEL-1805/)
- [x] 3.5 `npm run lint`, `npm run typecheck`, `npm run format:check` green; commit
