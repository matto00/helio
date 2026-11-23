## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `020b3a36ee4c01e6f416d7538fe0bb1f4f066b64`. The review base was resolved live with
`resolve-review-base.sh`: `00fc654f30494e25ae9310121e2c62cd75bcba61` (exit 0). There are 4 commits on the branch and 52
changed files.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/echarts-for-react-3-1-0/HEL-1824`.
- **Diff is what it claims.** I read `git diff BASE...HEAD` for `package.json`, `jest.config.cjs`, `ChartPanel.tsx`,
  `UsageChart.tsx` and `src/test/*`.
  - The two runtime imports changed from `esm/core` to `lib/core`. Nothing else changed in either file.
  - The jest mapper key moved to `^echarts-for-react/lib/core$`.
  - The lockfile diff touches only the `echarts-for-react` entry: 3.1.0, a new integrity hash, and a new `tslib`
    dependency. `node_modules/tslib` 2.9.1 was already in the lockfile.
- **No leftover `esm/core` specifiers.** `git grep "esm/core"` outside `openspec` returns one hit,
  `echartsForReactCoreMock.tsx:10`. That line is prose that correctly says Vite resolves to `esm/core.js`. There are
  37 `jest.mock("echarts-for-react…` sites.
- **The 3.1.0 exports map** (from the installed `node_modules/echarts-for-react/package.json`, version 3.1.0): `./lib/*`
  maps `types` to `./lib/*.d.ts`, `module` to `./esm/*.js` and `default` to `./lib/*.js`. There is no `./esm/*`
  entry, which confirms the premise. `lib/core` is an exported subpath.
- **AC1, tsc/lint/format/jest:** I ran all four myself at HEAD.
  - `npm --prefix frontend run typecheck`: exit 0.
  - `npm run lint`: exit 0.
  - `npm run format:check`: exit 0.
  - Full frontend jest (3 workers, `nice 19`): exit 0, 918/918 suites and 10588/10588 tests.
    Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1824/evidence/.concertino/scratch/HEL-1824/skeptic-jest.txt`.
- **AC1, e2e:** both runs used servers from `start-servers.sh` with `assert-phase.sh servers` PASS. The DB was confirmed
  as `helio_hel1824`: my throwaway user appeared there and not in `helio`.
  - `e2e/hel1573-motion-grid-chart.spec.ts` (DEV_PORT=7256, 2 workers): exit 0, 4 passed. The spec reads
    `chart.getOption().animationDuration/animationDurationUpdate` (lines 206-216, 236-255), and those assertions still
    hold on 3.1.0, so the option path HEL-1814 reads is unchanged.
    Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1824/evidence/.concertino/scratch/HEL-1824/skeptic-motion.txt`.
  - `@prod-build` leg (`stop-servers.sh`, then `e2e-backend.sh lane-start`, then `npm run e2e:prod-build`, then
    `stop-servers.sh`): exit 0, 6 passed.
    Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1824/evidence/.concertino/scratch/HEL-1824/skeptic-prod-build.txt`.
  - The full CI e2e legs (8) run on the PR after this gate. I did not run them.
- **AC2, chart chunk size before and after.** This rests on self-authenticating content comparisons, not on mtimes.
  - My own `npm run build` at HEAD produced `useChartEntranceMotion-CSmy2lrY.js` at 651.30 kB, 218.39 kB gzip
    (sha256 `048592611ee8…`). `cmp` against the executor's `dist-before` copy of the same chunk shows the files are
    identical. The `ChartPanel` chunk (20.90 kB) and the `AdminUsagePage` size (12.18 kB) are also unchanged.
    Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1824/evidence/.concertino/scratch/HEL-1824/skeptic-build.txt`.
  - I also checked this independently of the executor's `dist-before`. `diff -rq -x '*.map' -x '*.d.ts'` of 3.0.6's
    `esm/` (main checkout `node_modules`) against 3.1.0's `esm/` shows no difference. The ESM JavaScript the bundle
    consumes is byte-identical between the versions. Vite therefore resolves `lib/core` through the `module` condition
    to the same `esm/core.js` and does not pull the CommonJS build. Tree-shaking is preserved, and the chart chunk
    has no regression (0 %). `chunk-sizes.md` states this correctly.
- **UI, both themes (my domain).** I registered throwaway user `hel1824-skeptic@example.test`
  (`9cc74571-bcdd-4102-a8fc-8a21cb339c8c`) in the lane DB and created the finance template.
  - The two bar-chart panels render in dark. After a live switch to light through the command palette, the axes and
    gridlines re-theme. Evidence:
    `/home/matt/Development/helio/.concertino/runs/HEL-1824/evidence/.concertino/scratch/HEL-1824/skeptic-chart-a.png` (dark),
    `/home/matt/Development/helio/.concertino/runs/HEL-1824/evidence/.concertino/scratch/HEL-1824/skeptic-chart-light.png` (light).
  - Admin usage, with an owner tier set in the lane DB only. The lane DB has no rollups, so I replaced the
    `/api/admin/usage` XHR response in the page with the `adminUsage.fixture.ts` payload. All 4 `UsageChart` canvases
    render in light and, after a live switch, in dark. Evidence:
    `/home/matt/Development/helio/.concertino/runs/HEL-1824/evidence/.concertino/scratch/HEL-1824/skeptic-admin-usage-light.png`,
    `/home/matt/Development/helio/.concertino/runs/HEL-1824/evidence/.concertino/scratch/HEL-1824/skeptic-admin-usage-dark.png`.
  - Console: the only errors were pre-login `401 /api/auth/me`. There were no warnings.
  - Design judgment: the change has no visual delta and no styling edits, and charts render consistently with sibling
    panels in both themes. Nothing is off-pattern.
- **Cleanup:**
  - My user was deleted by exact id with `buildUserDeleteSql`. Afterwards, `users` and `dashboards` hold 0 rows for it.
  - Servers were stopped with `stop-servers.sh`, and ports 7256 and 10163 are free (`ss`).
  - The worktree is clean apart from the untracked `evaluation-2.md`, which was already present.
- **Iron Laws:** this is not a bug fix, so there is no root cause to record. Red evidence for the premise is committed
  (`red-tsc-3.1.0.txt`, TS2307 at both sites).

### Verdict: CONFIRM

### Non-blocking notes

- The executor's `dist-before` was built from a `node_modules` that did not match the lockfile. With the hashes
  normalized, chunks outside the chart code differ: `app` (lucide icon ordering), `dashboardsSlice` and `PageStatus`
  (react-router code). The main checkout has lucide 1.72.0 and react-router 7.18.5, while the lockfile and the worktree
  have 1.75.0 and 7.18.6. The lockfile diff changes only echarts-for-react, so the PR does not cause this, and it does
  not affect AC2: the chart chunk is identical. It does mean `chunk-sizes.md`'s "file hash only changed" note for
  `AdminUsagePage` is caused by that drift in unrelated packages, not by this change.
- I agree with the evaluator's earlier suggestion that `echartsCoreSubpathMock.ts:9` is a short line and should be
  rewrapped.
- After merge, close Dependabot #1221 with a comment linking this PR, as the ticket requires.
