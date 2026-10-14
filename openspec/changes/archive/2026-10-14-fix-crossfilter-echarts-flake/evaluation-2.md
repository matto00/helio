## Evaluation Report — Cycle 2 (evaluation-2.md)

- Reviewed HEAD: e02142ff494e538e9d5c0271d071666ed018c770.
- Base: 609e62b6d, resolved live.
- Diff: `measurements.md` (+104) and `tasks.md` (+17). Docs only.

### Phase 1: Spec Review — FAIL

Cycle 1's change requests that were addressed:
- **CR1, pre-mount stall probe:** done. The table is consistent with my cycle-1 probe: 1200 ms run alone
  fails with the CI DOM, and the whole file fails with the meta-loading DOM.
- **CR2, corrected mechanism:** done, and the stall source on CI is honestly labelled UNCONFIRMED.
- **CR4, tasks.md:** done. Items are ticked, and 1.7-1.9 are marked N/A with reasons.
- **CR5, literal commands and the CI step:** done.
- **The warm-up experiment's reading is sound.** Pre-resolving the lazy payload removes the Suspense
  fallback, but the cliff stays at a stall of about 1000 ms. So the 300 ms reveal throttle is not the
  binding constraint.

The blocking issue:
1. **The outcome's key claim is refuted.** measurements.md says: "No test-only change removes the
   dependency ... the only levers are a longer window (forbidden, C1) or retries (forbidden)". That is not
   true. The dependency is the test racing a fixed 1000 ms `findBy` polling deadline against work of
   unknown duration. A test-only change can remove that race. It awaits the causal promises (the
   `getOutputById` resolution and the lazy `ChartPanel` module) inside `act`, then queries synchronously:

   ```ts
   await act(async () => {
     await Promise.all(getOutputByIdMock.mock.results.map((r) => r.value));
     await import("./ChartPanel");
   });
   const gridChart = screen.getAllByTestId("echarts")[0] as MockChartNode;
   ```

   I prototyped this in a throwaway detached worktree at e02142ff4 (removed afterwards; nothing committed or
   modified in the delivery worktree). It replaced line 369's `findAllByTestId`. I used the executor's own
   stall injection, a busy-wait in the `getOutputById` mock's resolution microtask. Every run used
   `CI=true nice -n 19 --maxWorkers=1` and ran one at a time:

   | Stall | Mode | Unmodified test | With the change above |
   |---|---|---|---|
   | 0 ms | alone (`-t`) | 1/1 pass | 1/1 pass |
   | 0 ms | whole file | — | 3/3 pass |
   | 1200 ms | alone (`-t`) | 1/1 FAIL (CI DOM: `suspense-fallback--panel`) | 5/5 pass |
   | 1200 ms | whole file | 2/2 FAIL | 5/5 pass |
   | 3000 ms | alone (`-t`) | — | 3/3 pass |

   This is neither a raised `findBy` timeout nor a retry, so C1 holds. It waits on the event the assertion
   depends on instead of polling against a wall-clock deadline. That is the "remove the timing dependency"
   design.md's proposal asks for. The only remaining bound is jest's global per-test timeout, which applies
   to every test and is not changed. The assertion itself still uses the real chart path
   (`getAllByTestId("echarts")`), so the regression guard is kept.
   - **Is the stall injection site representative?** It is artificial, and the CI stall source is still
     unknown. But the D5 protocol accepts an artificial-latency variant to demonstrate a fix. This variant
     reproduces the exact CI failure DOM and the failing line. The mechanism is probe-confirmed:
     wall-clock deadline vs a pre-mount main-thread stall. A fix proven against it, before 0/N and after
     N/N, meets the ticket's "before/after over N repeats" AC. The no-code outcome does not.

   The ticket's no-fix branch is "if the failure cannot be reproduced locally". The failure now reproduces
   deterministically, and a test-only, C1-compliant fix demonstrably removes it. The no-fix outcome is
   therefore not justified.

CONSTRAINTS:
- C1: honoured by the proposed change; no timeout raised, no retry.
- C2: probes were jest ≤ 3 workers (1 used), `nice -n 19`, run sequentially.
- C3: the proposed change is judged by the echarts node being in the DOM.

### Phase 2: Code Review — PASS

Only `openspec/**` changed, so no frontend or backend gate trigger matches. As a fresh check, prettier passes
on `measurements.md` and `tasks.md`.

### Phase 3: UI Review — N/A

No UI-affecting files changed.

### Overall: FAIL

### Change Requests

1. **Apply a deadline-free wait in `frontend/src/features/panels/ui/PanelCard.crossFilter.test.tsx`.**
   - Replace the grid `await screen.findAllByTestId("echarts")` (line 369) with an `act`-wrapped await of
     the causal promises, followed by a synchronous `getAllByTestId`. Use the snippet above, or an
     equivalent: for example, keep a handle on the promise `getOutputById` resolves with, rather than
     reading `mock.results`.
   - Apply the same treatment to the Fullscreen `within(fullscreenDialog).findByTestId("echarts")` (line
     397). It waits on a second `useOutputMeta` fetch and has the same deadline exposure.
   - Add a why-comment. It must explain the race (a 1 s polling deadline vs a main-thread stall before the
     chart mounts), not just cite a ticket.
   - Keep `findByText` waits only where nothing in them can stall. Otherwise give them the same treatment.
2. **Record before and after in measurements.md under D5, with the same N.** Use the 1200 ms pre-mount
   stall, both alone and whole file:
   - before: fails N/N;
   - after: passes N/N;
   - plus at least one stall above 2 s for the after condition;
   - plus an unstalled clean run (30 cold CI=true single-file runs) showing no regression, with
     render-to-visible (C3).
3. **Update tasks.md 1.7-1.9 and run the frontend gates.** Remove the N/A markings, then run
   `npm run lint`, `npm run format:check`, the typecheck, and the panels test folder with `--maxWorkers=3`
   and `nice -n 19`.
4. If you disagree that awaiting the causal promises is in scope under C1, do not keep the no-code outcome
   on your own judgment. Raise it as an explicit ESCALATION with this evidence.

### Non-blocking Suggestions

- `PanelCard.inspect.test.tsx` and `PanelCard.aggregateChart.test.tsx` use the same `findByTestId("echarts")`
  pattern after a lazy load. Note them as a follow-up candidate, per design.md's Risks section.

Evidence note: the prototype ran in a throwaway `git worktree add --detach` copy at e02142ff4 under the session
scratchpad, with a copied `frontend/node_modules`. It was removed with `git worktree remove --force`, and
`git worktree list` shows no straggler. The claims rest on pass/fail outcomes and DOM content only, not on
file mtimes.
