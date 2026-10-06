## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `f6ffc9a9b4091596c51fc89f113362703693d178`. Base (live-resolved): `f4601ba2ee9300f7ecb2775a56559f234c966431`.
Diff outside the change dir: `e2e/hel1275-metric-delta-sparkline.spec.ts`,
`frontend/src/features/dashboards/ui/PublicDashboardViewerPage.history.test.tsx`. No product code, no
helio-mcp, no C1-listed file touched.

Logs for every run below: session scratchpad `hel1327-eval-*.log`.

### Phase 1: Spec Review — FAIL

The ACs are met in code, and I reproduced each red myself (details under Phase 2). The C2 evidence record
has two defects.

1. **mutation-evidence.md AC2 note is false.** It says that with `historySource` removed, "the page falls back to
   the authenticated route; in jsdom that is not observable through the mock because the output meta comes from
   the mocked public service". I checked this with a probe copy of the test under the same mutation, held 1.5 s
   and then dumped the mocks. Result: `fetchPublicOutputHistory` calls `[]`, `fetchOutputHistory` calls
   `[["out-1"]]`, and the DOM reads `Revenue1,204▲ 12% vs 7d`, which is the authenticated payload
   (`makeHistory()` default). Why: `MetricOutputPanel` always calls `useOutputHistory(..., enabled=true, ...)`.
   With `source === undefined`, the hook's fetcher is `fetchOutputHistory(outputId)`. Output meta has no bearing
   on the route choice. So the fallback IS observable. The test's three assertions (public-route exact args,
   `fetchOutputHistory` never called, DOM `2,222`/`▲ 11% vs 7d`) would each go red independently. The red is
   genuine and not vacuous. The recorded explanation is wrong, though, and it is the C2 record that gets
   archived.
2. **The D2 window-sentinel assertion was never shown red** (C2: "every new assertion is shown red"). The
   evidence says the sentinel "was not reached in this run (the count assertion failed first)". I proved it
   separately: under the same `reloadDocument` mutation, in a scratch copy of the spec with the count assertion
   removed, it fails with `window sentinel lost: a full document load replaced the page / Received: null` at
   spec :327. The guard works, but the record still has to show it.

Other checks:
- AC2/AC3/AC4 addressed explicitly; no AC reinterpreted. Scope restated per owner ruling (item 1 out), honored.
- Tasks 1.1-2.8 match the implementation.
- No scope creep. D4 hygiene (isolateLivePage, user-id log) is in design.
- Constraints C1, C3, C4 and C5 are honored. C5: exact args `("dash-1","panel-1","tok")`, `panel.id !== outputId`,
  `resetHistoryCache`/`resetComparisonStore`/`mockReset` in `beforeEach`, no `expect.any(String)`. C2 is
  partially honored (items 1-2 above).

### Phase 2: Code Review — PASS

Gates, re-run by me in WORKTREE_PATH. Root tooling resolves from the ancestor main checkout's `node_modules`,
because the worktree has no root `node_modules`.
- eslint `--max-warnings=0`: exit 0. prettier `--check .`: exit 0. Frontend `tsc --noEmit`: exit 0.
  `tsc -p e2e/tsconfig.json`: exit 0.
- Root jest: 39 suites / 375 tests passed. Frontend jest (`--maxWorkers=2`, `nice -n 19`): 443 suites / 4618
  tests passed.
- `npm --prefix frontend run build`: exit 0.
- The remaining pre-commit checks (repo-integrity, schemas, spec-structure, openspec + selftest,
  dependabot + selftest, cloud-run-cpu + selftest, scala-quality, test-temp-dir-hygiene + selftest,
  no-credential-leak + selftest, tokens + selftest) all exit 0.
- **HUSKY=0 bypass attribution: verified.** `check:helio-mcp-types` fails with
  `src/index.ts(58,52): error TS2554: Expected 0-2 arguments, but got 3`, the same error in the worktree and in
  the main checkout. The installed `helio-mcp/node_modules/@modelcontextprotocol/sdk` is 1.29.0, while
  `package.json` wants `^1.31.0` and `package-lock.json` locks 1.31.0. So the install is stale. The diff touches
  nothing under `helio-mcp/`. Every other hook check passes (above), so the bypass hid nothing in this diff.

Mutation reds re-run by me. Each mutation was reverted with `git checkout`, and `git status` is clean afterwards.
- AC2: `historySource={historySource}` deleted at the page's `PanelContent` call → both cases red
  (`Number of calls: 0` on the exact-args assertion). The probe above confirms that the authenticated route and
  the authenticated payload take over. Green on real code: 2/2.
- AC3: `reloadDocument={destination.label === "Dashboards"}` in `frontend/src/app/Sidebar.tsx` → count assertion
  red, `Received ["http://localhost:6759/"]` at :322. With the count assertion removed (scratch copy), the
  sentinel is red at :327 (`Received: null`).
- AC4: the D3 freeze mutation in `PanelList.tsx` (`gridContainerWidth` frozen at the first non-1280 measured
  value) → new wait red: `card width never changed from 333px after resizing the viewport to 1100px` (15 s poll,
  spec :84). The OLD wait (a scratch copy where `resizeAndSettle` is reduced to `setViewportSize` +
  `layoutSettled`) under the same mutation: `1 passed`. That vacuous pass is reproduced like-for-like.
- Green on real code, both themes: `2 passed (24.9s)`.

Code checks:
- No `any`. The `as never` fixture casts follow existing precedent (`PublicDashboardViewerPage.content.test.tsx`).
  The `window as unknown as Record<string,string>` cast is confined to the e2e sentinel.
- The listener is detached before the asserts. Only main-frame document requests are counted. Both are
  per design.
- DRY: `resizeAndSettle` reuses `layoutSettled`, and `isolateLivePage` replaces the inline `about:blank`.
- No dead code or TODOs. File sizes are within budget (152 / 342 lines).

### Phase 3: UI Review — PASS

Triggered by `frontend/**` (a test file only). No rendered surface changed. Servers were started with
`scripts/concertino/start-servers.sh <wt> 6759 9666 HEL-1327` and `assert-phase.sh servers` printed PASS. The
listener cwds were verified as this worktree's `backend/` (java pid 1764098) and `frontend/` (vite pid 1765195),
both freshly started by this evaluation. The live UI flow is the e2e spec: the 1440/1100 breakpoints, the
editor → dashboard navigation, and the provenance popover. It passed in both themes with no failure. Servers were
stopped afterwards by exact PIDs (1765195 1765171 1764098 1763530 1763488), and both ports are free.

### Overall: FAIL

### Change Requests
1. `openspec/changes/history-delta-test-gaps/mutation-evidence.md`, AC2 "Note:" paragraph: replace the claim that
   the authenticated fallback is "not observable through the mock because the output meta comes from the mocked
   public service". Write the observed fact instead: under the mutation, `fetchOutputHistory` is called with
   `"out-1"` and the DOM renders the authenticated payload (`1,204` / `▲ 12% vs 7d`). The reason is that
   `useOutputHistory`'s fetcher falls back to `fetchOutputHistory(outputId)` when `source` is undefined. Record
   that the test's later assertions (`fetchOutputHistory` never called, `2,222` / `▲ 11%` in the DOM) would each
   independently go red, using a probe run like the one described in Phase 1, item 1.
2. Same file, AC3 section: record a red for the window-sentinel assertion itself. Use the same `reloadDocument`
   mutation with the count assertion temporarily removed (in an untracked, since-deleted copy of the spec), and
   record the failing line (`window sentinel lost: a full document load replaced the page`, `Received: null`) and
   the created user id. Do not leave "not reached" as the sentinel's only evidence.

No test or code change is requested.

### Non-blocking Suggestions
- `resizeAndSettle`: if `before` is ever `null` (card not laid out), `.not.toBe(null)` passes as soon as the card
  appears. Today that is unreachable, because the card is asserted visible earlier. An explicit
  `expect(before).not.toBeNull()` would make that precondition visible.

### Dev-DB users created by this evaluation (not deleted; no delete route, HEL-1301)
`hel1275-<ts>-<n>@example.test` accounts, by exact id. The spec's `finally` removed their data rows.
- 6bc41805-9d8e-4131-b9fa-eb5e361ea7db (green, light)
- 64066b63-5584-4b78-9925-f19e6e3d928d (green, dark)
- c1427f7f-1ecd-4f5d-b0c4-43a1b4d0f121 (AC3 red, count)
- 88958d9a-f384-49ea-8136-1bac2d961f55 (AC3 red, sentinel)
- 5f1b9a49-552c-415b-b1de-377acff2d1da (AC4 new-wait red)
- f2591d8e-51ef-4e9e-b87f-2d347f923e8b (AC4 old-wait vacuous green)
