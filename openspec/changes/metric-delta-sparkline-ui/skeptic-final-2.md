## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `deeacfdd69890423987dcdbecde375ba151db8d8`. Base resolved live by `resolve-review-base.sh`: `2c49bdba8ffe0df5df65b2c951c0b9bb73173c2b`. The diff is 46 files: frontend, e2e and openspec only. No backend, `ci.yml` or `playwright.config.ts` change and no migration, so C1 holds. Evidence paths below are relative to `/home/matt/Development/helio/.concertino/runs/HEL-1275/evidence/openspec/changes/metric-delta-sparkline-ui/screenshots/`.

### What I verified (with evidence)

**Guards and servers**
- `assert-cwd.sh` returned `READY`.
- `assert-phase.sh servers … 6707 9614` returned `PASS servers`.
- The cwds of pids 7896 and 7435 resolve to this worktree's `frontend/` and `backend/`. I reused both servers and killed nothing.

**Gates, run fresh in the worktree under `nice -n 19`**

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm test` | exit 0: 434 suites / 4520 tests, plus 38 suites / 371 tests |

- No FirstRunRoutesSpec timeout, no "Java heap space", and neither HEL-1294 nor HEL-1298 came up.
- No backend code changed, so I ran no sbt.

**Exit-criterion e2e**
- I ran a byte-identical copy of `e2e/hel1275-metric-delta-sparkline.spec.ts` and `e2e/support/historySeed.ts` (checked with `cmp`) from a scratch dir. Settings: `DEV_PORT=6707`, at most 2 workers, under nice, in its own headless context.
- Result: **2/2 passed** (light and dark), covering:
  - "1,204" and "▲ 12% vs 7d" with a visible sparkline at default 3x2, at 1440 and 1100;
  - the "Compared with … 1,075" row;
  - a real text viewer control set to "west", which gives "604", the marker, no delta and no sparkline, and no "Compared with" row.
- Compare is chosen through the editor UI (C5).

**Round-1 CR1: filtered headline for the editor-written shape. Fixed, red-first proven.**
- `MetricOutputPanel.tsx:54` now uses `resolveServerMetricField(config)?.field`.
- Mutation: I reverted that line to `Object.values(cfg.fieldMapping)[0]` in a scratch copy of `frontend/`. Three HEL-1275 tests went red, including "an applied viewer filter computes the headline from the filtered rows".
- Two unrelated `CONTROL_FITNESS`/`KIND_REQUIREMENTS` tests also failed in the scratch copy. They read backend Scala files by relative path, so that is an artifact of the copy.
- Live, with a real **dropdown** control on my own dashboard: "west" gives **604**, and the "Comparison hidden" marker is keyboard-focusable with title "comparison reflects unfiltered data". Both themes.
  - Screenshots: `skeptic-final-2-sk2-filtered-light.png`, `skeptic-final-2-sk2-filtered-dark.png`.

**Round-1 CR2: publisher-side guard. Fixed, red-first proven.**
- Mutation: I forced `MetricOutputPanel` to always publish a comparison. The new test "publishes the comparison for provenance only while the delta shows (publisher side)" went red (1 failed / 41).
- Live: the filtered panel's popover has 0 "Compared with" headings; the unfiltered panel shows "COMPARED WITH 7 days ago · 1,075" (`skeptic-final-2-sk2-prov-dark.png`).

**Other guards, re-checked**
- Removing `viewerFilterActive` from `filterActive` in `PanelContent.tsx` turns 3 tests red.
- The scratch copy was restored and diffed identical afterwards. The worktree was never mutated.

**C6 (editor-written fixture shape)**
- `historyFixtures.ts` `METRIC_CONFIG`, `OutputEditorSheet.compare.test.tsx` and the e2e all use `fieldMapping: {}` plus `aggregation: {value, agg}`.
- The remaining `fieldMapping: {value…}` cases in `metricHistoryView.test.ts` are deliberate selection-rule unit cases, not metric panel fixtures.

**C4 ("previous run")**
- There is no UI copy with that phrase. The only hits are code comments.
- The picker label is "Previous"; the aria text is "versus the previous point".

**Public path, live, light and dark, fresh unauthenticated context**
- The only history requests were `/api/dashboards/<d>/panels/<p>/history?token=`.
- No output or pipeline id appears in the DOM.
- The public history payload contains no `outputId`, `runId`, `triggerSource` or output id.
- The public provenance popover shows the "Compared with" row.
- No console errors.
- Screenshots: `skeptic-final-2-sk2-public-light.png`, `-dark.png`, `-public-prov-dark.png`.

**Visual judgment, default 3x2 in the running app, light and dark** (`skeptic-final-2-sk2-default-{light,dark}.png`, `-dash-{light,dark}.png`)
- The value, then an inline row with the delta and a short accent sparkline, then the intact footer: it reads as one unit, and the sparkline stays secondary.
- The delta is 10px JetBrains Mono on `--app-success`: rgb(22,109,67) in light, rgb(76,195,138) in dark. The stroke is `--app-accent`. Both themes are at parity.
- The provenance row matches its siblings' heading and value styles.
- The muted "Comparison hidden" note sits naturally under the filtered value.
- No design objection.

**Live finding: the compare picker's choice does not reach an already-visited dashboard (stable, reproduced twice, with a control)**

The flow:
1. Open the dashboard. It shows "▲ 12% vs 7d".
2. Navigate in-app to the pipeline, open the Output editor, choose **30 days**, Save. `GET /api/outputs/:id` confirms `compare: "30d"`.
3. Go back in-app to the dashboard.

| Run | Compare chosen | Shown on SPA return | Shown after a full reload |
| --- | --- | --- | --- |
| 1 | 30 days | **"▲ 12% vs 7d"** | "30d comparison available from 10/28/2026" |
| 2 | 1 day | **"▲ 12% vs 7d"** | "▲ 12% vs 1d" |

- Screenshots: `skeptic-final-2-sk2-stale-spa.png` and `-stale-reload.png` (run 1), `-stale-spa-2.png` and `-stale-reload-2.png` (run 2).
- **Control:** the identical flow changing **Format** to Percent *does* propagate on SPA return ("120,400%", `skeptic-final-2-sk2-format-control-spa.png`). The dashboard does receive the updated Output config; only this change's history cache is stale.
- **Root cause, from the code:**
  - `outputHistoryCache.ts` keeps a resolved value for the page lifetime, keyed `output:<id>`.
  - `useOutputHistory.ts:149-157` refetches only on mount-with-no-cache, or on a pipeline-terminal event.
  - `selectMetricHistoryView` (`metricHistoryView.ts`) guards the metric field/agg against the current config, but never compares `history.compare` with `config.compare`.
- The probe sources are persisted as `skeptic-final-2-probe.spec.ts.txt` and `skeptic-final-2-probe2.spec.ts.txt`.

**Cleanup**
- My probe's dashboard `093fabb1-…`, pipeline `c879d569-…` and source `b2086357-…` were deleted by exact id (204 each).
- A DB count of 0 confirms they are gone, along with output `0908640d-…` and its history.
- The e2e spec removed its own rows.
- Users remain because there is no self-delete route:
  - mine: `hel1275-sk2-1791252338921@example.test` and `hel1275-sk2-1791252585621@example.test`;
  - plus the two e2e-run users.
- One probe run hit the general `/api` rate limit (429) mid-run. I waited and retried; that is environmental.

### Verdict: REFUTE

### Change Requests

**1. A saved compare choice is not reflected on an already-loaded dashboard until a full reload.** The panel keeps showing the old window ("▲ 12% vs 7d" after the author chose 30 days or 1 day). By the same path, it would keep showing a delta after the author chose None.

- **Why it matters:**
  - This is the HEL-918 exit-criterion flow itself: "no configuration beyond choosing compare".
  - Other Output config edits (Format) already propagate on the same navigation, so this regression is specific to this change's cache.
- **Where:** `frontend/src/features/panels/history/useOutputHistory.ts:149-157` and `metricHistoryView.ts` `selectMetricHistoryView`.
- **Fix:**
  - When the cached `history.compare` differs from the current `readMetricConfig(config).compare` (null-normalised), treat the history's comparison as stale.
  - Suppress the delta, note and provenance publish, the same way the field/agg identity guard does, and trigger an invalidate-and-refetch of that key.
  - Alternatively, invalidate `outputHistoryKey(outputId)` when an Output update succeeds. The compare-mismatch guard is still preferable, because it is local and failable.
- **Proof required:**
  - An RTL test in `PanelContent.metricHistory.test.tsx`: cached history `compare: "7d"`, config `compare: "30d"` (editor shape, C6). Assert that no "vs 7d" renders and that the history fetcher is called again. It must be shown red with the guard removed.
  - Re-run the live SPA flow above (or extend the e2e) to show the new choice appears without a reload.

### Non-blocking notes

- **Unevaluated fix commit:** `workflow-state.md` records the last evaluator PASS at head `2f677e8d`. There is no `evaluation-*.md` for `618a9c36`/`deeacfdd`, so this gate reviewed the fix commit without an evaluator pass on it. I verified the fix commit independently above, but the orchestrator should make sure the gate chain is complete before merge.
- **psql in CI:** `e2e/support/historySeed.ts` shells out to `psql`. Watch the first CI e2e run, as noted in round 1.
- **Uncommitted screenshots:** the change's `screenshots/` dir is untracked (`git status`), so the executor's screenshots are not committed. They live only as persisted evidence.
- **Scope addition:** the `OutputEditorSheet.tsx` seeding of the metric field from `aggregation.value` should still be mentioned in the PR body (carried over from round 1).
