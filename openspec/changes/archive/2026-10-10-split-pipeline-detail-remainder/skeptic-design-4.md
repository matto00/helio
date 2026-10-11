## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Amendment gate: D1d (`?outputId=` deep-link rewrite, owner ruling `rewrite-deep-link`) plus tasks 2.7/2.8, judged
against the live code at branch head `5262a7ae106a1baf381d297bf80677b8fdf2016f`. The amendment is the uncommitted
diff to design.md/tasks.md. The prior CONFIRMed parts (D1a-c, D2, D3, D4, D5, C1-C9) were not re-litigated.

### What I verified (with evidence)
- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/split-pipeline-detail-hooks/HEL-1478`.
- **Trigger for the amendment is real.** `evidence/lint-probe-D1.txt` shows `react-hooks/set-state-in-effect` at
  usePipelineDetailPage.ts:555, which is `setOutputSheet({ output: target })` inside the HEL-909 effect (L550-565 at
  HEAD). `lint-probe-isolated-searchparams-effect.json` reproduces it in a standalone file.
- **The deep-link block is byte-identical on base 744c37720 and HEAD.** I extracted the block from both and diffed
  them: IDENTICAL. Base-green verification of the new cases is therefore meaningful, and HEAD-before-D1d is an
  equivalent oracle for this block.
- **`setSearchParams` is NOT stable.** In react-router 7.18.3
  (`node_modules/react-router/dist/development/chunk-BV7QT456.mjs` ~L10949), `setSearchParams` is
  `useCallback(..., [navigate, searchParams])`. The app uses `<BrowserRouter>` (`src/main.tsx:62`), which is not a
  data router, so `useNavigate` resolves to `useNavigateUnstable`. Its deps (~L6039-6044) include `locationPathname`.
  `setSearchParams` therefore changes identity on every `searchParams` change and on every pathname change.
- **`allOutputs` identity is stable when nothing changes.** `selectOutputsForPipeline` (outputsSlice.ts:377) returns
  the stored array or the `EMPTY_OUTPUTS` sentinel. `searchParams` is `useMemo([location.search])`. So a render-time
  compare on the pair settles after one extra pass: no infinite-loop risk from the pair itself.
- **T3 counts hook-body invocations, not commits.** usePipelineDetailPage.analyze.test.tsx:150-155 puts
  `renders.count += 1` inside the `renderHook` callback. T3 also lets `listOutputs` resolve, which gives `allOutputs`
  a new identity (outputsSlice.ts:276).
- **Probe: a render-phase setState re-invokes the component body.** I ran a standalone React 19.2.8 + jsdom probe,
  using the worktree's own node_modules, with the prev-pair pattern and no deep link:
  - Pair recorded unconditionally: mount = 2 body invocations, and +2 on one list-identity change.
  - Pair update gated on the param being present: mount = 1, +1.
  - Evidence: `.concertino/runs/HEL-1478/evidence/skeptic-design-4/render-phase-probe.cjs` and
    `render-phase-probe.out.txt`.
- **An existing deep-link guard is not mentioned in D1d.** `src/features/pipelines/ui/PipelineDetailPage.outputSwap.test.tsx`
  (HEL-1430) swaps `?outputId=out-a` to `out-b` while the sheet is open. This is exactly the "param changes while
  open" path that D1d rewrites.
- **Lint-proof update.** "Complete JSON = exactly the one base-equal `'steps.length'` warning, else STOP" is well
  formed. Conditional render-phase setState is already used without lint findings by the host's derived-state block
  (L272-290), so the target is attainable. The requirement to prove `setSearchParams` in the clear-effect is not
  flagged is correctly left to the full JSON.

### Equivalence judgement (asked points)
- **Mount:** the base effect runs on mount. D1d does not say what the last-seen state is initialised to. The
  canonical React-docs idiom, `useState(currentValue)`, would never evaluate at mount. A deep link that lands with
  Outputs already in Redux would then open only after a refetch changes the identity, or never if no refetch
  happens. None of cases (i)-(v) pins this. See CR3.
- **StrictMode / transition renders:** React discards and replays render-phase updates together with the render. The
  StrictMode double effect-run of the clear effect yields two idempotent replace-navigations, the same as base. No
  defect found.
- **`setSearchParams` stability:** the premise is false (above). Dropping it from the render-time key is still sound,
  but for a different reason than D1d gives. See CR2.
- **Loop risk:** there is none, given the identity facts above. The real cost is the extra body invocations. See CR1.
- **Output reload with the param present:** equivalent. Both base and D1d re-evaluate on the new `allOutputs`
  identity.
- **Re-navigation to the same `?outputId`:** equivalent. The param was cleared, so the new navigation changes
  `location.search` and `searchParams` identity. With an unknown id left in place, the same search string keeps the
  memoised identity, so neither version re-evaluates.

### Verdict: REFUTE

### Change Requests
1. **D1d contradicts its own T3 claim, and 2.8 would hit a guaranteed STOP.**
   - D1d says that on any pair change "it records the new pair". That is a render-phase setState on mount and on
     every `allOutputs` identity change, even with no deep link.
   - T3's counter is in the hook body, so `RENDERS_AFTER_OPEN = 5` (and the later constants) go red. Measured: +1
     body invocation per recording (probe above).
   - This makes "T3's render count is unaffected (no deep link)" and 2.8's "T1-T4 green, tests untouched" false as
     designed.
   - Revise the shape so that no state is set unless a deep link is in play. For example, gate the pair update (and
     the open) on `outputId` being present, or on the target resolving. Add a one-line argument that this gating
     keeps the trigger set: whenever the param is present, every identity change is recorded and evaluated, and with
     no param the base effect is a no-op.
   - Alternatively, explicitly pre-declare the T3 delta. That is a behaviour change, though, and would need the same
     owner sign-off logic as the -1 commit.
2. **Replace the false premise "`setSearchParams` is stable (verify)".**
   - In RR 7.18.3 under `BrowserRouter`, its identity follows `searchParams` and `locationPathname` (cited above).
     An executor told to "verify" will find this false and must STOP.
   - State the actual argument instead:
     - Its identity changes are a superset of the `searchParams` key, plus pathname-only changes.
     - The effect's outcome is a pure function of the `(searchParams, allOutputs)` values.
     - After a resolved open the param is cleared, which changes `searchParams`. So a pathname-only re-run at an
       unchanged pair is a no-op re-evaluation.
   - Keep `setSearchParams` in the clear-effect's deps as on base.
3. **Specify the mount behaviour and pin it.**
   - D1d must state that the last-seen state starts at a sentinel (e.g. `null`), so the first render evaluates
     exactly as the base effect does on mount.
   - Add case (vi): Outputs are already in Redux at first render, `listOutputs` is held pending (never resolved
     during the assertion), and the sheet is open for the target.
   - Named red mutation for (vi): initialise the last-seen state to the current pair (the React-docs idiom).
   - Without (vi), cases (i) and (iv) both pass under that mutation in a harness where Outputs arrive by fetch.
4. **Case (iii)'s named red mutation is not red-able.**
   - "Stop clearing the param" does not make "closing the sheet does not reopen it" fail. In both base and D1d,
     closing the sheet changes neither `searchParams` nor `allOutputs`, so nothing re-evaluates.
   - The clear actually protects against a later `allOutputs` identity change while the param is still present,
     e.g. a save in the open sheet (outputsSlice.ts:309-312 `list.map`) or a refetch.
   - Rewrite (iii): open via the deep link, close, then produce an `allOutputs` identity change (dispatch an Output
     update or a refetch), and assert the sheet stays closed. With "drop the clear" this genuinely reopens on base
     and on D1d.
5. **Name the existing HEL-1430 swap guard.**
   - `PipelineDetailPage.outputSwap.test.tsx` ("opening Output B while Output A's editor is mounted reseeds...")
     exercises a param change while the sheet is open, the other path D1d rewrites.
   - List it as a reused deep-link case that must stay green unchanged across the D1d commit.
   - Under D1d it does not need its own new mutation unless the executor wants one.

### Non-blocking notes
- **Base verification (2.7) is workable.** The block is byte-identical on base and HEAD (verified), so the only
  base-sensitive risk is helper or harness drift in the test file.
  - A `git -C "$W" worktree add` of 744c37720 placed outside `frontend/`'s Jest roots, with
    `frontend/node_modules` symlinked, avoids haste-map duplicate-mock collisions.
  - Remove the scratch worktree by exact path afterwards, and record that it was removed.
  - The phrase "stash-free temp checkout" is vague. Prefer naming the worktree method.
- **Deep-link render count.** If one is recorded, the declared delta under CR1's gating is +1 body invocation and -1
  commit on the deep-link render only. Report both directions.
- **D3 (C7 byte-move of post-D1d code) is unaffected,** provided the D1d commit lands before the split, as tasks
  order it.
