## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `81452052d25b4f2d7d7ba299053a1d321916e134`. Base resolved live with `resolve-review-base.sh`: `cdb9e43d669a1e3045ed6c3c15cf025a2547fe75` (exit 0). The spawn-cwd guard printed `READY`. Durable evidence is under `/home/matt/Development/helio/.concertino/runs/HEL-1326/evidence/skeptic-final-1-evidence/` (written below as `EV/`).

### What I verified (with evidence)

**Diff read in full** (`git diff cdb9e43d6...HEAD`, 56 files):
- Backend:
  - `OutputSummaryReducer.metricField`/`metricOf`
  - `NodeSnapshotRepository.listFieldCells`
  - `OutputFilteredMetric`
  - `OutputService.rows`
  - `PublicPanelRowsResolver` and `PublicPanelRowsResponse`
  - History identity: `ResolvedHistoryPoint.metric` and the protocol writer
- Four schemas.
- Frontend:
  - Resolver
  - History selector
  - Thunk, slice and types
  - `PanelContent`/`MetricOutputPanel`
  - Public hook
- helio-mcp types.

**AC1, filtered headline: met.**
- `OutputFilteredMetric.compute` runs only for kind = metric, a resolved filter and offset 0. It is called after ACL and after `resolveFilter`. It uses the same `filterWhereFragment` and `nodeFilterFragment` as `listRowsPaged`.
- The client shows the value only when its field/agg match `resolveServerMetricField(config)`.
- Live check, in my own headless Chromium context (not the shared MCP browser). Setup: 500 rows, east/west alternating, `amount = i+1`, viewer dropdown `region = east`.
  - API: `total 250, items 200, metric {"field":"amount","agg":"sum","value":62500}`. The loaded-page sum would be 40,000.
  - The panel renders **62,500** in both light and dark.
  - Evidence: `EV/probe.log`, `EV/probe-dark.log`, `EV/hel1326-filtered-{light,dark}.png`.
- A client-fallback cross-filter keeps the loaded-rows value plus the HEL-588 disclosure, per D5 `existing-disclosure`. C3 holds: there is no new copy.

**AC2, metric field: met.**
- Server and client both resolve `fieldMapping.value`, then `aggregation.value`, then none.
- Live:
  - The lone-label Output's rows `metric` is `null`, with the key present.
  - Its history `current` is `{"metric":null,"value":null}`.
  - The panel shows `--`.
  - The `{label}` + `aggregation.value` Output resolves to `amount`. It shows 125,250 unfiltered and 62,500 filtered.

**AC3, reds: demanded and confirmed by me.** Method: a throwaway detached worktree at HEAD, with main's production files checked out. I deleted `OutputFilteredMetric.scala`, the measurement spec and the `listFieldCells` repo test there, because they reference new APIs and cannot compile on main. The worktree was removed afterwards.
- **Frontend** (`EV/red-frontend-main.log`; ts-jest with diagnostics off, `--maxWorkers=2`): 14 fail on main. These match the claims:
  - The 6 `metricField` fixture cases.
  - 2 `resolveServerMetricField` cases.
  - 2 out-of-window baseline-identity cases.
  - The filtered-headline RTL: main renders `1,700`, not `4,200`.
  - The clear-filter RTL.
  - The lone-label RTL.
  - The public filtered-headline RTL.
- The D5 guard suite passes on main.
- **Backend** (`EV/red-backend-main.log`; the compile ran against main's code, proven by a first attempt that failed on `r.metric`): 17 fail on main.
  - Reducer: 3. Seam fixture: 6. Rows route: 5. History identity route: 3. This includes HEL-1327 item 1.
  - All `GUARD:` cases pass on main.

**Guards are failable** (my own mutations on branch code):
- **Slice clear** (`metric ?? existing?.metric`): the clear-filter test fails (`EV/mut1.log`).
- **Dropped field/agg check** in `MetricOutputPanel`: the mismatch test fails (`EV/mut2.log`).
- **D5 carve-out removed** (`filteredMetric={filteredMetric}`): the D5 guard fails (`EV/mut3.log`).

**D5 fixture change (cycle 2) hid no coverage.**
- The test is new on this branch; it is not a pre-existing test that was weakened.
- On branch code, both the old fixture `{label: region}` and the new one `{value: amount, label: region}` resolve to amount/sum, so the carve-out was exercised either way.
- The edit only makes the guard pass on main, which C1 requires of a guard.
- Lone-label coverage still lives in real reds: RTL, both resolver ports and the shared fixture.

**Client headline rule:**

| State | Result |
|---|---|
| Match | full-set value; `value: null` shows empty |
| Mismatch | loaded value (mutation-proven) |
| `metric: null` with a no-field config | empty (identical to the loaded fallback, which is also empty for no field) |
| `metric: null` with a field config | loaded value |
| In flight | the slice keeps the previous page-0 `metric` alongside the previous rows, so the headline and rows stay mutually consistent. A first filter from unfiltered has no metric, so it shows today's loaded value. |
| Superseded responses | dropped by the existing stale guard |

The rule is right.

**History identity guard does hide a mismatched out-of-window baseline.**
- `baseline.metric !== undefined` takes precedence over the `points` lookup.
- Unit reds pass: another field gives no delta, and a null identity gives no delta.
- The route red proves the server emits `baseline.metric` for a baseline older than the 30 returned points.
- Selection is unchanged (GUARD), which keeps HEL-918 D6.
- C2 holds: there is no migration and no backfill (`git diff --stat` shows no `db/migration`).

**Gates re-run by me at HEAD:**

| Gate | Result |
|---|---|
| `npm run lint` | 0 |
| `typecheck` | 0 |
| `format:check` | 0 |
| frontend jest `--maxWorkers=2` | 441 suites / 4610 tests pass (`EV/jest-full.log`) |
| `check-schema-drift.mjs` | in sync, 122 |
| helio-mcp `tsc --noEmit` | 0 |
| `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull` | succeeded 6069, failed 0, canceled 1 (the opt-in measurement spec). The new specs did execute (`EV/sbt-testFull.summary.txt`). |

`sbt --client shutdown` was run separately. I did not re-run root jest; this change touches no root-jest file.

**UI judgment:**
- No new component, copy or styling. The headline reuses `MetricRenderer`, and the no-field state is the existing `-- / NO DATA`.
- Light and dark screenshots are visually consistent with sibling panels.
- There are no console errors beyond rate-limit 429s and pre-login 401s caused by my own probe's pacing. The 429s came from my first run firing 5 navigations plus API calls inside one minute for one user; they are not a product defect.

**Dev DB records created** (shared dev DB, exact ids, NOT deleted):
- users `11d5c803-a97f-411b-b01a-21d3176de0de` (registered by an aborted first probe; no other rows) and `d3a242b4-1547-4e4f-a23d-ce3eb5b732da`
- source `91161b47-8ac1-4505-8f12-5b35d53ec0a1`
- pipeline `fbf1a15f-d983-4278-8a29-9834d45fedba`
- outputs `3d74a1dd-c211-4060-82c5-1252bf1763d5`, `3952694e-1c7e-4c29-ba87-7b8ebc9dc5c0`, `726e1cf2-775d-438f-a489-29ceabf7eb55`
- dashboard `1c61a16c-7e61-4ea6-bc3d-2eebd8a62aaf`
- panels `d20af4d7-16f1-43c0-8729-2935a7ed8b9c`, `d1d49cba-8e39-417a-81db-061ec92c29ae`, `04297503-6a0b-4ddd-8449-33aca0252ace`

See `EV/created.json`. The dev servers I started (PIDs 1548106/1548091 vite/npm, 1547639/1547363 sbt) were stopped by exact PID.

### Verdict: CONFIRM

### Non-blocking notes
- **PR body (delivery step, required by D3/D4):** state the D4 residual (raw API/MCP keep old spurious stored values until retention ages them out; no V117) and the D3 measurement command and numbers (45 ms added at 120k/60k).
- **C1 labelling nits:**
  - `PanelCard.filteredMetric.test.tsx` "ignores a filtered metric computed from a different field/agg…" passes on main but its title lacks the `GUARD:` prefix. `red-green-evidence.md` does list it as a guard.
  - The lone-label RTL's title says main "aggregated the label column". On main, a no-agg lone label actually showed the first row's label cell (`east`); the assertion itself is right.
- The `filteredMetric === null && resolvedMetric === null ? ""` branch in `MetricOutputPanel` is redundant with the loaded fallback, which is also `""`. Flattening the nested ternary, as the evaluator suggested, would be clearer.
- Every page-0 poll of a filtered metric panel now issues one extra unbounded single-column read. It was measured as cheap (45 ms at 120k rows), but it is worth keeping in mind for join/union fan-out nodes, which have no row cap.
