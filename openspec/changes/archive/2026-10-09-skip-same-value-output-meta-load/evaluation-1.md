## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `3f8d8e46399a04a660a3e0fd2a2a93f4ec3a28f2`. Diff base resolved live from origin/main: `ecaa1a532dcbf10b8d7f3664335bff392fd59554`. One commit is under review.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (skip same-value update): met. `useOutputMeta.ts` reads a ref holding the last committed state. It queues the cache-miss `setIsLoading(true)` only when the hook is not already loading. It queues the null-branch reset only when `output !== null || isLoading`.
- AC2 (render-count test, red then green): met, and I checked it myself. With only `useOutputMeta.ts` reverted to the base version, both tests in `PanelCardBody.mountRenders.test.tsx` fail with `Expected: 2, Received: 3` (the PanelCardBody cache-miss test and the `useOutputMeta(null)` wrapper test). With the fix in place, both pass. I restored the hook afterwards and `git status` was clean.
- AC3 (no change in loading behaviour): met. 29 targeted suites passed (214 tests). They cover useOutputMeta, outputMetaCache, outputFreshness, PanelCard*, PanelContent, usePanelRunRefresh and the HEL-1392 remount/cache tests. The full suites also passed (see Phase 2).
- AC4 (sequencing): HEL-1365 has already merged (premise validation in ticket.md).
- Every task in tasks.md is marked done and matches the diff. The change touches only the 4 frontend files listed in files-modified.md plus the change's own artifacts. No scope creep.
- The public shape `(outputId: string | null) => { output, isLoading }` and `OutputMetaResult` are unchanged.
- No API or schema changes; `skip_specs` is correct.
- Constraint C1 is honoured. The red/green proofs run at the PanelCardBody level and through a wrapper that has a second update pending at mount, with exact counts (3 to 2). The bare `renderHook` tests are labelled GUARD in `useOutputMeta.test.tsx` and state the mutation that makes them fail.
- Constraint C2 is honoured. The ref is synced only inside a `useEffect` with no dependency list, declared before the fetch effect. The ref is never written during render (`useRef(initial)` is not a write), and `npm run lint` is clean.

### Phase 2: Code Review — PASS
Gates, run fresh by me in WORKTREE_PATH (under `nice -n 19`, jest with `--maxWorkers=3`):
- `npm run lint`: exit 0
- `npm run format:check`: exit 0
- `npm run typecheck`: exit 0
- root `jest`: 43 suites / 418 tests passed
- frontend `jest`: 495 suites / 5168 tests passed
- `npm --prefix frontend run build`: exit 0

Mutation checks, run by me and reverted afterwards:
- Remove the line that syncs the ref (`committed.current = ...`): 1 GUARD test fails.
- Delete the queued `setIsLoading(true)`: 1 GUARD test fails, as the test file's header says it should.

Correctness of the ref mirror (a point the orchestrator asked me to check):
- On an id change, React runs the sync effect before the fetch effect within the same commit, so the fetch effect sees the state of the render that changed the id. The ref cannot be stale across one commit.
- Rapid switching (loaded A, then uncached B, then uncached C before B's microtask runs): B's cleanup cancels its microtask, and the committed `isLoading` is still `false`, so C queues `setIsLoading(true)` itself. That is correct.
- Possible race: A's fetch resolves and its update is still pending when a synchronous (`flushSync`) switch to an uncached B commits. If that commit skipped A's pending update, the hook would end up showing A's output with `isLoading: false` for B.
  - I tested this directly with a temporary probe (`createRoot`, act environment off). The probe file has been deleted.
  - Result on both the new hook and the base hook: `[["o1",null,true],["o2","o1",false],["o2","o1",true]]`. React 19 folded A's pending update into the sync render, so the ref read `isLoading: false` and the effect queued the loading flip. The final state is the same as before the change. No regression.
- The StrictMode double-run of effects is harmless: the first fetch is cancelled, the second effect still sees `isLoading: true` and skips the queue, and the second fetch resolves.

The `eslint-disable-next-line react-hooks/set-state-in-effect` in `PanelCardBody.mountRenders.test.tsx` (inside `Consumer`) is acceptable:
- It sits in a test fixture whose whole purpose is to create the second update pending at mount that C1 requires.
- It carries a reason comment.
- CONTRIBUTING.md has no rule against justified suppressions, and the same rule is already suppressed in production code (`DesktopPanelGrid.tsx`, `DataGrid.tsx`).

Comments meet CONTRIBUTING.md. The hook comment records an ordering hazard, the test headers explain why a bare `renderHook` cannot go red, and the HEL-1215 comment in `PanelCard.test.tsx` was corrected without removing the absorbing `rerender`.

Other checklist items (DRY, type safety, error handling, dead code, over-engineering): nothing to raise. Errors from `fetchOutputMeta` are still handled the same way. The `as never` casts in `makeStore` follow a pattern already used in 63 test files.

### Phase 3: UI Review — N/A
The change triggers a UI review (`frontend/**`), but it changes no observable behaviour; it only removes a render that React was bailing out of anyway.
- I started the servers with `start-servers.sh` and confirmed them with `assert-phase.sh servers` (PASS).
- `/` redirects to `/login`. The browser has no session, and the only 2 console errors were the expected 401 from `/api/auth/me`.
- Every page that uses `useOutputMeta` (PanelCard, PanelCardBody, the detail modal, the inspect view) is behind authentication. The public share viewer renders no `PanelCard`.
- Logging in would write a session row to the dev DB, which the run's standing constraint ("no dev DB writes") forbids. So the browser checks did not cover the hook.
- Loading-state behaviour is instead covered by the GUARD tests and the full jest suite above.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `PanelCardBody.mountRenders.test.tsx` `PanelCardBodyHarness` copies `PanelCard`'s prop mapping but leaves out `mountOwnership` (`PanelCard.tsx:110`, `:235`). The red/green result does not depend on it (3 to 2 verified). If `PanelCard`'s wiring changes, though, the harness could drift from production without anyone noticing. Mounting `PanelCard` directly, or adding a comment saying why `mountOwnership` is omitted, would close that gap.
- The ref-sync effect has no dependency list, so it runs on every commit. That is cheap and correct; noting it only so a later reader does not "optimise" it into `[output, isLoading]` dependencies, which would make no difference anyway.
