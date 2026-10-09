## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD: ecaa1a532dcbf10b8d7f3664335bff392fd59554 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/output-meta-redundant-render/HEL-1380`.
- **The premise still holds on the current tree.** I re-read `frontend/src/features/panels/hooks/useOutputMeta.ts`:
  - L24-26: `isLoading` initial = `outputId === null ? false : cache miss`.
  - L44-48: on a cache miss the effect queues `setIsLoading(true)`, which is the same value on a cache-miss mount.
  - L30-39: on a null mount the null branch queues `setOutput(null)` and `setIsLoading(false)`, which are the same values.
  - Effect deps are `[outputId]`, with a `cancelled` guard.
  - This matches design.md's Context.
- **Round-1 CR1 (a bare renderHook cannot go red) is addressed.**
  - design.md D2 now states why: React's eager-state bailout when nothing else is pending (1 render before and after).
  - The red/green proof moves to the PanelCardBody level (tasks 1.1), with exact before and after counts.
  - Bare-hook tests are labelled GUARD (tasks 1.3) and must be shown failable by a stated mutation (loaded→uncached id, never queuing `setIsLoading(true)`).
  - The rule is promoted to Standing Constraint C1 in tasks.md and in workflow-state.md `CONSTRAINTS`.
  - The PanelCardBody red is plausible on ground truth:
    - PanelCardBody.tsx:101 calls `useOutputMeta(outputId)` and L155 calls `usePanelPolling` (the counting hook).
    - HEL-1215's comment in PanelCard.test.tsx ~L599-617 records the observed CI baseline flip from 2 to 3.
  - The Risks section requires escalation rather than shipping an unproven test.
- **Round-1 CR2 (render-time ref write fails lint) is addressed.**
  - D1 explicitly forbids render-time ref writes and cites `react-hooks/refs`.
  - D1 prescribes two lint-clean ways to sync the ref: (i) update it next to each setter, or (ii) a mirror `useEffect` declared before the fetch effect. Option (c), the derived resolved-for-id state, avoids the ref entirely.
  - This is Standing Constraint C2.
  - I traced the transitions under option (ii) and found no stale-ref path:
    - loaded→uncached: committed false, so `true` is queued.
    - loading→uncached: true, skipped, and it stays loading.
    - loading or loaded→null: the reset is queued.
    - null→uncached: false, so `true` is queued.
  - The loaded→uncached GUARD test covers the stale-ref risk.
- **Round-1 CR3 (the null branch had no red proof) is addressed.** tasks 1.2 adds a red/green render-count test for the null branch. It uses a wrapper with one other pending mount-time update, the harness the round-1 probe measured at 3 before and 2 after, and records exact counts.
- **AC coverage:**
  - Skip same-value updates: 2.1.
  - Render-count test, red then green, one fewer PanelCardBody render: 1.1 plus 2.1.
  - No loading-state behaviour change: 1.3 GUARDs plus the 3.1 full suite.
  - Sequenced after HEL-1365: `git merge-base --is-ancestor 0ebc784b HEAD` says it is an ancestor (0ebc784b is "HEL-1365 Split PanelCard.tsx …").
- **Cache reset between tests exists:** `resetOutputFreshness()` at outputFreshness.ts:100. outputMetaCache.ts:24 registers `cache.clear()` via `onFreshnessReset`.
- **Placeholders, contradictions, scope:**
  - No TODO/TBD anywhere.
  - Proposal, design and tasks agree. The public shape stays unchanged, and HEL-1394's consumption is noted as a non-goal.
  - No API or schema surface, so no contract delta is needed.
  - The empty Standing Constraints heading from round 1 is now filled.

### Verdict: CONFIRM

### Non-blocking notes

- proposal.md says "The change sets `skip_specs: true`", but `workflow-state.md` has no `skip_specs` field. The orchestrator should record it wherever its spec-skip mechanism actually reads it, or the archive step may expect a delta.
- 1.1 says the pre-fix count is "expected one higher". If the measured delta differs (for example because PanelContent's own consumer interacts), the executor should report the real numbers and not force "one". The ticket AC wording is "one fewer", so a different delta needs explaining in the report.
- 3.1 omits `npm run format:check`. The pre-commit hook covers it, but the evaluator should run it too.
- `useRef` cannot take a lazy initialiser. For option (i), `useRef(isLoading)` and `useRef(output)`, seeded from the committed initial state, are the natural lint-clean form.
