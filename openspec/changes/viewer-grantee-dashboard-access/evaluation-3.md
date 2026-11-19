## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed head: `ec096b2226ab38ee0f2cfe0bbfa68967480230df`. The base was resolved live and is `5f137cb5f`. The cycle-3 delta is commit `ec096b222`:
- `DashboardMetaRow.tsx` panel selector;
- `outputMetaCache.ts` guard for a superseded request;
- `DashboardMetaRow.scopeSwitch.test.tsx`;
- a new test in the hel1773 e2e file;
- `files-modified.md` audit.

### Fresh gate evidence (my own runs on ec096b222)

| Gate | Result | Transcript (`.concertino/scratch/HEL-1773/`) |
|---|---|---|
| lint, format:check, typecheck, frontend build | all exit 0 | `eval3-{lint,format,typecheck,build}.txt` |
| `npm test` (3 workers) | 66 + 848 suites; 579 + 10082 tests passed | `eval3-jest.txt` (persisted) |
| e2e, lane DB, 2 workers (list below) | 51 passed | `eval3-e2e.txt` (persisted) |
| `sbt testFull` | not re-run: no backend file changed since cycle 1 (9911 passed, 0 failed on 3f8202cf2) | `eval-sbt-testfull.txt` |

The e2e run covered these spec files:
- `hel1773-viewer-grantee-dashboard.spec.ts` (full file, now 8 tests);
- `hel1575-dashboard-tabs`, `-delayed-restore-no-update-loop`, `-reload-after-edit`, `-switch-measurement`;
- `hel1583-refresh-line-no-shift`, `hel1646-skeleton-refresh-slot` (the meta-row and refresh-line consumers).

### Phase 1: Spec Review — PASS

- **AC 2 ("owners are unchanged"):** the remaining evaluation-2 regression is fixed (see Phase 2).
- **Other ACs:** unchanged from cycle 1, and all met.
- **Executor deviations:** my cycle-1 rulings stand. Deviations 1, 2, 3 and 6 are acceptable and documented. Deviation 4 is now fixed, across cycles 2 and 3.
- **Constraints C1-C16:** honoured. C16 still holds: on a full load of the shared dashboard I saw no `/api/outputs` or `/api/pipelines` resource.

### Phase 2: Code Review — PASS

**evaluation-2 CR1 (meta-row facts stuck after switching from shared to owned): fixed.** I re-ran my probe with fresh users (`eval3-outputmeta-probe.txt`, persisted):

| Step | Result on ec096b222 |
|---|---|
| Desktop 1440: full load of the shared DY | the Output reads as the per-panel stub, scope set, no Output or pipeline route requested |
| Sidebar switch to a cold owned D1 binding the same Output | facts read "1 panel refreshed 5 seconds ago source · probe src" from the first 500 ms sample through 8 s; `peekOutputMeta` is the real Output (owner and pipeline set). On b097d0b95 they stayed "1 panel". |
| Phone 390: full load of DY | no refresh line (non-owner) |
| Chip switch to a cold owned D2 | refresh line "refreshed 30 seconds ago" from the first sample |

- **Fix:** option (c) from my change request. `panelsSettledFor`, which requires that the items actually belong to the selected dashboard, replaces the `loadedDashboardId`-only check.
  - It cannot drop a legitimate owned dashboard: an empty dashboard is matched by its `succeeded` + empty branch.
  - It matches what `DashboardRefreshLine` already uses (`panelsKnownFor`, which is `panelsSettledFor` plus the known-empty state).
- **Audit (judged):**
  - `DashboardRefreshLine` is correctly ruled out: it already selects with `panelsKnownFor`. The phone probe above confirms it in the running app.
  - `useOutputMeta` consumers are per-panel components keyed by panel id. They mount after `fetchPanels` has set or cleared the scope, and they read the route-aware cache. Correctly ruled out.
  - `useCrossFilterServerOps` and `usePanelSortFilter` derive from the card's `output`. Correctly ruled out.
  - I accept the audit.
- **Guard:** the `cache.get(outputId) !== entry` guard (my cycle-2 non-blocking suggestion) is correct. A superseded request now resolves only to its own callers.
- **Tests:**
  - `DashboardMetaRow.scopeSwitch.test.tsx` builds exactly the evaluation-2 scenario and asserts `getPipelineById("P")` plus the rendered source fact. The executor reports it red on b097d0b95.
  - The new e2e test asserts the owned meta row's source fact after a shared-to-owned switch, with an assertion that would catch the regression. Its red transcript `cr2-e2e-red.txt` fails at that `toContainText`, the intended assertion.
  - The test passed in my run.
- **Code quality:** no new code-quality or design [mechanical] issues in the delta. Lint, types and formatting are clean.

### Phase 3: UI Review — PASS

- The full e2e file and the meta-row and refresh-line specs pass on the final head.
- My live probe shows the owner's meta row and the phone refresh line correct after leaving a shared dashboard. The shared dashboard still shows no refresh line and makes no Output or pipeline request.
- The cycle-1 theme and breakpoint evidence is unaffected: this delta changes no markup or CSS.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

These carry over from cycles 1 and 2; none blocks:
- Make `Dashboard.ownerId` required in the type and route fixtures through a factory, to retire the fail-closed exception.
- Share one badge recipe between `.home-card__shared` and the list badges.
- Give a shared-only invited user a first-run path (deviation 2; child 4 polish).
- Cover `dashboard-changes` for shared ids in child 6.
