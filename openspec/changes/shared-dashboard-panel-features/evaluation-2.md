## Evaluation Report — Cycle 2 (evaluation-2.md)

**Commit reviewed:** HEAD `cca5bee99b8a8d29faa88aa08ee1bcea7d4dd1b9`. The review base, resolved live, is `27b4a7402` (origin/main). This cycle adds four commits on top of 819b3ac05 (ab556be7c, 9ff8ee7e1, 91ce31c19, cca5bee99). Those commits change only frontend source and tests, the e2e spec and openspec files. They make no backend change.

### Fresh evidence (all of it from my own runs)

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm --prefix frontend run build` | exit 0 |
| `npm test` (3 workers) | exit 0. Root: 69 suites / 611 tests. Frontend: 858 suites / 10169 tests. 0 failed |
| Backend | No backend file changed this cycle: `git rev-parse 819b3ac05:backend` = `HEAD:backend` = `6901cd714af2…`. My cycle-1 `sbt -J-Xmx3g testFull` ran on this byte-identical tree: 9994 succeeded, 0 failed. That run covered the executor's late import move and `DashboardGranteePanelRoutesSpec` (5/5, RLS as NOBYPASSRLS `helio_app_test`). I did not run it again |
| e2e `hel1780` + `hel1773` | 13 passed. I started the servers fresh (`ANTHROPIC_API_KEY=` empty, lane DB `helio_hel1780` / DB_USER=matt for both the servers and Playwright, 2 workers). I stopped them afterwards (`STOPPED ports=7212,10119`) |
| C10 grep of `e2e/` | "Filtered within", "No loaded rows", "Quick filter across all columns", "Filter column amount" and "loaded rows of" have zero hits outside hel1780 |

**Independent mutations.** I ran these in a throwaway worktree detached at cca5bee99, then removed it; `git worktree list` is clean.
- `useOutputFilterCapabilities` key changed to `const key = outputId;` (the CR1 hole): **RED**. The new `useCrossFilterServerOps.panelScope` test fails at `b.mode` (got "server", expected "client-fallback").
- The hook's panel-scope loader changed to the Output route (`ensureCapabilitiesLoaded(key)`): **RED**, same test.
- The clash guard in `splitForPanelScope` removed: green, because no jest covers the guard. This is non-blocking; see the suggestions below.

### Phase 1: Spec Review — PASS

- **CR1 (task 3.3 / D5): resolved.** `frontend/src/features/panels/hooks/useCrossFilterServerOps.panelScope.test.tsx` sets up a shared dashboard (viewer) with two panels bound to one Output, using controls `team` and `region`, and a cross-filter on `team`. It asserts:
  - A's mode is `server`, with `crossFilterEq` on team.
  - B's mode is `client-fallback`, with no eq.
  - `fetchPublicFilterCapabilities` is called once per panel, as `(d1, pa)` and `(d1, pb)`, with no token.
  - `getFilterCapabilities` is never called.

  The red transcript `mutations/jest-d5-hook-key.txt` starts with the applied diff and fails at the right assertion. I reproduced it independently, plus the loader variant.
- **CR2 (D10 e2e): resolved.** Step 3b (lines 407-439) covers each of the following, and every step asserts that zero new per-panel rows requests went out:
  - It opens Filters.
  - Quick search "East" shows "Filtered within the 200 loaded rows of 250.", West cells count 0 and East is visible.
  - A no-match term shows "No loaded rows match your filter. Only 200 of 250 rows were searched.".
  - A filter on the non-control column `amount` shows the disclosure.
  - Clearing it removes the disclosure.

  The red transcript `mutations/e2e-quick-to-server.txt` starts with the diff. It fails at "a client-side filter sends no request" (7 vs 8). That is the correct reason: once `quick` is part of the server query, a quick-search change dispatches. It passed in my run, as part of the viewer, editor and dual-grant feature passes.
- The cycle-1 Phase 1 findings are otherwise unchanged and still hold: ACs covered, C1–C13 honoured, red proof accepted.

### Phase 2: Code Review — PASS

- **Evidence hygiene: addressed.**
  - The zero-test `jest-m9.txt` is gone.
  - Each mutation transcript I opened starts with its `git diff`: d5-hook-key, quick-to-server, m6, m9.
  - m6 now fails on an explicit `toBeVisible` of the provenance button (line 453).
  - m9 now fails on the explicit assertion "the per-panel distinct-values route answered 200" (line 366). The `waitForResponse` now has a 10 s timeout and a `.catch(() => null)`, so the failure is a clean assertion rather than a test timeout.
- **D1 shim: hardened.**
  - `configureStoreOwning(...ids)` has no default list. Every call site names its own ids: 19 files, all non-empty.
  - `renderWithStore.tsx:228` seeds `accessRole: "owner"` explicitly.
  - The fail-closed rule is unaffected. Non-owner suites still build their own stores with explicit roles, and every jest suite passes.
- **DRY.** `distinctValuesFetcher(scope, panelId, outputId)` in `panelReadScope.ts` replaces the three duplicated forks. In `PanelCardBody` it is memoized on `[scope, panel.id, outputId]`, and `scope` is identity-stable through `usePanelReadScope`'s `useMemo`. The dead `filterOutput` alias is gone.
- **Clash guard.** `splitForPanelScope.ts:72-76` never folds a cross-filter `eq` into the server query when a control `eq` already targets the same column. It is correct and commented.
- Lint, typecheck, format, build and jest are all green. There is no new `any`, and no dead code in the delta.

### Phase 3: UI Review — PASS

13/13 e2e passed on fresh servers against the lane DB. Phase 3 covered:
- The viewer, editor and dual-grant feature passes, now including R4 quick search and the column filter.
- The phone pass.
- The shared → own → shared switch.
- The C11 invariant: no `/api/outputs` or `/api/pipelines` requests, no 4xx/5xx, no console errors.

The cycle-1 breakpoint check (1440/1100/768/375, 0 px overflow) stands. This cycle's UI delta is test-only, plus a refactor that preserves behaviour: the distinct-values helper and the clash guard.

### Overall: PASS

### Non-blocking Suggestions

- Add a `splitForPanelScope` case for the clash guard: a control `eq` on `team` plus `crossFilterEq` on `team` yields exactly one `team` eq op. Removing the guard currently leaves every suite green.
