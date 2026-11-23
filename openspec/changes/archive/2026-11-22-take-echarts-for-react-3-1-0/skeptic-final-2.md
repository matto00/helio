## Skeptic Report — final gate (round 2, skeptic-final-2.md)

This is a re-gate because the head moved (a merge of origin/main), not a response to a REFUTE.
Reviewed HEAD `70cab2a9236e986df49abe8582cd83a0f140ce03`. The base was resolved live with
`resolve-review-base.sh`: `d350dd7ae9fb0a5f790cbb8c169a5b8cc6ea4fe4` (origin/main, HEL-1615 #1236). It is an
ancestor of HEAD.

### What I verified (with evidence)

- **Spawn cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/echarts-for-react-3-1-0/HEL-1824`.
- **Scope against the base:** `git diff d350dd7ae...HEAD` touches only these files outside the tests and openspec:
  - `frontend/package.json`: `^3.0.6` becomes `^3.1.0`.
  - `frontend/package-lock.json`: 3.1.0 with its new integrity hash, plus the new `tslib` dependency.
  - `frontend/jest.config.cjs`: the mapper key and its comment.
  - `ChartPanel.tsx:8` and `UsageChart.tsx:5`: the import specifier.
  - Two test mocks under `frontend/src/test/`.

  Every test-file change swaps `esm/core` for `lib/core`. A grep for `echarts-for-react/esm` across `frontend/src`, the frontend config and `e2e` finds 0 hits. Every remaining `echarts-for-react` mention that does not use `lib/core` is a comment.
- **What changed since round 1 CONFIRMed `020b3a36e`:** `git diff --stat 020b3a36e HEAD` (non-openspec files) shows:
  - HEL-1615's files from main.
  - The one-line mock move in `PanelDetailModal.appearanceSave.test.tsx`, from `70cab2a92`.
  - A comment reflow in `echartsCoreSubpathMock.ts`.

  `ChartPanel.tsx`, `UsageChart.tsx`, `echartsCore.ts` and `useChartEntranceMotion.ts` are not in that diff, so this branch's chart runtime code is unchanged since round 1.
- **Red for the merge:** `red-merge-appearanceSave.txt` shows `Cannot find module 'echarts-for-react/esm/core'`. That matches the installed package. `frontend/node_modules/echarts-for-react` is version `3.1.0`, and its `exports` map lists only `.`, `./lib`, `./lib/*.js` and `./lib/*`, so `esm/core` cannot resolve. Each `lib/*` entry maps the `module` condition to `./esm/*.js`.
- **AC1 (tsc and jest), re-run at HEAD (logs in `.concertino/scratch/HEL-1824/sk2-*.txt`):**
  - `npm --prefix frontend run typecheck` exited 0.
  - `npm run lint` exited 0.
  - The full frontend jest suite (`--maxWorkers=3`, nice 19) exited 0: 919 suites and 10,596 tests passed.
  - `PanelDetailModal.appearanceSave` run alone: 5/5 passed. The moved mock is load-bearing, since without it the suite fails to resolve (the red above).
- **AC1 (e2e):** I did not re-run it, on purpose. The built chart chunk is byte-identical (next bullet), and none of the branch's runtime chart code changed. The merge brings only HEL-1615's modal-save logic, which is already reviewed on main. Its new `e2e/hel1615-panel-modal-appearance-save.spec.ts` reads ECharts through the runtime fiber helper (`support/echartsFiber`), not through a module specifier. Round 1 ran the motion and prod-build e2e. The 8 CI e2e legs run on the PR.
- **AC2 (chunk size), from my own `npm --prefix frontend run build` at HEAD:**

  | Chunk | Raw | Gzip |
  | --- | --- | --- |
  | `useChartEntranceMotion-CSmy2lrY.js` | 651.30 kB | 218.39 kB |
  | `ChartPanel-BY2vvn0l.js` | 20.90 kB | 7.46 kB |
  | `AdminUsagePage-BBkqXUH7.js` | 12.18 kB | 4.00 kB |

  The chart chunk's sha256 is `048592611ee8874933c891999cd938821e429bdad37fdacb382bc818d4c4e4db`. That is the same hash `evaluation-3.md` reports and the same chunk round 1 compared against the pre-bump base. `chunk-sizes.md` is accurate, and there is no regression. This rests on content hashes, not mtimes.
- **UI and design judgment:** I did not repeat it this round. The chart code and the built chart chunk are unchanged since round 1's two-theme visual check, so a new screenshot pass would only re-measure identical bytes. I started no servers.

### Verdict: CONFIRM

### Non-blocking notes
- none
