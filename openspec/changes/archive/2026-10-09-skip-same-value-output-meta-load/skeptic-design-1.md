## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD: ecaa1a532dcbf10b8d7f3664335bff392fd59554 (artifacts untracked in the change dir).

### What I verified (with evidence)

- **cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/output-meta-redundant-render/HEL-1380`.
- **The premise holds on the current tree.** `frontend/src/features/panels/hooks/useOutputMeta.ts`:
  - L24-26: `isLoading` initial = `outputId === null ? false : getOutputMetaCached(outputId) === undefined`.
  - L44-48: on a cache miss the effect queues `Promise.resolve().then(() => setIsLoading(true))`, which is the same value on a cache-miss mount.
  - L30-39: the null branch queues `setOutput(null); setIsLoading(false)`, which is the same value on a null mount.
  - On a cache hit nothing is queued. The orchestrator's premise-validation claims are correct.
- **Consumers (shape must stay unchanged):** PanelCardBody.tsx:101, PanelContent.tsx:217, usePanelCardInspect.ts:33, usePanelRunRefresh.ts:15, OutputControlsEditor.tsx:38, PanelDetailModal.tsx:78/198. The "two copies per card" wording is approximately right, as the ticket notes.
- **The HEL-1215 comments to correct are at `PanelCard.test.tsx` ~L595-617**, which matches tasks 2.2.
- **Cache-reset hook exists:** `resetOutputFreshness()` (outputFreshness.ts:100). It clears `outputMetaCache` via `onFreshnessReset`.
- **Probe: React's eager bailout decides whether a "red" is even possible.**
  - I ran a scratch probe outside the worktree (node + jsdom + the worktree's React 19.2.8, `IS_REACT_ACT_ENVIRONMENT`). It reproduces the hook logic, mounts inside `act`, then flushes microtasks inside `act`. I ran it twice and got the same result both times.
  - **Isolated component (renderHook-equivalent):**
    - pre-fix cache-miss: **1** render
    - fixed: **1** render
    - pre-fix null mount: **1** render
    - React eagerly bails out of the same-value update with **no** re-invocation, because the freshly mounted fiber has no pending lanes. **A hook-level render-count test cannot go red on the current hook.**
  - **The same component with a sibling mount-time state update** (`useEffect(() => setX(1), [])`, so the fiber has re-rendered once before the microtask fires):
    - pre-fix cache-miss: **3**
    - fixed: **2**
    - pre-fix null mount: **3**
    - This is the condition PanelCardBody meets in production and in HEL-1215's test, which saw a baseline of 2 then 3. The red is real there.
- **Lint: `react-hooks/refs` is in force.** The root `eslint.config.cjs` spreads `reactHooks.configs.recommended.rules` (plugin ^7.0.1). Its recommended set includes `react-hooks/refs`. I piped a render-time `r.current = a` through eslint with the worktree config (`--stdin`, nothing written). It printed `Cannot update ref during render  react-hooks/refs`, and that is an error. The lint gate allows zero warnings.

### Verdict: REFUTE

The diagnosis and the fix direction are sound. Two parts of the plan cannot be carried out as written, and the executor would hit both of them in task 1.1 and task 2.1.

### Change Requests

1. **tasks.md 1.1 / design.md D2: the hook-level red is infeasible as specified.**
   - 1.1 says "Verify the render-count assertion is RED on the current hook". A plain `renderHook` mount gives 1 render both before and after the fix (probe above), so 1.1 will either stall into the escalation path in the Risks section or tempt a rigged test.
   - Revise 1.1 so that one of these holds:
     - (a) It is explicitly a **guard** test: it pins the loading transitions (mount, resolve, reject, loaded→uncached, loaded→null, null mount), and the red/green proof lives only in 1.2.
     - (b) If a hook-level red is wanted, the harness must force a prior re-render of the host component before the microtask fires. For example, a wrapper component with a mount-time `useEffect` state update, which the probe shows gives 3 before the fix and 2 after.
   - State in design.md D2 why a bare `renderHook` cannot go red: React's eager same-value bailout when the fiber has no pending lanes. That way the executor does not rediscover it.
2. **design.md D1: drop the "assigned during render from state" option.** It fails `npm run lint` (`react-hooks/refs`, verified above). Prescribe one lint-clean mechanism:
   - mirror into the ref synchronously alongside every `setIsLoading`/`setOutput` call, initialised from the same initial-state expressions; or
   - a mirror `useEffect` declared *before* the fetch effect, so it runs first in the same commit; or
   - option (c), the derived `resolvedForId` state.
   Keep the requirement that the ref must not be stale across an id change, and keep the existing loaded→uncached test as its check.
3. **The null-branch change has no red proof.** proposal.md lists skipping the null-branch same-value reset as a behaviour of this change. tasks.md only pins its end state ("null mount (false)"). Either add a red/green render-count case for a null mount, using the 1(b) harness (probe: 3 before, 2 after), or move the null-branch edit to a stated non-goal. Do not ship an unproven change.

### Non-blocking notes

- tasks.md has an empty `## Standing Constraints` heading. Either fill it or remove it.
- 1.2 counts renders through the `usePanelPolling` mock call count, which is the existing pattern in PanelCard.test.tsx. Name the exact expected numbers (before → after) in the test, not just "one fewer", so the evaluator can check the red run against them.
- HEL-1365 sequencing AC: the orchestrator says it merged as 0ebc784b. I did not re-verify this and it does not block.
