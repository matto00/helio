## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `dd7d72a811b8884bb89b511c007c7aa8561f75e9`, base `00fc654f30494e25ae9310121e2c62cd75bcba61`
(resolve-review-base.sh, live). Commits: acd3590ae (red tsc), 8fa635098 (bump + lib/core), dd7d72a81 (ticks).

### Phase 1: Spec Review — PASS

- Both runtime imports moved to `echarts-for-react/lib/core` (`ChartPanel.tsx:8`, `UsageChart.tsx:5`); 3.1.0's
  installed `exports` map has only `.`, `./lib`, `./lib/*`, `./lib/*.js` (checked in `frontend/node_modules`).
- Bump in this PR: only `frontend/package.json` and `frontend/package-lock.json` change (adds `tslib`); root lockfile untouched.
- Mapper key and every `jest.mock` specifier moved (34 test files, 38/38 line swaps, no other edits in them);
  `grep esm/core` over `frontend/src`, `frontend/*.cjs`, `frontend/*.ts`, `e2e/` leaves one hit, the intended
  `esm/core.js` mention in `echartsForReactCoreMock.tsx:10`.
- Red first: `red-tsc-3.1.0.txt` shows TS2307 at both sites.
- AC2 (chunk before/after): `chunk-sizes.md` states both; see Phase 2 for my independent corroboration.
- No scope creep; skip_specs justified (no behavior change). `CONSTRAINTS: []`, nothing to honor.
- Task 2.7 was unticked (executor had no browser); I performed it (Phase 3). Tick it (CR 2).

### Phase 2: Code Review — FAIL

Gates, run by me in WORKTREE_PATH at the reviewed HEAD:
- `npm run lint` exit 0; `npm run format:check` exit 0; `npm --prefix frontend run typecheck` exit 0.
- `npm test` (HELIO_JEST_MAX_WORKERS=3, nice 19) exit 0: root 73 suites / 645 tests, frontend 918 suites / 10588 tests.
- `npm --prefix frontend run build` exit 0: `useChartEntranceMotion-CSmy2lrY.js` 651,301 B raw, 215,657 B gzip -9
  (Vite: 651.30 kB / 218.39 kB); `ChartPanel` 20.90 / 7.46 kB; `AdminUsagePage` 12.18 / 4.00 kB.
- Chunk identity, self-authenticating: sha256 of my build's chart chunk
  `048592611ee8874933c891999cd938821e429bdad37fdacb382bc818d4c4e4db` equals the executor's `dist-before` copy
  (`cmp` identical). Independent corroboration not resting on the executor's artifact: `esm/core.js`, `esm/index.js`
  and `esm/helper/is-equal.js` are byte-identical (`cmp`) between 3.0.6 (main checkout node_modules) and 3.1.0
  (worktree node_modules), so Vite resolving `lib/core` via `module` to `esm/core.js` must yield the same chunk. 0 % change.
- Mapper mutation (my own, via `--moduleNameMapper` CLI override, no file edit): pointing
  `^echarts-for-react/lib/core$` at a nonexistent file turns `PanelGrid.remountReuse` red ("Could not locate module
  echarts-for-react/lib/core"); the same override with the real target is green. The global mapper is live.

Issues:
1. `frontend/src/test/echartsCoreSubpathMock.ts:6-8` — the diff changed "Like `echarts-for-react/esm/core` ..., every
   one of these subpaths is ESM-only" to name `lib/core`. That sentence is now false: `lib/core` resolves to the
   CommonJS `lib/core.js` under Jest, which this same diff's `echartsForReactCoreMock.tsx:7-9` and
   `jest.config.cjs` comment state. The two docblocks now contradict each other.
2. `frontend/src/test/echartsForReactCoreMock.tsx:9-10` — "Vite and tsc resolve the `module` condition to the ESM build":
   tsc does not use the `module` condition; with `moduleResolution: "Bundler"` it takes `types` -> `lib/core.d.ts`.
   Only Vite picks `module`.

Otherwise: no type escapes, no dead code, DRY/modularity unaffected (pure specifier move), no security surface.

### Phase 3: UI Review — PASS

Servers via `start-servers.sh` (ports 7256/10163; backend log confirms `jdbc:postgresql://localhost:5432/helio_hel1824`;
ANTHROPIC_API_KEY empty), `assert-phase.sh servers` PASS. Throwaway user `hel1824-eval@example.test`
(id `aebd247b-7c40-4c5d-9294-df214989fec3`) registered, set to `owner` tier in the lane DB only, finance template
dashboard created.
- Chart panels: dashboard "Finance spend (sample)" renders two bar charts (2 canvases) in dark, then after a live
  switch to light via the command palette the axis labels/gridlines re-theme correctly.
  Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1824/evidence/.concertino/scratch/HEL-1824/eval-chart-dark.png`,
  `/home/matt/Development/helio/.concertino/runs/HEL-1824/evidence/.concertino/scratch/HEL-1824/eval-chart-light.png`.
- Admin usage (`/admin/usage`, owner tier, `GET /api/admin/usage` 200): the lane DB has no finalised rollup
  (`rolled_through` null), so the page correctly shows its shared empty state. To exercise `UsageChart` I replaced
  only the in-page XHR response body of `/api/admin/usage` with a 7-day payload shaped like
  `adminUsage.fixture.ts` (no DB rollup mutation). All four charts render (4 canvases), in light and after a live switch
  to dark. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1824/evidence/.concertino/scratch/HEL-1824/eval-admin-usage-chart-light.png`,
  `/home/matt/Development/helio/.concertino/runs/HEL-1824/evidence/.concertino/scratch/HEL-1824/eval-admin-usage-chart-dark.png`.
- Console: no errors or warnings during the flows (the only error was a pre-login `401 /api/auth/me`).
- `e2e/hel1573-motion-grid-chart.spec.ts` re-run by me (DEV_PORT=7256, 2 workers): 4 passed; its option-path
  assertions (`animationDuration`/`animationDurationUpdate`/`animationEasing`) hold on 3.1.0.
- Not re-run by me: `npm run e2e:prod-build` (executor reports 6 passed in `prod-build.txt`). The chart chunk is
  byte-identical, so the prod-build chart code path is unchanged.
- Cleanup: user deleted by exact id via `buildUserDeleteSql` (users/dashboards/data_sources rows for it: 0);
  one `stored_object_deletions` queue row from the cascade remains in the lane DB for the backend's next tick.
  Servers stopped with `stop-servers.sh`; ports 7256/10163 free.

### Overall: FAIL

### Change Requests
1. `frontend/src/test/echartsCoreSubpathMock.ts:6-8`: stop presenting `echarts-for-react/lib/core` as an ESM-only peer.
   E.g. "Unlike `echarts-for-react/lib/core` (CommonJS under Jest, see `echartsForReactCoreMock.tsx`), every one of
   these subpaths is ESM-only in `echarts`'s package exports map ...", or drop the comparison clause.
2. `frontend/src/test/echartsForReactCoreMock.tsx:9-10`: change "Vite and tsc resolve the `module` condition to the ESM
   build" to say Vite resolves `module` to `esm/core.js` (tsc reads the `types` entry, `lib/core.d.ts`).
3. `openspec/changes/take-echarts-for-react-3-1-0/tasks.md`: tick 2.7, citing this report's Phase 3 evidence paths.

### Non-blocking Suggestions
- `jest.config.cjs` comment block: the inserted line "(jsdom cannot render the real canvas component). A test file's
  own `jest.mock(...)` for either still wins over" is longer than its neighbours; rewrap for consistency.
