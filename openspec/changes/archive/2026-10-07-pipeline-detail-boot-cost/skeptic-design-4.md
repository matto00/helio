## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed at HEAD 70b063a47046910b4526f7de0add5901cc39fbb0. The change dir is untracked and there are no code edits yet. Spawn-cwd guard: READY. I read ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-editor-page/spec.md and skeptic-design-3.md. I checked them against the live code in `frontend/src/features/pipelines/` and the repo's ESLint config.

### What I verified (with evidence)

**Round 3 CR1, the A -> B -> A openId collision, is closed.**
- D3 now issues a token from a module counter in two places:
  - the `useState` lazy initializer, on mount;
  - a derived-state branch during render, whenever `id` differs from the token's recorded id.
- So A -> B -> A gives three distinct tokens. A remount gets a new lazy init. StrictMode's simulated remount keeps state, so the token is unchanged.
- The spec's revisit and late-response scenarios now name the in-place switch. Task 3.2 adds the A -> B -> A test, which must be red against `<mount>:<id>`.

**The token mechanics are lint-clean. I probed this rather than taking it as given.**
- The recommended rule set of `eslint-plugin-react-hooks` 7.0.1 (`eslint.config.cjs:93`) includes `react-hooks/globals: error` as well as `refs` and `purity`.
- I piped a scratch hook through the repo's ESLint with `--stdin`, so nothing was written to the worktree.
  - Variant A calls a module-level `nextOpenToken()` helper that increments the counter. It is clean, both in the lazy initializer and in the derived-state `setOpen`.
  - Variant B increments `openCounter += 1` inline during render. It fails: `react-hooks/globals: Cannot reassign variables declared outside of the component/hook`.
- The design is implementable as written. The implementer must use the helper form (see notes).

**The derived-state reissue and the mount effect agree.**
- `lastFetchedIdRef` (`usePipelineDetailPage.ts:301-317`) re-dispatches on A -> B -> A, because the ref holds B when A returns.
- The derived-state `setState` re-renders before commit. So the effect that sees `id=A` also sees the new token, and the chain does not capture a stale openId at dispatch.
- A chain from A's pending `fetchPipelineById` that lands after the user has moved to B can still dispatch one GET for A under A's old token. That GET is never fresh for a later open. It is waste, not a spec violation (see notes).

**Other checks on the D2/D3 mechanics:**
- **Force path:** `onTerminal` is read through `onTerminalRef` (`usePipelineRunEvents.ts:80-82`), so it sees the current openId. `handleRunPipeline` and `handleDryRun` (`:1253-1275`) are `useCallback`s that will need openId in their deps, which exhaustive-deps enforces.
- **Condition across opens:** dedupe requires the same openId, so a new open is never swallowed. Latest-request-wins drops the old open's response.
- **No cleanup reset:** `clearRunState` (`pipelinesSlice.ts:371`) does not touch `runHistory`.
- **Banner consumer:** `runs` is read only by the persisted banner (`PipelineDetailPage.tsx:188`) and by `RunHistoryModal` (`:388`). No other consumer exists outside `features/pipelines`. The deferral claim holds.

**Earlier rounds stay closed:**
- Round 1: CR2 (force plus latest-wins, task 3.3), CR3 (C1 and D5's exact 8x config) and CR4 (no count in the title, empty state only when fresh).
- Round 2: CR1 (a)-(c).
- Round 3: the test-migration additions at ~2183 and ~3061-3080. They exist at `PipelineDetailPage.test.tsx:2183`, `:3068` and `:3079`.

**Other:**
- No TODO/TBD placeholders.
- No contract or schema impact.
- Every AC is covered.
- HEL-1350's files are avoided.

### Verdict: REFUTE

### Change Requests

1. **D3 does not say what triggers the modal-open fetch, and its render-state list has a gap. Both readings of the trigger produce a defect.**

   **Ground truth:**
   - `historyOpen` is plain hook state (`usePipelineDetailPage.ts:233`).
   - The only thing that resets it is the modal's `onClose` (`PipelineDetailPage.tsx:388`).
   - The `/pipelines/:id` route has no `key`, and `shared/ui/Modal.tsx` has no route or popstate handling.
   - So the modal stays open across an in-place `id` change. Example: the modal is open on A, and the browser Back button goes to the previous in-place entry, `/pipelines/B`.

   **Reading 1: the fetch is a click-time event.** On the in-place switch, B gets a new openId. B is not fresh and nothing is in flight for this open. B's status is idle, or "succeeded" from an older open.
   - That state is none of D3's three render states (fresh / not-fresh-and-loading / not-fresh-and-failed).
   - Nothing will ever dispatch the fetch, so the modal shows either a spinner that never ends or an undefined fallback.
   - Today, the unguarded `[dispatch, id]` effect fetches B and the open modal lists B's runs. This would be a regression under the "No behaviour regressions" AC.

   **Reading 2: the fetch is a reactive effect** on `historyOpen` / freshness / in-flight. The rule as written ("dispatch when not fresh for this open and no request for this open in flight") is also true right after a failure.
   - So a failed fetch re-dispatches immediately, and keeps doing so.
   - The modal alternates between loading and error instead of resting on error-with-retry.
   - An RTL test that only uses `findByText` on the error copy could still pass while this happens.

   **Required revision:**
   - **State the trigger explicitly in D3.** Then do one of these:
     - Close the modal on an `id` change: reset `historyOpen` in the same derived-state branch that reissues the token.
     - Use a reactive dispatch keyed on (modal open, openId) that fires at most once per open, and never re-fires after a failure for that open until Retry.
   - **Make the render-state list exhaustive.** In particular, define what renders when the list is not fresh and no request for this open has been issued.
   - **Add to the spec** the in-place-switch-with-modal-open path.
   - **Add to task 3.2:**
     - An RTL test: the modal is open on A, then an in-router navigation goes to B. Assert either "the modal closes" or "B is fetched and B's runs render, never A's", depending on the chosen behaviour.
     - In the error-state test, an assertion that `fetchRunHistory` was called exactly once until Retry is clicked.
     - Each of these must be red against the defective reading.

### Non-blocking notes
- **Counter mechanics:** use a module-level helper (`function nextOpenToken() { counter += 1; return counter; }`). An inline `counter += 1` during render fails `react-hooks/globals`, which is an error in this repo's config. That rule is the one the round-3 note did not name. Say so in D3, so the executor does not reach for `eslint-disable`.
- **Slice tests to migrate:** `pipelinesSlice.test.ts:481-511` dispatches `fetchPipelineRunHistory.fulfilled(...)` with no preceding `pending`. Under latest-request-wins, those fulfilled actions would be dropped, because no requestId is recorded. The existing tests also pass a bare string `arg`. Task 2.1's "slice tests pass" covers this implicitly. List it, so the migration is deliberate and not a weakened assertion.
- **Stale boot chain:** a chain from a previous id's `fetchPipelineById` that lands after an in-place switch dispatches one history GET for the previous pipeline. This does not break correctness, because its openId is never fresh again. The chain could cheaply skip when the captured openId is no longer current. But a ref read for that would be in an async callback, not in render, so it is lint-legal. Optional.
- **Retry path:** `PipelineDetailPage.tsx:140-141` currently dispatches `fetchPipelineById` directly. D3 routes retry through the chain, so the hook must expose a retry handler, and the page must stop dispatching the thunk itself.
