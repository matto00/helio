## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/echarts-for-react-3-1-0/HEL-1824`. Worktree HEAD is `00fc654f3` (= main). Only the change dir is untracked.
- **3.1.0 exports map** (`npm view echarts-for-react@3.1.0 exports ...`): it exposes only `.`, `./lib`, `./lib/*` and `./lib/*.js`, each `{types: lib/*.d.ts, module: esm/*.js, default: lib/*.js}`. There is no `./esm/*`. The design's Context claim is confirmed exactly. New declared dependency: `tslib ^2.3.0`. Peer deps are unchanged (`echarts ^3 || ^4 || ^5 || ^6`, so the repo's `echarts ^6.1.0` is fine).
- **The runtime code is byte-identical.** I ran `npm pack echarts-for-react@3.1.0` into scratch (`.concertino/scratch/HEL-1824/pkg310`, extracted only, no install) and ran `cmp` against the installed 3.0.6. `esm/core.js` and `lib/core.js` are identical. `esm/core.js` already imported `tslib` in 3.0.6. The only differences are `.d.ts` files and source maps:
  - `core.d.ts`: `render(): JSX.Element` becomes `React.ReactElement`.
  - `types.d.ts` opts: width/height widen to `number | string`, `locale` widens to `string | Record`, and `useDirtyRect`, `useCoarsePointer`, `pointerSize` and `ssr` are added.

  All of these widen types, so tsc gains no new failure beyond the TS2307 the design already plans for. Consequences:
  - The design's Risk "3.1.0 behavior changes in the component itself (e.g. option diffing)" is moot.
  - Decision 6 (the motion-spec option path is unchanged) is true by construction. The spec reads `chart.getOption()` from the echarts instance (e2e spec lines 206-236), and that does not depend on echarts-for-react at all.
  - Decision 1's prediction (Vite resolves the `module` condition to the same `esm/core.js`, so the chunk is byte-comparable) is well-founded.
- **Resolution claims:**
  - `frontend/tsconfig.json:5` has `moduleResolution: "Bundler"`.
  - Vite is 8.1.6, and `vite.config.*` has no `resolve.conditions` override (grep), so the default client conditions including `module` apply.
  - Jest is 30.3.0 with ts-jest.
  - The root `package-lock.json` has no `echarts-for-react` entry. It is only in `frontend/package.json:22` and `frontend/package-lock.json:6188`. This matches Decision 4.
- **Site count:** `grep -rln "esm/core" frontend/src` finds 39 files. `jest.mock("echarts-for-react/esm/core"` appears in 36 files. Also:
  - `frontend/jest.config.cjs:15,21` (the comment and the mapper key)
  - the two runtime imports, `ChartPanel.tsx:8` and `UsageChart.tsx:5` (confirmed)
  - two mock docblocks
  - comment-only mentions in `ChartRenderer.test.tsx:9` and in `PanelDetailModal.{panelSwitch,appearanceSentinel,themeAwareFallback}.test.tsx`

  `e2e/` has no references. This matches the premise's "~35 test files" closely enough. Every `jest.mock` uses a factory with the same literal string as the import, so moving both together keeps the same mapped module id.
- **Ticket AC coverage:**
  - "tsc, jest, e2e green": tasks 2.1, 2.2, 2.5 and 2.6. The full e2e legs are left to CI on the PR, which is acceptable.
  - "chunk size before/after": tasks 1.1 and 2.4, with an explicit 5% gzip escalation threshold in Decision 5.
  - The bump is in this PR: task 1.2.
  - The `@prod-build` driver addition is covered by task 2.6.
  - Red-first evidence (TS2307) is task 1.3.
- **Placeholders, contradictions, scope drift:** I found none. There is no TBD or TODO. The proposal, design and tasks agree with each other. `skip_specs: true` (`.openspec.yaml`) is justified: there is no API or schema contract, and runtime behavior is unchanged. No product question is open.

### Verdict: CONFIRM

### Non-blocking notes

1. **Task 1.7's grep is narrower than the sites it should catch.** Searching for `echarts-for-react/esm` misses the phrasing `` `echarts-for-react`'s `/esm/core` `` in `frontend/src/features/panels/ui/renderers/ChartRenderer.test.tsx:9` and `frontend/src/test/echartsForReactCoreMock.tsx:3`. Grep for `esm/core` instead. Decision 7's file list also omits the comment-only sites in `ChartRenderer.test.tsx` and the three `PanelDetailModal.*.test.tsx` files. Note that `ChartPanel.test.tsx:6` already says `lib/core`, so that comment becomes correct.
2. **Pick the mutation test in task 2.3 carefully.** Break the mapper target against a test that relies on the global mapper, meaning one that imports ChartPanel or UsageChart transitively and has no local `jest.mock` of its own. A test with a local factory mock goes red from the same resolution error, but that only shows the mock string matches the mapper key, not that the mapper key matches the import.
3. **The `echartsForReactCoreMock.tsx` docblock rationale ("ESM-only, no CommonJS build") will be false after the move.** Under Jest, `lib/core` resolves to CommonJS through the `default` condition. Decision 7 already plans to note this. Make sure the `jest.config.cjs:15-20` comment is reworded the same way.
4. **`e2e:prod-build` is a root `package.json` script, not a `frontend/` one.** It needs the stop-servers, then `e2e-backend.sh lane-start`, then run, then restart sequence from `scripts/e2e-prod-build.mjs:16-21`, with `DEV_PORT=7256` and `BACKEND_PORT=10163` set explicitly. Otherwise it defaults to 5173/8080, which are another lane's ports.
5. **The ticket's "check chart panels in both themes plus the admin usage chart" has no task.** It appears only under the design's Risks. The final-gate skeptic will do it in any case, but the executor should screenshot both views in light and dark mode.
6. **Closing Dependabot #1221 after merge has no task.** It is a post-merge orchestrator step, so make sure it is not dropped.
