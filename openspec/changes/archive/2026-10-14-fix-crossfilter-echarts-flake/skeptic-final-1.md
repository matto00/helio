## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `3c3a7c5c456987e18ba900e026e31cf1477930ff`. Base resolved live via `resolve-review-base.sh` (main/origin) = `609e62b6d917243355a179fa8a26318c04898c27` (exit 0).
Diff: `frontend/src/features/panels/ui/PanelCard.crossFilter.test.tsx` (+21/-8), `measurements.md` (new), `tasks.md` (new). No product code changed. No UI changes, so step 4 (visual judgment) does not apply.

All mutation and stall probes ran in a throwaway copy of the tree (`git archive HEAD frontend scripts/lib tsconfig.json` into the session scratchpad, `node_modules` symlinked). The worktree was never edited. Before deleting the copy I confirmed with `cmp` that it matched the worktree again. Every jest run used `CI=true nice -n 19 --maxWorkers=1` and ran one at a time.

### What I verified (with evidence)

1. **The shipped test passes.** 1 warm run plus 5 runs with a fresh cache each, file-scoped: `Tests: 7 passed, 7 total` every time (6/6).
2. **The injected stall reproduces the failure before the fix and not after.** I applied the same stall to both versions: a 1200 ms busy-wait in the `getOutputById` mock's resolution microtask.
   - Before (base `609e62b6d` test file): 2/2 runs failed with `Unable to find an element by: [data-testid="echarts"]`. This is the CI symptom. With no stall: pass.
   - After (HEAD test): STALL 0 / 1200 / 3000 ms all pass, 7/7.
3. **The fix has no deadline (C1).** I ran a stronger probe than the executor's: `getOutputById` resolving via `setTimeout(..., 1500)`. That is a real async delay longer than findBy's 1 s window, not a synchronous stall.
   - HEAD's `settleChartMount`: passes.
   - Same test with `settleChartMount` emptied to a bare `await act(async () => {})`: fails with `Unable to find ... echarts`.
   - So the explicit `await Promise.all(getOutputByIdMock.mock.results...)` really does the waiting: it waits on the actual promise, with no wall-clock limit. The fix contains no timeout value and no retry. The only bound left is jest's per-test timeout.
   - Side finding: with today's microtask-only mock resolution, each of the two awaits can be removed on its own, or both together, and the test still passes (React 19 async `act` drains recursively). The awaits are not decorative, though: the 1500 ms setTimeout probe shows they are what makes the wait hold up when resolution is truly async.
4. **The regression guard still works (red demanded and obtained).** Product mutation in `PanelCard.tsx`: I removed `inspectRawRows={crossFilteredRawRows}`, `inspectHeaders={crossFilteredHeaders}` and `inspectRecords={crossFilteredRecords}` from the Fullscreen overlay props, which brings back the HEL-588 CR1 bug (nested Inspect falls back to unfiltered rows). Result: `1 failed, 6 passed`. It failed at line 427, `expect(within(fullscreenInspect).queryByText("205")).not.toBeInTheDocument()`. That is the narrowing assertion itself, reached only after both chart lookups succeeded. Restoring the props makes it green again.
5. **The new comment is true.** "`getOutputById` is called once in this whole test" holds: I added `expect(getOutputByIdMock).toHaveBeenCalledTimes(1)` at the end of the test and it passed at STALL 0/1200/3000. The Fullscreen chart's synchronous `getByTestId` works in every run, which shows it is served from `outputMetaCache` and the lazy `ChartPanel` is already loaded, as the comment says. I read `outputMetaCache.ts` and `useOutputMeta.ts`: the cache-hit path initialises state synchronously, which matches.
6. **No overclaim.** `measurements.md`'s verdict says: "Mechanism reproduced via injected stall … The natural source of the CI stall is UNCONFIRMED (0 failures in 40 cold natural runs)" and "The fix removes the deadline dependency … it does not claim to remove the stall." The title and baseline section say the same. None of the five commit messages claims the flake is fixed. 3f94f4ec5 says "instead of racing findBy's 1s deadline", which is accurate, and 3086fdb71 records "not reproduced, no fix" for that stage.
7. **Systematic-debugging law.** The natural trigger was not reproduced in 40 runs, and measurements.md says so. The mechanism was confirmed by a probe: the injected stall gives the same failing line and the same DOM (Suspense fallback "Loading data") as both CI dumps. The ruled-out alternatives (a stall inside the lazy `require` is absorbed; a warm-up does not move the ~1000 ms cliff) are measured, with the commands written out. The fix targets that confirmed mechanism, not a guess, and it does not raise a timeout.
8. **Gates for the changed files:** `eslint --max-warnings=0` on the test file exit 0; `tsc --noEmit` exit 0; `prettier --check` is clean on the committed files. Its warnings were only for untracked run artifacts (design.md, evaluation-*.md, ticket.md, skeptic-design-*.md), not for measurements.md, tasks.md or the test.
9. **Scope:** test-only, a single describe block. The follow-ups (`PanelCard.inspect.test.tsx`, `PanelCard.aggregateChart.test.tsx` use the same pattern) are listed and not widened. That is correct.

### Verdict: CONFIRM

### Non-blocking notes

- The final squash commit and PR title/body are written later by the orchestrator. They must keep to "deadline race removed; runner-stall cause unknown" and must not say "flake fixed". The branch and change name (`fix-crossfilter-echarts-flake`) are only labels.
- The remaining `findByText("Showing rows for region: West")` waits still poll with a 1 s deadline. They follow a synchronous `act` click, so the text should already be committed when findBy makes its first synchronous check. Their exposure is minimal, but not proven to be zero against a natural runner stall. They passed under my 3000 ms stall probe.
- `design.md`/`proposal.md` and the other run artifacts are untracked in the worktree. Committing or archiving them is a delivery-phase job for the orchestrator.
- Mtime evidence: none of the findings above depends on mtime or directory ordering. Every claim rests on pass/fail output of commands I ran myself.
