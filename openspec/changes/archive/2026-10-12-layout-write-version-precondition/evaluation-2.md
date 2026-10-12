## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed head: `c9326e561a65c38454e9f9babb7bc9164738bc19`. That is fix commit `2fb087662` plus a merge of `origin/main` at `a369a9cb8`.
Diff base, resolved live: `a369a9cb84a0966adb3c8c9d515838ebfbf6bb15`.
Evidence dir: `/home/matt/Development/helio/.concertino/runs/HEL-1457/`. All cycle-2 logs are prefixed `hel1457-eval2-`.

### Gates, run fresh on the merged head

| Gate | Result | Log |
|---|---|---|
| `npm run lint` / `format:check` / `typecheck` / `check:schemas` | all exit 0 | hel1457-eval2-{lint,format:check,typecheck,check:schemas}.log |
| `npm test` | 48 + 575 suites, 454 + 6855 tests, all passed | hel1457-eval2-jest.log |
| `sbt testFull` | 7414 passed, 0 failed, 4 canceled; `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0` | hel1457-eval2-sbt-full.log |
| e2e: hel1457 (now asserts 2 grid items and no "Unsaved changes" **before** reload), hel1230, hel1028, hel1023 | 20/20 passed | hel1457-eval2-e2e.log |

The merge brings in only HEL-1494, which touches no layout code. V127 is still the newest migration, and V122/V123 are untouched. The cycle-1 red-first and mutation evidence (`hel1457-eval-red-base.log`, `hel1457-eval-mutation1.log`) still applies, because the backend main code is unchanged since 4a5864fe2.

### Phase 1: Spec Review — PASS

- CR1 (D7e) is fixed. After the response is adopted, `useLayoutSave.ts` now dispatches `fetchPanels(dashboardId)` right after `markDashboardPanelsStale`.
- CR2 (D7c) is fixed. Adoption is now decided from the store by reference (`storeLayout === dashboard.layout`), not from `latestLayoutRef`.
- CR3 is fixed. The duplicate/import spec now really imports an export and asserts `layoutVersion` is 0.
- Acceptance criteria and tasks are all met.
- Constraints C1–C5 are honoured:
  - C1: the guard line is present in the sbt log.
  - C2: V127 is still the next free migration, and V122/V123 are untouched.
  - C3: no panel locks.
  - C4: no inline FQNs.
  - C5 (I1): rechecked for the new adoption test, see below.

### Phase 2: Code Review — PASS

- **I1 with the new adoption test.**
  - "Adopted" is true only when the reducer put the response object itself into the store, which it does only when the store still equalled `sentLayout`.
  - In the edited-during-retry case, the store keeps the local layout and the old version (`keepLocalLayout`). So adopted is false, and the hook keeps the old baseline and version.
  - The second test in `DesktopPanelGrid.layoutConflict.test.tsx` still covers this and passes.
- **CR2's test can fail.** The first test in the same file now asserts three things after a rebased save: `hasPendingLayout === false`, `fetchPanels` was called with `"d1"`, and the next flush sends nothing.
  - The cycle-1 code fails these: the live probe showed exactly a stale pending flag and an extra 409 then 200.
- **`adoptedLayoutRef` guard: this was the orchestrator's specific question. My finding is that it is redundant: harmless, but not needed in either order.**
  - **Effect runs first** (the order seen in the real browser in cycle 1):
    - The ref is not yet set, so the effect classes the adoption as a placement extension. It extends the old baseline, leaves the version alone, and sets pending to true.
    - The `.then` then sees adopted is true. It sets `persistedLayoutRef`/`persistedVersionRef` to the response and recomputes pending as false.
    - The guard never takes part in this order.
  - **`.then` runs first:**
    - `.then` sets the baseline and version to the response. It briefly sets pending to true, because `latestLayoutRef` is still `nextLayout`.
    - Without the guard, the effect then classes the adoption as a placement extension. `extendBaseline` skips ids the baseline already holds, so the baseline stays equal to the adopted layout and the version is not touched. Pending is recomputed as false.
    - With the guard, the effect re-baselines (class 4) using the store's version, which equals the response's version.
    - The end state is identical either way.
  - This matches the executor's own note that disabling the guard alone fails no test: no order exists in which the guard changes the outcome.
  - Its comment ("whichever of the effect and the save's `.then` runs first") implies it is needed for correctness, which it is not.
  - Non-blocking: remove it, or keep it with an honest comment. It is not dead (it runs), but it has no observable effect.
- `useStore<RootState>()` straight from `react-redux` follows existing precedent (`usePanelData.ts:94`, `usePanelSortFilter.ts:110`).
- No new dead code, no TODOs, and the code-quality and design standards are met. The diff has no UI copy or markup changes.

### Phase 3: UI Review — PASS

I started the servers with `start-servers.sh` on 6889/9796 and `assert-phase.sh servers` passed. The probes used my own throwaway user `hel1457-eval-1791796834@example.test`, id `2cad3c2e-2844-4b6e-88f1-45047e0aa614`, checked via `/api/auth/me` before use. They ran in an isolated headless Chromium context, not the shared MCP browser.

- **CR1, D7e** (`/home/matt/Development/helio/.concertino/runs/HEL-1457/evidence/.concertino/runs/HEL-1457/hel1457-eval-probe/d7e-probe-cycle2.log`):
  - Sequence after a drag, a second panel created through the API, then Save now: PATCH 409, PATCH 200, then `GET /api/dashboards/:id/panels` 200.
  - Grid items without a reload: **2** (cycle 1: 1). The other writer's panel is visible and no conflict toast is shown.
  - Screenshot: `.../hel1457-eval-probe/hel1457-d7e-after-save-no-reload-cycle2.png`.
- **CR2** (`.../hel1457-eval-probe/pending-probe-cycle2.log`):
  - After the 409 then 200: unsaved is **0** (cycle 1: 1).
  - A second Save now sends **no writes** (cycle 1: another 409 then 200).
  - One autosave interval later: unsaved is still 0 and there are no writes.
- **Extra check** (`.../hel1457-eval-probe/pending-probe-c-cycle2.log`): one more drag after the rebased save, then Save now, gives a single PATCH 200 with no 409. This shows the hook's version moved forward to the adopted response.
- The plain (non-conflict) save is unchanged: one 200, and the indicator clears.
- Console: the only error is the browser's own "Failed to load resource … 409" line for the expected conflict response. There are no app exceptions.
- Breakpoints and accessibility: the diff has no markup, CSS or interactive-element changes. The affected e2e specs, including hel1028's xs case, pass.
- Cleanup: all probe dashboards were deleted by exact id, and the user now has 0 dashboards. Servers were stopped by exact PID: 680940/680745 (sbt run JVM and launcher) and 681298/681283 (vite and npm). Ports 6889/9796 are free, no sbt server is left over, and the worktree is clean.

### Overall: PASS

### Non-blocking Suggestions

- Remove `adoptedLayoutRef` (`useLayoutSave.ts`: the ref, `isAdoptedResponse`, and the `if (adopted) adoptedLayoutRef.current = …` line), or rewrite its comment to say it is belt-and-braces. As shown above, the store-based adoption check in `.then` decides the outcome in both orders.
- Carried over from cycle 1:
  - `isLayoutConflict` treats any 409 as a layout conflict. Consider also requiring the body's `dashboard`.
  - A rebased save whose response is replaced in the store by an unrelated fetch before `.then` runs leaves pending set to true until the next change. That needs a narrow race; it is cosmetic and converges on the next edit.
- The throwaway user `2cad3c2e-2844-4b6e-88f1-45047e0aa614` still exists in the shared dev DB with no dashboards. The evaluator holds no DB credentials, so leave it to the run's user cleanup.
