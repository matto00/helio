## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/panelcard-rerender-count-flake/HEL-1215`.
- Read ticket.md, proposal.md, design.md, tasks.md, .openspec.yaml (`skip_specs: true`), workflow-state.md.
- I checked the design's context claims against the code, and they hold:
  - `frontend/src/features/panels/ui/PanelCard.test.tsx:564-622`: the sequence is mount, `waitFor(getOutputRows x1)`, `act` with two `Promise.resolve()`, sample, `rerender` with `isEditingTitle`/`editingTitle`, `toBe(callsBeforeRerender)`. The failing assertion is at line 618, which matches the ticket.
  - `PanelCard.test.tsx:52-71`: `usePanelPolling`, `usePanelRunRefresh` and `getOutputById` are mocked, and `getOutputById` never resolves. `getAssertionStatus` and `getOutputRows` never resolve (beforeEach at ~568-574), and the real `usePanelData` is used.
  - `frontend/src/features/panels/hooks/useOutputMeta.ts`: the mount effect schedules `Promise.resolve().then(() => setIsLoading(true))`, and the initial state is already `true`. So it is a same-value update, as claimed.
  - `PanelCard.tsx:132` `PanelCardBody = React.memo(...)` and `:403` `PanelCard = React.memo(...)` exist. A mutation that breaks the memo boundary is therefore well-defined.
  - `src/test/renderWithStore.tsx`: grep finds no `StrictMode`/`Profiler`. Task 1.2 still has to confirm this with file:line evidence.
  - The sibling `PanelCardBody.fanoutStatus.test.tsx` / `PanelCardBody.predispatch.test.tsx` files exist, so the sibling-contention batch is runnable.
- Load cap: D2 and C3 cap the total at 4 concurrent CPU-heavy processes, all `nice -n 19`. Burners are killed only through a pidfile with `kill <pid>`, never pkill/pgrep/killall, and `--coverage` is never used. This is within the owner's hard cap, and the plan never proposes raising it.
- Stop-and-escalate: D2, C1 and task 1.5 say that zero natural failures means stop before fixing and report, without raising the cap. This is correct and matches the AC.
- Fix space: D3 and C2 forbid `<=`, ranges and retries, and say any change to assertion semantics is an escalation. The settle runs before the baseline only and never through the `rerender`. This is correct.
- Hypotheses: D1 covers four separate hypotheses: a late mount render, why the timing depends on load, a harness artefact, and a genuine memo break caused by the rerender. Each one has a different observable in the per-render cause-tagged timeline relative to the sample and `rerender` timestamps. Together with the deterministic injection (1.4) and the "injection now passes" check (2.1), the probe does tell the hypotheses apart.

### Verdict: REFUTE

The plan is close. Three gaps could each let a run produce evidence that looks like proof but proves nothing.

### Change Requests
1. **Size the AFTER run count from the BEFORE rate, not a fixed 50 (D4, task 3.1).** The design fixes AFTER at ">= 50 runs, 0 failures" no matter what BEFORE shows. If the natural BEFORE rate under the capped recipe is low (for example 1/60), then 0/50 after the fix is the expected result even with no fix at all, and proves nothing. Required: N_after >= ceil(3 / p_before), where p_before = BEFORE fails / BEFORE N on the identical recipe. That gives roughly 95% confidence that 0 failures is not chance. Use whichever is larger, this or 50. If that N does not fit in the session within the cap, report it as an escalation instead of shipping a statistically empty 0/N. Record p_before, N_after and the calculation in probe-evidence.md.
2. **Measure BEFORE and AFTER on the uninstrumented test (D2 and tasks 1.1 then 1.3).** Task 1.1 adds stack and timestamp instrumentation, and task 1.3 then runs "the D2 natural recipe" without saying which copy. Per-render `console.trace`/stack capture changes timing a lot, and timing is the variable under study. Required: say explicitly that the BEFORE rate (1.3) and AFTER rate (3.1) are measured on the committed, unmodified test (BEFORE) and the fixed test (AFTER), with no probe instrumentation. The instrumented copy is used only to capture the timeline of a failing run. If the instrumented copy never fails naturally, say so, and rely on the injection for the timeline.
3. **Make the mutation check unambiguous and repeatable (D4, task 3.2, constraint C5).** The suggested mutation ("pass a fresh object/callback prop to `PanelCardBody`") needs a scratch edit to `PanelCard.tsx`, but C5 says "No PanelCard.tsx edit without reporting first". Two readings conflict here: an executor could skip the check, or could treat it as a reportable edit. Required:
   - Name the exact mutation, for example removing `React.memo(` at `PanelCard.tsx:132`, or adding a fresh `{}` prop at the `<PanelCardBody` call site.
   - State that a scratch mutation that is reverted is allowed under C5, and prove the revert with an empty `git -C <wt> diff -- frontend/src/features/panels/ui/PanelCard.tsx`.
   - Require the mutated run to fail with the exact `toBe` mismatch on every one of several runs (for example 5/5), not a single red.
   - Also require a second mutation that targets the new settle: with the fixed settle in place and the 1.4 injection active, reverting the settle to the old two-tick flush must go red. This shows the fix, not luck, is what turns the injection green.

### Non-blocking notes
- D1 should name cross-test leakage as a hypothesis: async work left over from an earlier test in the same file landing in this one. The ticket says the test passes in isolation and fails in full-file/suite runs. The single-test vs. whole-file split in D2 partly covers this, but naming it makes the timeline's cause tag check for it explicitly.
- The design already admits that load-dependence is "NOT yet explained". Microtask ordering on its own does not depend on load. The likely variable is whether `waitFor` passes on its synchronous first check or on an interval tick (a macrotask, after which the microtask has already run). That is a good first thing for the timeline to record.
- The D3 "stable across a macrotask boundary" loop needs an explicit iteration cap and must fail loudly when it hits the cap, as D3 already says. Do not let it degrade into a silent pass.

head_sha reviewed: 0a1eacd7d (the branch has no commits beyond main yet; the artifacts are untracked).
