## Standing Constraints

- [C1] Never read/cat/grep/source/print any .env file; no env-dumping commands; only scripts may read scripts/concertino/.concertino.env, never print it.
- [C2] Quoted heredocs only (<<'EOF') or Write/Edit.
- [C3] No pkill/pgrep/killall; kill only by exact PID; stop servers with scripts/concertino/stop-servers.sh; DB residue deleted only by exact id via buildUserDeleteSql.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] timeout: 600000 on long Bash calls; sbt testFull, never bare sbt test.
- [C12] Red first with recorded mutations; evaluator and skeptic run full affected spec files.
- [C13] Scratch in .concertino/scratch/HEL-1738/.
- [C14] e2e on a lane-private DB helio_hel1738 (DATABASE_URL for start-servers.sh and Playwright); clean residue by exact id.

### Frontend

## 1. Hook queue

- [x] 1.1 Add `queueRefresh` to `PanelDataResult` (and the no-key return) with D2 drain/drop at all five sites plus unmount; verify 3.1.
- [x] 1.2 Make `isRefreshing` include `queued`, cleared right after the queued dispatch (D3); verify no-false-gap test.

## 2. Wiring

- [x] 2.1 Register `panelData.queueRefresh` in `MobilePanelStack` (insight refetch unchanged); verify typecheck and lint.
- [x] 2.3 Update the `usePanelData` mocks in `MobilePanelStack.pullRefresh.test.tsx`, `MobilePanelStack.test.tsx`, `MobilePanelStack.provenance.test.tsx` with separate `queueRefresh`/`refresh` mocks; assert a round calls `queueRefresh`, never the per-panel `refresh` (unit kill for the re-register mutation).
- [x] 2.2 Update `pullRefreshRegistry.ts` comments for the queued behaviour (no logic change); verify registry tests pass.

### Tests

## 3. Tests

- [x] 3.1 jest `usePanelData` queue tests per design D5; red against a stubbed `queueRefresh = refresh`, then green.
- [x] 3.2 jest `pullRefreshRegistry` round-spans-queued-refresh test; verify green.
- [x] 3.3 e2e `hel1738-refresh-during-first-load.spec.ts` per D5 (gates A/B, steps 1-5, three contexts); record red on main and both mutations.
- [x] 3.4 Run `hel1681-refresh-control.spec.ts` and the pull-refresh e2e specs in full; record green.
- [x] 3.5 Light and dark screenshots at 375/430 phone and the 375 desktop-browser context; 1280 shows no button.

## Notes from design gate round 2 (skeptic-design-2.md, binding for implementation)

- Mounted ref: set true in the effect body (StrictMode double-invoke), not only `useRef(true)`.
- Drain at `.finally` only if this dispatch is still the latest for the panel (compare `latestFetchRequestId`), so a stale request never drains over a newer one.
- CROSS_FILTER_EQ_REJECTED retry: keep `inFlightRef` true until the retry settles; drain at the retry's settlement.
