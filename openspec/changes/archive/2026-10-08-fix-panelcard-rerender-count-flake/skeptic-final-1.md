## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `c8daa8bad4a2b3ad1f569c2967b881e63cc736ff`. Diff base was resolved live with `resolve-review-base.sh` (main/origin) and came back as `0a1eacd7da55c2612894d991f2f2df88df7f69c6`. origin/main is now `60fdb87de` (HEL-1304). That commit touches neither `PanelCard.tsx` nor `PanelCard.test.tsx`, and `git merge-tree 60fdb87de c8daa8bad` merges cleanly.

### What I verified (with evidence)

- **Diff scope.** `git diff BASE...HEAD` changes one code file, `frontend/src/features/panels/ui/PanelCard.test.tsx` (+9). That is a comment plus one line, `rerender(<PanelCard panel={panel} {...noopProps} isEditingTitle={false} />);`, placed before the baseline sample. Everything else is openspec artifacts. `PanelCard.tsx` and the hooks are untouched (C5).
- **Assertion stays exact (C2).** Line ~624 is still `expect(mockUsePanelPolling.mock.calls.length).toBe(callsBeforeRerender)`, and `getOutputRowsMock` is still `toHaveBeenCalledTimes(1)`.
- **Root cause is plausible and consistent with the code.**
  - `useOutputMeta.ts` runs `Promise.resolve().then(() => setIsLoading(true))`, which is a same-value update because `isLoading` starts out `true`.
  - `getOutputById`, `getOutputRows` and `getAssertionStatus` are all mocked as never-resolving (test lines 71 and 566–573). That leaves the deferred bail-out render as the only late async render source.
  - The persisted scratch probe (`PanelCard.scratch.test.tsx.txt`, `useOutputMeta.probe.diff`) and `before-single-{17,20,37,38}.log` (each `Expected: 2 / Received: 3` at :618) match the mechanism described.
  - Under act, React re-queues the root task into the act queue, so an act-wrapped root update processes the pending lane synchronously. The fix relies on that, and my measurements below agree with it.
- **Natural red, then 0/N after, measured by me.**
  - Setup: a throwaway detached worktree at c8daa8bad under the session scratchpad. `PanelCard.before.test.tsx` is the fixed file with only the settle `rerender` line removed (I confirmed by `diff` that it is exactly one line).
  - Recipe: 3 `nice -n 19` busy-loop burners (pidfile, killed by pid, liveness confirmed gone) plus 1 nice-19 jest `-i` process, single test `-t`. That is 4 CPU-heavy processes in total (C3).
  - **BEFORE: 5/40 fail** (p = 0.125), all `Expected: 2 / Received: 3`.
  - **AFTER: 0/50 fail.** All 50 logs read `1 passed`.
  - C6 floor: max(50, ceil(3/0.125) = 24) = 50, which is met.
  - These agree with the executor's 4/40 → 0/50 single-test and 1/30 → 0/90 whole-file figures, and with the evaluator's 1/40 → 0/40.
- **Intent preserved / masking check (memo-break mutations, applied only in the scratch worktree against the fixed test).**
  - M1, `onDataPointSelect={(...a) => handleDataPointSelect(...a)}` (a fresh prop on every render): red 5/5, `Expected: 3 / Received: 4`.
  - M4 (mine), `onDataPointSelect={isEditingTitle ? (...a) => handleDataPointSelect(...a) : handleDataPointSelect}`. This prop changes only on the title-edit rerender, which is exactly the class a settle rerender could in theory hide. Result: red 5/5, `Expected: 3 / Received: 4`.
  - Why the settle rerender cannot mask a regression: it runs before `callsBeforeRerender` is sampled, its props are identical, and it is synchronous under act. Any render caused by the title-edit props still counts after the baseline.
  - Scratch worktree removed; `git worktree list` shows no scratchpad entry.
- **Gates for the changed file, run in WORKTREE_PATH.**
  - Whole `PanelCard.test.tsx`: 35/35 passed.
  - `prettier --check`: clean.
  - `eslint --max-warnings=0`: ok.
  - The evaluator's full-suite, typecheck and build results are pasted with exit codes in evaluation-1.md. A one-line test change cannot affect typecheck or build beyond this file, which lint and jest just compiled.
- **C1–C6.**
  - C1: probe-confirmed cause plus a natural red, reproduced by me.
  - C2: assertion unchanged.
  - C3: my recipe stayed at 4 processes, nice 19, pidfile kill.
  - C4: I wrote nothing under ~; all git commands used `git -C`.
  - C5: no edit to `PanelCard.tsx`.
  - C6: rates come only from the uninstrumented before and after tests, and N_after = 50 meets the floor.
- **Acceptance criteria.**
  - Root cause answered: it is a real extra render (a deferred same-value bail-out) scheduled outside act. It is an act-boundary artefact, not StrictMode and not a product memo break.
  - Measured red followed by 0/N: yes.
  - Assertion not loosened: yes.
  - Mutation check: yes (two mutations).
  - No `PanelCard.tsx` diff: yes.

### Verdict: CONFIRM

### Non-blocking notes

- The evaluator raised two items. Neither blocks:
  - **Stale HEL-1027 comment.** `PanelCard.test.tsx` ~604 still claims the two-tick flush gives "a genuinely SETTLED baseline", and the new HEL-1215 comment directly below says otherwise. The new comment corrects the record in place, so a reader will not be misled about behaviour. Trimming the old sentence would be a worthwhile one-line polish in a later touch.
  - **Unpersisted logs.** `probe-evidence.md` cites M1 and AFTER logs that were never persisted. This is non-blocking because I reproduced both the AFTER rate (0/50) and M1 (5/5 red) fresh, so no verdict here rests on the missing logs. None of the evidence I relied on depends on mtime ordering.
- The C6 floor is met by the single-test recipe. The whole-file recipe's p was lower (0.033), and its AFTER N=90 meets its own floor as reported in `results.txt`. I did not re-run the whole-file recipe; the single-test recipe has the higher failure rate and is the stronger discriminator.
