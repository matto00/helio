## Context

`usePipelineDetailPage.ts` boots the page from two effects. The guarded mount effect (`lastFetchedIdRef`) dispatches
`fetchPipelineById`, `fetchPipelineSteps`, `analyzePipeline`, `fetchPipelineSchedule`, `fetchOutputs`; a second effect
dispatches `fetchSources` when sources are idle; a third, unguarded effect (`[dispatch, id]`) dispatches
`fetchPipelineRunHistory`. `main.tsx` renders under `React.StrictMode`, and e2e runs against the Vite dev server.
Run history (`state.pipelines.runHistory`, no status field) is read only by the persisted truncation banner
(`runs[0]?.truncation?.notice`, shown only when `currentPipeline.lastRunTruncated === true`) and by `RunHistoryModal`.
HEL-1298's `root-cause-evidence.md` (archived change `2026-10-06-e2e-contention-robustness`) says the Outputs tab
becomes clickable ~0.3 s after the last of the boot responses, which land ~300 ms apart. The step-creation code moved
to `usePipelineStepCreation.ts` (HEL-1340) and the create/reparent flow changed (HEL-1345); neither is in scope.

## Goals / Non-Goals

**Goals:** a probe-proven root cause for the duplicate GET and a fix at that cause; run history off the boot path;
an evidence-backed decision for every other boot call; honest before/after numbers.
**Non-Goals:** see proposal.md Non-goals. No backend change. No change to what first paint shows.

## Decisions

**D1 - Probe first (systematic-debugging law).** Before any code change, capture the boot request log for one page open
of a real pipeline (the hel910 shape: a source, at least one step, at least one Output), from a headless Playwright
context the run owns, recording every `/api/` request with method, URL, start/end time and the JS stack of the
initiator (`page.on("request")` plus a CDP `Network.requestWillBeSent` initiator stack, or an instrumented
`console.trace` in a throwaway local edit that is reverted and never committed). Leading hypothesis: StrictMode's
dev-only effect double-invoke on the unguarded run-history effect. Competing candidates the probe must rule in or out:
the SSE `onTerminal` refetch, the run-submit refetches, and a second mount of the page. The root cause counts as
confirmed only when it flips both ways: cause present gives 2 GETs, cause removed gives 1, with the same harness.
If the duplicate is StrictMode-only, say so plainly in the PR: production users never paid it, but dev and e2e did.

**D2 - Fix the duplicate at its cause, not by disabling StrictMode.** Preferred mechanism: `fetchPipelineRunHistory`
takes `{ pipelineId, openId, force? }`. `openId` identifies one page open (D3). The slice gains, per pipeline,
`runHistoryStatus` ("idle" | "loading" | "succeeded" | "failed"), `runHistoryRequestId` (latest pending `requestId`)
and `runHistoryOpenId` (the `openId` of that latest request). The thunk's `condition` skips when a request for the SAME
`pipelineId` (read from the thunk's own argument, so two pipelines never dedupe each other) AND the same `openId` is
already in flight, unless `force` is true. `fulfilled`/`rejected` apply only when their `requestId` is the latest for
that pipeline (latest-request-wins), so an older response can never overwrite a newer one. Alternative considered: a
`useRef` guard like `lastFetchedIdRef` alone; rejected as the primary fix because it covers one call site only, but
acceptable if the probe shows a different root cause where a ref is the right fix.
**Post-run refresh race (skeptic design-1 CR2).** The three post-run callers (`onTerminal`, `handleRunPipeline`,
`handleDryRun`) dispatch with `force: true`, so a fetch still in flight when a run finishes cannot swallow the refresh:
the forced fetch goes out, and its response wins even if the earlier one lands later.

**D3 - Run history leaves the boot path; freshness is per page open, with no store reset (skeptic design-2 CR1,
design-3 CR1).** The hook holds an `openId` that is unique per page open: regenerated on every mount AND on every
`id` change (so an in-place A -> B -> A navigation gets three distinct tokens), and stable across StrictMode's
double render and simulated unmount/remount. Mechanism: `useState` with a lazy initializer for the first token, plus
the hook's existing derived-state-during-render pattern (as used for `outputNamePipelineId`) to issue a new token when
`id` differs from the token's recorded id; tokens come from a module-level counter, not `Math.random`/`randomUUID`.
It must pass `react-hooks/refs`, `react-hooks/purity` and `react-hooks/globals` with no `eslint-disable`. There is NO cleanup-time reset.
The slice additionally records `runHistoryLoadedOpenId` (the `openId` of the latest request that fulfilled). Records
are "fresh for this open" only when `runHistoryLoadedOpenId === openId`; the modal and the persisted truncation banner
read them only when fresh, so a previous visit's list, or a previous visit's late response (which carries an older
`openId`), is never shown and never counts as fresh, and the `condition` never dedupes across opens.
- StrictMode: the token survives the effect re-run, so run #2 sees a request in flight with the same `openId` and is
  skipped by the `condition` -> one GET.
- Boot fetch: chained off THIS open's own `fetchPipelineById` promise in the mount effect (and the error-retry
  path): when it fulfils for `id` with `lastRunTruncated === true`, dispatch the history fetch. It never reads the
  store's persisted `currentPipelineStatus`/`currentPipeline`. The chain gets NO cleanup "active"/cancel flag:
  StrictMode's simulated cleanup would cancel it while the ref-guarded run #2 dispatches nothing (zero GETs).
- Modal open trigger: a click-time handler only (`openRunHistory`, wired to the header menu's "Run history" item, the only opener at `PipelineDetailPage.tsx:174`; the hook exposes a close
  handler rather than a raw `setHistoryOpen` so no other open path exists):
  it sets `historyOpen` and, when records are not fresh for this open and no request for this open is in flight,
  dispatches the fetch (non-forced). There is no reactive effect on `historyOpen`, so a failure never auto-redispatches;
  the error state's Retry button is the only re-dispatch after a failure (exactly one GET per Retry click).
- In-place `id` change with the modal open: the same derived-state branch that issues the new token also sets
  `historyOpen` to false, so the modal closes on any pipeline switch (including browser Back between in-place pipeline
  entries) and can never show one pipeline's runs (or an unfetched state) under another pipeline's page.
- `RunHistoryModal` rendering, exhaustive over (fresh?, latest request for this open):
  fresh -> `Run history (N)` and the list (kept visible during a later refresh in the same open, then updated), with
  "No runs recorded yet" only when fresh and empty; not fresh and latest request for this open failed -> error state
  with Retry, title "Run history"; every other not-fresh case (request for this open in flight, or none issued yet)
  -> loading state, title "Run history" (no count). Because the only ways to open the modal dispatch first and an id
  change closes it, "none issued yet" is transient, never a resting state.
- Error-retry path for the pipeline fetch: `PipelineDetailPage.tsx`'s `onRetry` stops dispatching `fetchPipelineById`
  itself and calls a hook-exposed retry handler that runs the same chain as boot.
- Optional: the boot chain may skip dispatching when its captured `openId` is no longer current (a ref read inside the
  async callback, not during render, is lint-legal); correctness does not depend on it.
- Token counter: a module-level helper (`function nextOpenToken() { counter += 1; return counter; }`) called from the
  lazy initializer / derived-state branch; an inline `counter += 1` during render fails `react-hooks/globals` (an error
  here). No `eslint-disable` for any react-hooks rule.
Trade-off: for a truncated pipeline the history GET starts after the pipeline GET instead of in parallel, delaying
only the banner by one round trip.

**D4 - Every other boot call is decided by evidence.** For each of the remaining calls (pipeline, steps, analyze,
schedule, outputs, sources), record in `boot-audit.md` which first-paint element consumes it (from the code) and its
measured timing and render cost (from D1's log and a React Profiler or Performance trace). Defer a call only when no
first-paint element consumes it, using the same on-demand pattern as D3, with an RTL test. Expected outcome from
reading the code (to be confirmed or refuted): header schedule summary, header root sources, river input schemas,
Outputs tab count and footer all consume first-paint data, so none is deferrable without a visible change. If the
measurements show the Outputs tab's time-to-interactive is dominated by render work rather than requests, say so
with the trace, and name the dominant component as a follow-up for the driver rather than widening this ticket.
Consolidation that needs a new endpoint is out of scope (proposal Non-goals); note it as a follow-up if it would pay.

**D5 - Measurement protocol.** Same machine, same build mode (Vite dev server, as e2e uses), run "before" on the
unchanged branch head before any code edit and "after" on the final head. For each batch record `/proc/loadavg` at
start and end, the commit SHA, and the exact command.
- Boot request count: `/api/` requests from navigation to network idle on one page open, n >= 3 per side.
- Outputs-tab time-to-interactive: from `page.goto` of the detail URL to the resolution of a Playwright click on the
  Outputs tab that then shows the Outputs tabpanel; idle and 6x CDP `Emulation.setCPUThrottlingRate`, n >= 10 per
  configuration per side; report min/p50/max.
- hel910 duration at HEL-1298's 8x configuration, reproduced exactly (`root-cause-evidence.md:65,73`): the
  untracked throttled copy `e2e/zz-hel1354-throttle-hel910.spec.ts` (committed spec plus one CDP
  `Emulation.setCPUThrottlingRate(8)` `beforeEach`, `diff` captured per batch), 3 niced CPU burners (PIDs recorded,
  killed only by recorded PID), `--workers=2` under `nice -n 19`, each batch started only once 1-min load < 2, n=20
  per side; loadavg recorded before and after each batch; report min/p50/max and pass/fail.
- HEL-1298's 2.6-3.4 s Outputs-tab figure was taken on a loaded host (load 10-17) after New-pipeline client
  navigation; `measurements.md` states it is not like-for-like with this run's own "before", and additionally times
  the post-create navigation path (New pipeline -> detail page -> Outputs tab click) idle and at 6x, n >= 10.
Throwaway probe/measurement specs live under `e2e/zz-hel1354-*` while in use, are deleted before commit, and are
listed in `files-modified.md` as created and deleted. Raw logs and the results go in `measurements.md` in this change
directory, which is committed and persisted as evidence.

## Risks / Trade-offs

- [Measured gain is small because time-to-interactive is render-bound] -> report it honestly; D4 names the follow-up.
- [Thunk `condition` silently drops a needed refresh] -> RTL/slice tests: concurrent dispatch dedupes; a dispatch
  after completion still fetches.
- [Dev DB residue from probe pipelines] -> every created user/source/pipeline id is recorded in `measurements.md`;
  never the `matt@helio.dev` account.
- [Timing noise] -> before/after interleaved where practical, loadavg recorded, quiet host for the 8x comparison.

## Planner Notes

- Self-approved: new `runHistoryStatus` slice field (frontend-only state, no contract change).
- Self-approved: spec delta on `pipeline-editor-page` rather than `pipeline-run-truncation-reporting`, since the
  banner's behaviour is unchanged; only when its data is loaded changes.
