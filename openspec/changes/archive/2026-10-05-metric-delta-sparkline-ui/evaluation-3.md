## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD `d3f1fa78c9962619a5b802b6688bcf34bbce094b`.
- Base: `9c247cf6a22858ae0bb5285887995b31de874860`, resolved live. `main` moved since cycle 2 (`2c49bdba`).
- Commits since my cycle-2 PASS (`2f677e8d`): `618a9c36`, `deeacfdd`, `58e75072`, plus the merge `d3f1fa78`.

### Phase 1: Spec Review — PASS

Issues: none.

- **Merge `d3f1fa78` is clean.** Against the live base, the branch diff contains only `frontend/src/**`, `e2e/**` and `openspec/changes/metric-delta-sparkline-ui/**`. It does not touch:
  - `frontend/package-lock.json`, `helio-mcp/` or the backend
  - `.github/` or `playwright.config.ts`
  - The HEL-1319 lockfile and `.audit-ci` changes arrive as main's own content, not as branch edits.
- **Standing constraints.**
  - C1–C5 are still honoured. The extended e2e seeds only after `about:blank`, changes compare only through the editor UI, and its copy has no "previous run".
  - C6 (editor-shaped fixtures) is honoured. `historyFixtures.ts` `METRIC_CONFIG` is now `fieldMapping: {}` plus `aggregation: {value, agg}`, which is exactly what `buildOutputConfig` writes. The in-test configs derive from it.
- **Skeptic final-1 fix: filtered headline.**
  - `MetricOutputPanel.tsx` now resolves the value column with `resolveServerMetricField(config)?.field`, the same rule the server headline uses. Before, it used `Object.values(fieldMapping)[0]`.
  - A filtered editor-shaped aggregated metric therefore aggregates `aggregation.value` instead of showing "--".
  - RTL covers this: one surviving row gives "600". The e2e also covers it: a real text control on region "west" gives "604".
  - This also resolves the pre-existing "--" fallback I flagged in cycles 1 and 2.
- **Skeptic final-2 fix: compare mismatch.**
  - `selectMetricHistoryView` keeps the headline but suppresses the delta, the note and the sparkline when `history.compare ?? null` differs from `config.compare` (both null-normalised).
  - The provenance publish follows from that, because the published value is derived from `view.comparison`.

### Phase 2: Code Review — PASS

Gates, run fresh by me in `WORKTREE_PATH` under `nice -n 19`:
- `npm run lint` exit 0
- `npm run format:check` exit 0
- `npm run typecheck` exit 0
- `npm --prefix frontend run build` exit 0
- `npm test` exit 0: 434 suites / 4524 tests, plus 38 suites / 371 tests
- `npx playwright test e2e/hel1275-metric-delta-sparkline.spec.ts --workers=2` (DEV_PORT=6707): 2/2 passed, light and dark. This includes:
  - the filtered-state block (604, the marker, no "Compared with")
  - the editor → in-app back flow asserting "▲ 12% vs 1d"
- No backend changes, so no sbt.
- No FirstRunRoutesSpec timeout, no "Java heap space", and none of the HEL-1294/HEL-1298 flakes seen.

**Does HEL-1319's lockfile change matter? No, for the running vite and for these gates.**
- `frontend/package-lock.json` bumps the dev-only `source-map-js` 1.2.1 → 1.2.2. The worktree's installed `frontend/node_modules/source-map-js` is still 1.2.1, so the running vite (pid 7896) and my gate runs used 1.2.1.
- It is a patch bump of a source-map encoding library. It has no bearing on this feature's behaviour, tests or build output correctness. CI will install 1.2.2 from the lockfile.
- `proxy-addr` 2.0.7 → 2.0.8 is in `helio-mcp/package-lock.json` only, which the frontend, vite and these tests never load.
- No reinstall or server restart is needed for this evaluation.

**Review of the new code:**
- **`useOutputHistory.ts`, bounded refetch.**
  - The refetch runs when the cached `history.compare` differs from `expectedCompare`.
  - It is guarded by a per-hook ref keyed on `(key, expectedCompare)`. A server that keeps answering the old compare cannot loop: the ref short-circuits, and RTL asserts the fetch count stays at 2 after 50 ms.
  - The effect dependencies are correct.
- **`metricHistoryView.ts`.** The `configCompare` normalisation treats absent and `null` as the same, which is tested.
- **Tests.**
  - A publisher-side provenance guard test checks that the published comparison is non-null while the delta shows, removed on unmount, and null under an applied filter (filter built through `buildViewerControlFilterOps`).
  - A refetched-history test checks that the new compare renders "vs 30d".
  - A None test covers compare `null` against a cached 7d history.
  - These would catch a real regression in each guard.
- **CSS comment.** The misplaced comment I flagged in cycle 2 is fixed: the 1.5px stroke rationale now sits above the polyline rule.
- No dead code, no `any`, no inline FQNs. DESIGN.md mechanical rules hold; the cycle-3 CSS change is comment-only.

### Phase 3: UI Review — PASS

All checks ran live on 6707/9614. Seed data:
- my user, with 2 panels on one editor-shaped aggregated metric Output at the default 3x2 size
- a real 7d baseline (1075 → 1204)

I waited 45 s after seeding so the dataset-write auto-run settled before I counted any requests.

**Editor → back, with no reload.**
- Every hop was an in-app link click: Data Pipelines → pipeline → Outputs tab → editor → Save → Dashboards. `performance.getEntriesByType("navigation").length` stayed at 1 throughout, so nothing reloaded.
- **Light theme, 7d → 1 day:** both cards show "1,204 ▲ 12% vs 1d" with the sparkline (`eval-3-compare-switch-light.png`).
- **Dark theme, 1d → 30 days:** both cards show "1,204 · 30d comparison available from 10/28/2026" (`eval-3-compare-switch-30d-dark.png`). That date is the oldest point, 2026-09-28, plus 30 days, which is correct.
- **Dark theme, 30d → 7 days:** both cards show "▲ 12% vs 7d" (`eval-3-compare-switch-7d-dark.png`).
- **Provenance after the switch:** "Compared with 7 days ago · 1,075".

**Refetch is bounded.** Network log of `/history` requests:
- Light session: exactly one initial fetch, shared by both panels (#600). Then exactly one refetch after the compare change (#640). Nothing further after 10 more seconds.
- Dark session: initial #601, then one refetch per compare change (#640 after 30d, #676 after 7d). No repeated fetches. The two panels on the same Output share each request.

**Public dashboard.**
- Each public panel makes one `/panels/:p/history?token=` request (#590, #591), with no mismatch refetch. The public output-meta carries the full config, including `compare`, from `findConfigsByIdsInternal`.
- The cards render "▲ 12% vs 7d".

**Console.** The only errors were `GET /api/pipelines/:id/schedule` 404s on the pipeline page for a pipeline with no schedule. That page is untouched by this branch, so they predate it. No errors from the dashboard or metric flows.

Seeded rows were deleted by exact id (all 204):
- dashboard 0eddbdcd…
- pipeline 9849e3b4…
- source 0a03fa85…

History row ab83a75f… (output dc4796ec…) was the backdated one.

Screenshots, persisted under `/home/matt/Development/helio/.concertino/runs/HEL-1275/evidence/openspec/changes/metric-delta-sparkline-ui/screenshots/`:
- eval-3-compare-switch-light.png
- eval-3-compare-switch-30d-dark.png
- eval-3-compare-switch-7d-dark.png

### Overall: PASS

### Non-blocking Suggestions
- **Theoretical race with several panels on one Output.** Each mounted panel has its own refetch ref. With several panels on one Output, a second panel's effect could call `invalidateHistory` while the first refetch is still in flight. That would drop the in-flight promise and issue one extra request per panel, which is still bounded. Live with 2 panels I observed a single shared refetch. If it ever matters, key the "already refetched for this compare" marker in the module cache, not in a per-hook ref.
- **Leftover long-title footer clipping.** The footer clipping at 1100 with a three-line title, from cycle 2, already happens on main. Still a candidate follow-up.
