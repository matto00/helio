## Context

`PanelCard.test.tsx` (last describe block, ~line 564) mounts `PanelCard` with the REAL `usePanelData`, a mocked
`usePanelPolling` (its call count = `PanelCardBody` render count, since `PanelCardBody` is defined in `PanelCard.tsx`
and calls it unconditionally), never-resolving `getOutputRows`/`getOutputById`/`getAssertionStatus`, and a mocked
`usePanelRunRefresh`. Sequence: mount -> `waitFor(getOutputRows called once)` -> `act(async () => two
Promise.resolve())` -> sample `callsBeforeRerender` -> `rerender` with title-edit props -> assert count unchanged.

The two-tick flush was added by HEL-1027 (cycle 4) to absorb `useOutputMeta`'s mount effect
(`frontend/src/features/panels/hooks/useOutputMeta.ts`), which schedules `Promise.resolve().then(() =>
setIsLoading(true))` — a same-value update that makes React invoke `PanelCardBody` once more and bail out. The CI
failure (baseline 2, after 3) is consistent with that bail-out render (or another late mount-time render) landing
AFTER the baseline sample, i.e. during/after `rerender`. The failure postdates HEL-1027's flush (2026-09-28 vs
2026-09-30), so the flush is not sufficient. Why the count of ticks would vary with load is NOT yet explained — that
is exactly what the probe must answer.

## Goals / Non-Goals

**Goals:** a probe-confirmed cause; a measured before rate and 0/N after under one identical recipe; an exact
assertion that still catches a broken memo boundary.
**Non-Goals:** see proposal. No PanelCard.tsx restructuring; no assertion loosening.

## Decisions

### D1. Probe before fix (systematic-debugging law)

Temporary, uncommitted instrumentation: record each `PanelCardBody` render (the `mockUsePanelPolling` call index)
with a monotonic timestamp, a short cause tag, whether `waitFor` passed on its synchronous first check or a later
retry, and (stack excerpt / which state changed — e.g. wrap `useOutputMeta`'s
setters or add a `React.Profiler`/`console.trace` in a scratch copy of the test), plus the timestamps of
`waitFor` resolution, the flush, the baseline sample and the `rerender`. Answer each with evidence:
- **Late mount render**: is the third render the `useOutputMeta` same-value bail-out (or another mount-time async
  update — store/thunk pending, React.lazy chunk, `getAssertionStatus` path) landing after the baseline?
- **Why load-dependent**: which boundary decides whether it lands before/after the sample (e.g. `waitFor`
  resolving on its synchronous first check vs. a later interval, act-queue vs. Scheduler macrotask, `import()`
  resolution timing)?
- **Harness artefact**: StrictMode double render, profiler counting, or an act-boundary warning — confirm or refute
  (check `renderWithStore` and `src/test` setup for StrictMode).
- **Test-to-test leakage**: does an earlier test in the same file (pending promises, mock state, un-unmounted trees)
  contribute a render/update to this test? Compare `-t` single-test runs vs whole-file runs.
- **Real extra render caused by the rerender itself**: does the title-edit rerender pass a changed prop to
  `PanelCardBody` (memo genuinely broken)? If so this is a product defect, not a flake.

### D2. Reproduce (red) under a capped recipe

- At most 4 concurrent CPU-heavy processes in total (jest workers + any `nice -n 19 sh -c 'while :; do :; done'`
  burners), everything `nice -n 19`; burner PIDs written to a scratch pidfile and killed only via `kill <pid>` from
  it (never pkill/pgrep/killall). Sequential batches, never a fork bomb. npm cache/logs under the worktree or
  scratchpad, never `~`. Never `jest --coverage`.
- Rates (before AND after) are always measured on the un-instrumented test — the committed test for BEFORE, the fixed
  test for AFTER. The instrumented scratch copy is used only to record timelines, never for a rate.
- Natural reproduction: >= 30 runs of the single test (`-t` filter) and of the whole file under the recipe; also
  the file alongside sibling `PanelCardBody.*.test.tsx`/panels ui tests with `--maxWorkers=3`. Record N and fail
  count, keep full logs of failures.
- Deterministic injection (mechanism confirmation, uncommitted): delay the suspected late update (e.g. make the
  probe's version of the suspected promise/macrotask resolve one macrotask later) and show the exact
  `Expected: 2, Received: 3` reproduces 100%.
- If the natural recipe gives 0 failures: STOP before fixing and report to the orchestrator (it escalates to the
  driver with the injection evidence and a recommendation). Do not raise the cap.

### D3. Fix chosen by the confirmed cause

- Late mount render (expected): replace the fixed-tick flush with a settle that waits for the condition it means —
  e.g. flush until the `PanelCardBody` render count is stable across a macrotask boundary inside `act`, or await the
  specific mount-time update. Any loop has an explicit iteration cap and fails loudly (throws) if never stable. Must not wait
  through or after the `rerender`, so a render caused by the rerender is still counted.
- Product defect (memo genuinely broken, or `useOutputMeta` causes a spurious render): minimal behaviour-preserving
  fix in the hook (`useOutputMeta.ts`, uncontended). Any PanelCard.tsx edit -> stop and report first (HEL-1304).
- Harness artefact: fix the harness at its source, in the test.
- Never `<=`/`toBeLessThanOrEqual`; any assertion change is a coverage call -> escalate.

### D4. Evidence

`probe-evidence.md` in this change directory: the recipe, raw before counts (N, fails), the per-render timeline of
a failing run, each D1 hypothesis marked confirmed/refuted with its evidence, the injection result before and after
the fix, and AFTER runs under the identical recipe with 0 failures where N_after >= max(50, ceil(3 / p_before))
(p_before = BEFORE fail count / BEFORE N); if N_after does not fit within the cap and a reasonable session, stop and
report (escalation). Mutation checks, each must go red 5/5 runs:
- M1 memo boundary: a temporary edit at the `<PanelCardBody` JSX call site in `PanelCard.tsx` adding a fresh-per-render
  value for a prop it already accepts (e.g. wrap one existing callback prop in an inline arrow). This temporary
  edit is explicitly permitted by C5 as long as it is reverted; prove the revert with an empty
  `git -C <worktree> diff -- frontend/src/features/panels/ui/PanelCard.tsx`.
- M2 fix attribution: with the 1.4 forced delay active, restore the old two-tick settle in place of the fix; it must
  go red (shows the fix, not luck, turns it green). Large logs persisted via `persist-evidence.sh`, not committed.

## Risks / Trade-offs

- [Natural repro may not occur within the cap] -> D2 injection + escalate; the cap is not raised.
- [A "wait until stable" settle could swallow a real regression] -> settle only before the baseline; mutation check.
- [Contention with HEL-1304 on PanelCard.tsx] -> test-file diff expected; product edit only in the hook if needed.

## Planner Notes

- Self-approved: test-only `skip_specs: true` change; probe-first task order mirrors HEL-1353's
  `createplacement-test-load-timeout` precedent; the 4-process total cap is stricter than HEL-1353's 3+3 recipe to
  respect the owner's hardware cap.

## Migration Plan

None (test-only).
