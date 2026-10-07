# HEL-1354 boot audit (task 1.4) — written before any product-code edit

Evidence: `logs/before-requests-6787check.log.txt` (request log with CDP initiator stacks, start..end ms from
navigation, unchanged head 70b063a47), `logs/probe-strictmode-ON-baseline.log.txt` / `logs/probe-strictmode-OFF.log.txt`
(root-cause flip), `logs/before-*.log.txt` (TTI). All numbers measured on a host at load 6-18 from other lanes (see
`measurements.md`), so absolute values are inflated; only relative statements are used below.

## Root cause of the duplicate run-history GET (D1, flipped both ways)

Both `GET /api/pipelines/:id/run-history` calls have the same initiator stack:
`fetchRunHistory <- pipelinesSlice.ts:120 (thunk) <- usePipelineDetailPage.ts:386 (the unguarded
`useEffect(() => dispatch(fetchPipelineRunHistory(id)), [dispatch, id])`)`. `main.tsx` renders under
`React.StrictMode`; StrictMode dev builds run every effect twice on mount (mount, simulated cleanup, mount). The
sibling mount effect is protected by `lastFetchedIdRef`, so its five requests fire once; the run-history effect is
not, so it fires twice.

| run | StrictMode | run-history GETs | data-sources GETs | auth/me GETs | total /api requests |
|---|---|---|---|---|---|
| ON (shipped main.tsx) | on | **2** | 2 | 2 | 13 |
| OFF (throwaway local edit of `main.tsx`, `React.Fragment`, reverted) | off | **1** | 1 | 1 | 10 |

Cause present -> 2, cause removed -> 1, same harness (`e2e/zz-hel1354-probe.spec.ts`), same user/pipeline shape.
The competing candidates (SSE `onTerminal` refetch, run-submit refetches, a second page mount) never fire on a bare
page open: the log has exactly two run-history requests and both carry the line-386 initiator. **Conclusion: the
duplicate is StrictMode-only (dev server and e2e); production builds never issue it.** The ticket's "7 parallel calls
incl. a duplicate" is therefore a dev/e2e figure. The same StrictMode double-invoke also duplicates `GET
/api/data-sources` (the page's `sourcesStatus === "idle"` effect; both runs see `idle`) and `GET /api/auth/me`
(App-level, `App.tsx:370`, out of scope).

## Re-measured request inventory (one page open of a pipeline with 1 source, 2 steps, 1 Output)

13 `/api/` requests under StrictMode (10 without). Page-owned (9 under StrictMode): pipeline, steps, analyze,
schedule, outputs, data-sources (x2), run-history (x2) = 7 distinct resources, matching the ticket's "7 parallel
calls" once the duplicates are counted as the ticket's "one duplicate" (the ticket's count is a dev/e2e figure).
App-shell-owned (not this page): auth/me (x2 under StrictMode), `/api/pipelines` (sidebar), `/api/dashboards`.

## Per-call decisions (D4)

First paint = what renders once `currentPipeline` is non-null (the page shows a skeleton until the pipeline GET
resolves; the Outputs tab strip is rendered unconditionally from that moment, `PipelineDetailPage.tsx:214-247`).
Measured end times (ms from navigation, request start ~788): pipeline 916, steps 842, analyze 1019, schedule 1085,
outputs 1127, data-sources 1194, run-history 1268/1275. The tab is mounted as soon as the pipeline response is
rendered; every other response only fills in already-mounted regions.

| call | first-paint consumer (from code) | measured | decision |
|---|---|---|---|
| `GET /pipelines/:id` | page gate (skeleton -> page), header, Outputs tab strip | ends 916 ms, the critical path | keep |
| `GET /pipelines/:id/steps` | river view (step cards, lane graph) | 842 ms | keep (Steps is the default tab) |
| `GET /pipelines/:id/analyze` | StepCard input schemas, estimated rows, footer cost verdict (`PipelineDetailFooter.tsx:80,143`) | 1019 ms | keep: consumed on first paint; deferring would change what the Steps tab shows |
| `GET /pipelines/:id/schedule` | header schedule summary + enable toggle | 1085 ms | keep (visible in header) |
| `GET /pipelines/:id/outputs` | Outputs tab count `Outputs (N)`, rail chips, footer | 1127 ms | keep (the count is the tab label itself) |
| `GET /data-sources` | header root-source names/links (`sources.find`, hook :632) | 1194 ms, x2 under StrictMode | keep the call; remove the StrictMode duplicate with a once-per-mount guard (same root cause as the ticket's duplicate); no deferral because the header shows the source names |
| `GET /pipelines/:id/run-history` | persisted truncation banner ONLY when `lastRunTruncated === true`; run-history modal | 1268/1275 ms, x2 | **defer**: not fetched on boot unless `lastRunTruncated === true`; otherwise fetched on modal open; post-run refresh unchanged |

Result: a non-truncated page open goes from 13 to 10 `/api/` requests under StrictMode (run-history x2 removed,
the second data-sources GET removed) with no first-paint change; the remaining duplicate is `auth/me` (App-level,
StrictMode-only, out of scope). No other call is deferred: every other response feeds a visible first-paint element.
Consolidating them would need a new backend endpoint (out of scope; see `measurements.md` for whether it would pay).

## Is TTI request-bound or render-bound? (answered by measurement, see `measurements.md`)

Render/module-bound. The pipeline response (the only gate to the tab) lands ~130 ms after the requests start. A 6x CPU profile
(`logs/cpu-profile-6x.txt`) shows `(program)` native work 1441 ms, dev-build React 1288 ms (jsx-dev-runtime + react-dom + react), and
`PipelineScheduleDialog.tsx` 213 ms (a closed dialog mounted on every open); nothing else exceeds 75 ms. Removing three requests
therefore moves the Outputs-tab TTI by tens of milliseconds at most (post-create 6x: -3%). No further call was deferred by D4; the
`PipelineScheduleDialog` mount cost is named as a follow-up for the driver rather than widened into this ticket.
