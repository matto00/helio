# HEL-1354 measurements (tasks 1.2, 1.3, 3.4)

Raw logs: `logs/` in this directory (file names quoted per row). Dev servers: after = this worktree's Vite on `:6786`;
before = an identical Vite serving a detached `git worktree` of base commit `70b063a47` on `:6787` (scratch, outside the repo;
its `vite.config.ts` proxy rewrites `Origin` to `:6786` so the backend CORS allow-list accepts browser writes), both on the same
backend `:9693`. The post-create comparison and the 6786-based runs also stashed/popped the product files on `:6786` (see the
"pcbefore" rows) so before/after share one server. Every Playwright run: own headless context, `nice -n 19`, `--workers=1`
(hel910: `--workers=2`), CDP `Emulation.setCPUThrottlingRate`. The host was shared with other delivery lanes for the whole run
(load average 6-18 outside the hel910 gate windows), so **absolute numbers are inflated and noisy; only paired, interleaved
comparisons are relied on**.

## Headline (honest)

| metric | before | after | verdict |
|---|---|---|---|
| duplicate run-history GET | 2 per open (dev/StrictMode) | **0** per non-truncated open, 1 per truncated open | fixed at its cause |
| page-open `/api/` requests to network idle (measure spec, incl. app shell) | 15 (n=60 opens) | **12** (n=20) | -3 |
| same, probe with initiator stacks (n=3 per side) | 13 | **10** | -3 (run-history x2 -> 0, data-sources x2 -> 1) |
| Outputs-tab time-to-interactive, direct `goto`, idle p50 | 930 / 944 / 1014 ms | 910 / 970 ms | no measurable change (noise) |
| same, 6x throttle p50 | 4453 / 4428 (5527 in a heavier-load batch) | 4089 / 4435 | no measurable change (spread across batches > difference) |
| Outputs-tab TTI, post-create navigation, idle p50 (interleaved ABAB, same server) | 308 / 326 ms | 292 / 275 ms | -5% / -16% (~15-50 ms) |
| same, 6x p50 (interleaved ABAB, same server) | 1923 / 1959 ms | 1865 / 1892 ms | -3.0% / -3.4% (~60-70 ms) |
| hel910 scenario at HEL-1298's 8x config, n=20 | 14/20 green, all-runs p50 29.2 s, passes 26.7-29.9 s | 14/20 green, all-runs p50 29.6 s, passes 27.2-30.0 s | **no measurable change** |

The request removal is real and proven; the user-visible gain is small and the hel910 scenario is unaffected. That is the
risk this change's design recorded up front ("measured gain is small because TTI is render-bound"); the evidence for why is in
"Where the time goes" below. The ticket's remaining motivation (hel910 headroom) is not served by this change; see follow-ups.

## 1.2 Root cause: the duplicate GET is React StrictMode's dev-only effect double-invoke

`logs/probe-strictmode-ON-baseline.log.txt` (stock `main.tsx`) vs `logs/probe-strictmode-OFF.log.txt` (throwaway local edit
`React.StrictMode` -> `React.Fragment`, reverted; `git status` clean of `main.tsx`), same harness
(`e2e/zz-hel1354-probe.spec.ts`, CDP `Network.requestWillBeSent` initiator stacks with async stack depth 32):

| | StrictMode on | StrictMode off |
|---|---|---|
| `GET .../run-history` | **2** | **1** |
| `GET /api/data-sources` | 2 | 1 |
| `GET /api/auth/me` | 2 | 1 |
| total `/api/` | 13 | 10 |

Both run-history calls carry the identical initiator `fetchRunHistory <- pipelinesSlice.ts <- usePipelineDetailPage.ts:386`, the
unguarded `useEffect(..., [dispatch, id])` (the sibling mount effect is guarded by `lastFetchedIdRef`). Competing candidates
(SSE `onTerminal`, run-submit refetches, a second mount) do not fire on a bare open: exactly two requests, one initiator.
**Production builds never issued the duplicate; dev and e2e (which run against the Vite dev server) did.**

## Request inventory and timing (task 1.1/1.4, `logs/before-requests-6787check.log.txt`)

Page open, start ~788 ms from navigation, response end (ms): pipeline 916, steps 842, analyze 1019, schedule 1085, outputs 1127,
data-sources 1194, run-history 1268/1275. See `boot-audit.md` for every call's first-paint consumer and decision.
After (`logs/dev-check.log.txt`): 10 requests, 0 run-history, 1 data-sources.

## Where the time goes (D4: render-bound, not request-bound)

`logs/cpu-profile-6x.txt` (CDP Profiler, 6x throttle, direct goto to Outputs-tab shown, `tti=4352ms`), self time by file:
`(program)` (native parse/compile/module evaluation) 1441 ms, `react_jsx-dev-runtime` 540, `react-dom_client` 483, `react` 265,
**`PipelineScheduleDialog.tsx` 213 ms** (a closed dialog that is mounted on every open), everything else < 75 ms each. The
Outputs tab is mounted as soon as the pipeline response renders; the other responses only update already-mounted regions. At
6x the TTI is dominated by dev-build React and module evaluation, not by request count, which is why removing three requests
moves it by tens of milliseconds at most.

## 1.3 / 3.4 Detail tables

Request counts (`/api/` requests per open to idle, measure spec): before `logs/before-1x.log.txt`, `before-6x.log.txt`,
`before-r2-*.log.txt`, `before-r3-*.log.txt`: 15 in all 60 opens; after `logs/after-a-*.log.txt`, `after-b-*.log.txt`: 12 in all 40 opens.
Probe counts n=3 per side: `logs/before-r2-requests.log.txt`, `before-r3-requests.log.txt`, `before-requests.log.txt` (13, run-history x2) vs
`logs/after-a-requests.log.txt`, `after-b-requests.log.txt` (10, run-history x0).

Direct-goto TTI (goto -> Outputs tab clicked and its tabpanel shown), n=10 each, `min/p50/max` ms. Load average at each batch
start/end is in the `*-meta.log.txt` next to it.

| batch | server | throttle | min / p50 / max | log |
|---|---|---|---|---|
| before | pre-edit :6786 | 1x | 925 / 1014 / 1773 | before-1x.log.txt |
| before-r2 | base :6787 | 1x | 916 / 930 / 1094 | before-r2-1x.log.txt |
| before-r3 | base :6787 | 1x | 911 / 944 / 957 | before-r3-1x.log.txt |
| after-a | after :6786 | 1x | 880 / 910 / 920 | after-a-1x.log.txt |
| after-b | after :6786 | 1x | 919 / 970 / 1062 | after-b-1x.log.txt |
| before | pre-edit :6786 | 6x | 4685 / 5527 / 7258 | before-6x.log.txt |
| before-r2 | base :6787 | 6x | 4200 / 4453 / 5710 | before-r2-6x.log.txt |
| before-r3 | base :6787 | 6x | 4160 / 4428 / 4992 | before-r3-6x.log.txt |
| after-a | after :6786 | 6x | 4001 / 4089 / 4174 | after-a-6x.log.txt |
| after-b | after :6786 | 6x | 4021 / 4435 / 4667 | after-b-6x.log.txt |

Post-create navigation (New pipeline modal -> Create click -> detail page -> Outputs tab shown), n=10 each, interleaved
before/after on `:6786` by stashing/popping the four product files (`logs/pc*-meta.log.txt`, run order before-1, after-1, before-2,
after-2):

| run | throttle | min / p50 / max | log |
|---|---|---|---|
| pcbefore-1 | 1x | 291 / 308 / 311 | pcbefore-1-1x.log.txt |
| pcafter-1 | 1x | 260 / 292 / 316 | pcafter-1-1x.log.txt |
| pcbefore-2 | 1x | 291 / 326 / 345 | pcbefore-2-1x.log.txt |
| pcafter-2 | 1x | 264 / 275 / 313 | pcafter-2-1x.log.txt |
| pcbefore-1 | 6x | 1898 / 1923 / 2320 | pcbefore-1-6x.log.txt |
| pcafter-1 | 6x | 1769 / 1865 / 1972 | pcafter-1-6x.log.txt |
| pcbefore-2 | 6x | 1898 / 1959 / 2221 | pcbefore-2-6x.log.txt |
| pcafter-2 | 6x | 1801 / 1892 / 1973 | pcafter-2-6x.log.txt |

(An earlier, non-interleaved pre-edit batch measured post-create 1x 300/334/447 and 6x 2481/2860/3876 under load 10-17,
`logs/before-1x.log.txt`, `before-6x.log.txt`; the after batches in `after-a-*`/`after-b-*` read 269/287/311, 305/324/410 (1x) and
1853/2049/2341, 2044/2181/2352 (6x). The same-server ABAB runs above are the comparison relied on.)

**Ticket figures re-measured, not like-for-like.** The ticket's 2.6-3.4 s (6x) vs 0.19 s (idle) came from HEL-1298 on a host at
load 10-17 after New-pipeline client navigation, where 0.19 s was the bare click and the 6x figure included waiting on the
boot. This run's post-create path is 0.29-0.33 s idle and 1.9-2.0 s at 6x at load 6-9; the direct-goto path (cold page load
in dev) is 0.9-1.0 s idle and 4.1-4.5 s at 6x. "7 parallel calls incl. a duplicate" is 9 page-owned requests under StrictMode
(7 distinct resources) and 12-13 with the app shell.

### hel910 at HEL-1298's exact 8x configuration (C1)

Spec copy: `e2e/zz-hel1354-throttle-hel910.spec.ts` = committed `hel910-pipeline-to-dashboard-flow.spec.ts` plus the 4-line CDP
8x `beforeEach` and one residue-logging line; `logs/throttle-hel910-spec.diff` (identical for both sides). Scenario: the
"New pipeline ... three table Outputs ... all placed on a dashboard" test, `--repeat-each=20`, `--workers=2` under `nice -n 19`,
3 niced burners (PIDs recorded in `logs/*-hel910-b1.meta.log.txt`, killed only by recorded PID), batch started only once 1-min
load < 2 (`load gate passed after Ns` lines), loadavg sampled every 15 s (`*.samples.log.txt`).

| side | server / SHA | load at start / end | result | durations all-runs min/p50/p95/max | passes only |
|---|---|---|---|---|---|
| before | base :6787 / 70b063a47 | 1.77 / 13.43 | 14/20 green, 6 x 30 s timeout | 26.7 / 29.2 / 31.3 / 31.4 s | 26.7-29.9 s |
| after | :6786 / 1a4c07dce | 1.98 / 7.53 | 14/20 green, 6 x 30 s timeout | 27.2 / 29.6 / 31.5 / 31.6 s | 27.2-30.0 s |

Files: `before-hel910-b1.{json,run.txt,meta.log.txt,samples.log.txt}`, `after-hel910-b1.*`. Both batches rose from the gate to load 8-12
within two minutes (3 burners + 2 workers + 2 chromium account for ~6; the rest is other lanes), so neither reproduces
HEL-1298's quiet-host f8 batch (20/20 green, 26.8-28.0 s, load after 6.48): both sides here are on a busier host than that
and are comparable to each other, not to f8. **Conclusion: the page change does not move the hel910 scenario**; its 28 s is
two app boots plus the UI flow, not the detail page's request burst.

## Dev DB residue

Every user/source/pipeline/output created by probes, measurement specs and the two hel910 batches is recorded by exact id/email in
`logs/created-ids.log.txt` (probe/measure users `zz-hel1354-*@example.com`, hel910 users `hel910-full-flow-*@example.com`, with
their source/pipeline/output ids where created via API; UI-created pipelines logged as `postcreate-ui`). Nothing was deleted;
the `matt@helio.dev` account was never touched.

## Failed / discarded runs (kept)

- `logs/failed-before-1x-ratelimit-hang.log.txt`, `failed-before-6x-ratelimit-hang.log.txt`: first batch hung because one user's 120 req/60 s
  `/api` rate limit was exhausted by repeated opens; fixed by re-seeding a fresh user every second open (outside the timed region).
- `before-r2-*.run.txt`, `before-r3-*.run.txt` (post-create test): failed (`Failed to create pipeline.`) because the second Vite's
  browser-originated POSTs carried `Origin: :6787`, rejected by the backend CORS allow-list; fixed by the scratch proxy `Origin`
  rewrite, and the post-create comparison was redone interleaved on one server (`pcbefore-*`/`pcafter-*`).
- An earlier `before-hel910` waiting script was stopped by PID before any burner or test started (to run local jest/commit gates
  uncontaminated); its meta file held only the wait note and was removed.

## Follow-ups for the driver (not done here)

1. `auth/me` is still fetched twice per open in dev (`App.tsx:370`, StrictMode-only, App-level, out of scope).
2. `PipelineScheduleDialog` is mounted on every open while closed and shows 213 ms of 6x self time; lazy-mounting it (like the run-history
   modal) is the cheapest remaining first-paint cost seen in the profile.
3. A consolidated boot endpoint would not pay: the pipeline GET (the only gate to the tab) completes ~130 ms in; the TTI is render/module
   bound. The hel910 28 s needs a scenario change (fewer boots), not a faster detail page.

## Cycle 2: provenance of the "after" batches, and the truncated open

The `after-a`/`after-b` and `pcafter-*` batches above ran on this worktree's Vite serving the pre-commit working tree
(`SHA=70b063a47 dirty-frontend-files=9` in their meta logs); the product code was committed unchanged afterwards in `1a4c07dce`
(no product file changed between those batches and the commit; only test files did). To remove any doubt, the request-count and direct-goto
TTI batches were re-run on the committed head (`logs/cycle2-meta.log.txt`: `SHA=45c1800c5 dirty-frontend-files=0`, sha256 prefixes of
the five product files recorded; loadavg per batch in that file; hel910 "after" was already on committed `1a4c07dce`):

| metric (committed head, `:6786`) | result | log |
|---|---|---|
| `/api/` requests per open, probe, non-truncated, n=3 | 10, run-history GETs 0 | cycle2-after-requests.log.txt |
| same, truncated open (pipeline GET intercepted to `lastRunTruncated: true`) | 11, **run-history GETs exactly 1** | cycle2-after-truncated.log.txt |
| direct-goto TTI 1x, n=10 | 877 / 889 / 908 ms, 12 requests per open | cycle2-after-1x.log.txt |
| direct-goto TTI 6x, n=10 | 3938 / 4396 / 4482 ms, 12 requests per open | cycle2-after-6x.log.txt |

These agree with the earlier "after" batches (910-970 ms idle, 4089-4435 ms at 6x). The "1 per truncated open" cell is backed by the
probe above and by RTL `PipelineDetailPage.runHistory.test.tsx` ("a truncated pipeline's open issues exactly one run-history GET").
All logs now use the `.log.txt` extension because `.gitignore` excludes `*.log`.

## Suggested split of `usePipelineDetailPage.ts` (for the PR body)

The hook is ~1430 lines (CONTRIBUTING soft budget exceeded long before this ticket; run-history logic was extracted to
`useRunHistory.ts` rather than grown in place). Proposed follow-up split: `usePipelineRunControls` (run/dry-run/SSE/refresh),
`usePipelineAnalyze` (debounced re-analyze + defer watchdog), and `usePipelineOutputsPanel` (output sheet/history handlers), leaving
the page hook as composition.
