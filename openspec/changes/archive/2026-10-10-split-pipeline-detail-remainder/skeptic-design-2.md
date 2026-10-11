## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed: the uncommitted design.md and tasks.md on disk, on HEAD 744c3772000379426a699e7abae2a2543e0953ee
(= origin/main). Every claim below was checked against the live tree, not against the artifacts' wording. I ran no
mutating probes, so no new evidence artifacts were produced; the round-1 base lint probe
(`.concertino/runs/HEL-1478/evidence/skeptic-design-1/lint-probe-base.json`) was re-read.

### What I verified (with evidence)

**Round-1 change requests**

- **CR1 (transition basis): ADDRESSED.**
  - design.md L27-39 now states that the page renders inside BrowserRouter transitions (main.tsx:61-62 confirmed:
    StrictMode > BrowserRouter).
  - It gives a per-value argument: `steps`/`sseActive` urgent-only, `analyzeStatus`/`allOutputs` via uSES, and
    `stepsFingerprint` derived. It also covers the discarded mount render and makes a failure a STOP.
  - Task 1.2 requires the node_modules file:line.
  - I checked the setter claim. `grep` over features/pipelines (non-test) finds no `startTransition`, `useTransition` or
    `useDeferredValue`. The `setSteps`/`setSseActive` sites are event handlers, async continuations and the
    render-phase seed, so none is inside a transition. The argument holds in outline. The executor's write-up is the
    proof, under STOP.
- **CR2 (masked scope): MOSTLY ADDRESSED.**
  - D1 lint proof (L66-70) and D2 (L79-81) both require an `exhaustive-deps` message byte-equal to base. That message
    is in lint-probe-base.json: `React Hook useEffect has a missing dependency: 'steps.length'. Either include it or
    remove the dependency array.`
  - Both explicitly fail the proof on an extra name such as a seed token.
  - Residual gap: both proofs assert only "0 `react-hooks/refs`" plus that one warning. They do not assert that the
    full diagnostic list is exactly that one entry. See CR-B.
- **CR3 (D1c location/threading/L370): PARTIALLY ADDRESSED.**
  - Location and threading are now specified (L59-62), and they match the tree. The ref is declared at
    usePipelineDetailPage.ts:136. It is passed into `usePipelineStepStructure` (L599) and into `usePipelineStepCreation`
    (usePipelineStepStructure.ts:89). The mutation sites are exactly `.set` L152/L263/L370 and `.delete` L318, with no
    `.clear` anywhere.
  - The L370 T2 case was added (design L114-115, task 1.4).
  - **Not addressed: the requested red mutation that omits the mirror update at L370.** Neither design D4 nor tasks
    2.3/1.5 plan it. Task 2.3's verify is "green + per-site batching proof" only.
  - The case's expected count is also ambiguous about timing (see CR-A).
- **CR4 (missing cases): ADDRESSED.** The F-105 seed-at-mount variant is in T2. The SSE `onTerminal` page-level case is
  in T4 (design L117-118). I confirmed it is not covered today: no `PipelineDetailPage*.test.tsx` stubs `EventSource`
  (grep), so this is genuinely new coverage. The hook test already shows a stub is feasible.
- **CR5 (falsified comments): ADDRESSED.** D5 L133-136 lists all five. I verified each is live:
  - usePipelineDetailPage.ts:147-148 and :151
  - usePipelineStepCreation.ts:39
  - usePipelineStepMutations.ts:154 ("`stepsRef` (assigned in render)")
  - usePipelineAnalyzeDeferWatchdog.ts:18-21
  A repo grep for "in/during/every render" next to "ref" finds no other site. Task 3.2 fixes the watchdog docblock in
  the D2 commit that falsifies it.
- **CR6 (bookkeeping): ADDRESSED.** Task 7.0 files the items 4-5 follow-up and cites it in the PR. Task 2.6 escalates a
  STOP, and the orchestrator files the follow-up (AC1). D4 L119-120 labels T1-T4 as guards for D1a, with the
  inventory and transition argument as the proof.

**Independent re-judgement**

- **D1 equivalence under router transitions:** sound as a proof obligation.
  - Deps-less `useLayoutEffect` writes run on every commit the host renders in. This matches the render-time write
    whenever the render commits, and the transition argument covers renders that don't commit.
  - A child's layout effect, or a child ref callback, runs before the parent's layout effect, so either one would read
    stale. The STOP inventory covers child layout effects. Ref callbacks are not named (non-blocking note).
- **D1b seed token:** sound.
  - I traced StrictMode's double effect invoke (React 19 keeps refs across the remount). Run 1 consumes the token.
    Run 2 sees it equal, schedules the timer, and the timer bails on `lastAnalyzed === fingerprint`. This matches base.
  - A discarded transition render drops the token update along with the seed, and base re-sets the flag on the retry
    render. Equivalent.
  - The "token in deps changes only where the fingerprint changes" proof is correctly demanded. Several `setSteps`
    callers (usePipelineStepStructure.ts:63/140/223, the mutations) do not set `stepsInitialized`, so the executor
    must actually show steps cannot be non-empty with an unchanged fingerprint while `stepsInitialized` is false. The
    design requires that proof, which is correct.
- **D1c mirror location/threading:** correct and complete for the fingerprint.
  - `usePipelineAnalyzeLookups.ts:100,107` also read `pendingDraftMetaRef`, in callbacks. They stay ref-reads. That is
    out of AC1's "in the host" scope and unchanged by D1c.
  - The co-batching at the four sites holds. L152/L263 come before any await. L318 is in the config-change handler
    after `setSteps`. L370 is in the same `.catch` microtask as `setDraftCreateErrors` (L367).
- **Moved-suppression masking proof:** the right shape, but under-specified (CR-B).
- **Characterization sufficiency and red-ability:** the cases are now sufficient. Red-ability is NOT planned per case
  (CR-A).
  - D4/task 1.5 plan "one red mutation per T1-T4", but T2 alone has 7 cases. The new seed-at-mount and L370 cases, and
    the reused existing tests ("reuse existing tests where they already pin a case"), would never be shown to fail.
    Each needs its own red, or the case is evidence-shaped.
- **Scope:** coherent. Clusters C5-C9 map to AC3, and the line ranges are now correct: grep shows C7 starting ~L490
  with `useSearchParams` at 529, C8 at 549/561, and C9 from 647 to 717-720. Items 4-5 are deferred with a filing task.
  D1 is declared behaviour-adjacent, satisfying the driver's "item 1 may not be a pure refactor". C1 forbids new
  disables.

### Verdict: REFUTE

### Change Requests

1. **(CR-A) Make every T2 case red-able, and pin the L370 case precisely** (design D4 T2 + "each with a recorded red
   mutation"; tasks 1.5, 2.3).
   - (a) Replace "one red mutation per T1-T4" with one recorded red mutation per T2 case, at minimum for each NEW case
     and for each reused existing test the design cites as pinning a case. Name the mutation per case. Examples:
     - delete usePipelineDetailPage.ts:274 → F-105 and the seed-at-mount variant go red (2 analyzes);
     - delete usePipelineStepCreation.ts:370 → the L370 case goes red;
     - make the L375 guard always-false → the defer case goes red.
   - (b) Specify the L370 case's timing regime and full expected counts. On base the count depends on whether the
     rejected create outlives the 300ms debounce:
     - **Slow regime:** one dispatch at the in-flight fingerprint, then exactly one more after the failure re-excludes
       the draft.
     - **Fast regime:** zero, because the post-failure fingerprint equals the last analyzed one.
     "Exactly one debounced analyze" fits neither total. State which regime the test drives (fake-timer advance before
     the rejection) and pin the count for each phase.
   - (c) Keep the round-1 CR3 requirement in task 2.3: after D1c, re-run the L370 case with the mirror update at L370
     omitted and record it red. The base-side deletion of L370 in (a) satisfies the "red-able" half. The post-D1c run
     proves the mirror is what the test observes.
2. **(CR-B) The lint/masking proofs must assert the complete diagnostic set** (design D1 lint proof L66-70, D2
   L79-81; tasks 2.4, 3.2).
   - With the suppression deleted, lint output for the file must be exactly one message: that `exhaustive-deps`
     warning, byte-equal to base. It must not merely show "0 `react-hooks/refs`".
   - The suppression makes the compiler lint skip the whole function. After D2 that function is
     `usePipelineDebouncedAnalyze`, so any other compiler-rule diagnostic introduced by D1b (e.g. in the seed-token
     consumption) would be masked as well. Record the full JSON, not a filtered count.

### Non-blocking notes

- The D1a reader inventory should also list child ref callbacks. They attach in the layout phase, before the parent's
  layout effects.
- The HEL-1465 `hooklib.py` extracts deps only for `useCallback`/`useMemo`/`useEffect` (L96). When adapting it, add
  `useLayoutEffect`, so the D3 move of the `allOutputsRef` layout effect is deps-checked as well as byte-checked.
- design.md Context still says "React 19.2.8". package.json declares ^19.3.0 (round-1 note); unchanged, and not this
  ticket's problem.
