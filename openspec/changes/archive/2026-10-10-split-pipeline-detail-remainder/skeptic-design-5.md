## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Amendment gate: D1d (`?outputId=` deep-link rewrite) and tasks 2.7/2.8, revised after round 4 REFUTE. The revisions are the
uncommitted diff to design.md/tasks.md. I judged them against the live code at branch head
`5262a7ae106a1baf381d297bf80677b8fdf2016f` and react-router 7.18.3.

### What I verified (with evidence)
- **Spawn guard:** `READY ambient=/home/matt/Development/helio branch=task/split-pipeline-detail-hooks/HEL-1478`.
  HEAD is 5262a7ae1, and `git status` shows only design.md/tasks.md modified plus the untracked skeptic-design-4.md.
- **Live base block:** usePipelineDetailPage.ts L550-565. One `useEffect([searchParams, allOutputs, setSearchParams])`
  returns early when there is no param or the id is unresolved. Otherwise it calls `setOutputSheet({ output: target })`
  and clears the param with `replace: true`, in the same run.
- **RR 7.18.3 facts, re-read myself** in `node_modules/react-router/dist/development/chunk-BV7QT456.mjs`:
  - `searchParams` is `useMemo(..., [location.search])` (L10946).
  - `setSearchParams` is `useCallback(..., [navigate, searchParams])` (L10957).
  - `useNavigateUnstable` deps include `locationPathname` (L6039-6044).
- **CR1 (state only when acting): met.**
  - D1d now says that ONLY when `outputId` is present AND resolves AND the pair differs by identity, it stores the pair
    and opens. No state is set without a deep link or while the id is unresolved.
  - So T3 (no deep link) gets no extra body invocation. Tasks 2.8 matches: "set only when the id resolves and the pair
    changed ... T1-T4 (T3 counts) green, tests untouched".
- **CR2 (`setSearchParams` instability): met.** The false "stable (verify)" premise is gone. The text states the real
  `useCallback` deps and the pathname dependency, and why the value is left out of the comparison. The clear-effect
  keeps base deps.
- **CR3 (null sentinel + case vi): met.**
  - The design requires `useState<...|null>(null)` and explicitly forbids `useState(currentPair)`.
  - Case (vi): Outputs are in Redux at mount, `listOutputs` is held pending, and the sheet opens. Its red mutation is
    "initialise to the current pair".
  - The mutation is genuinely red. Under it the mount render compares equal and never opens. The clear-effect then
    removes the param, so no later render can open either.
- **CR4 (case iii red-able): met.** The case now reads: close, then change `allOutputs`, and assert the sheet stays
  closed (red: drop the clear).
  - Without the clear, the param stays. On base, the effect re-runs on the new `allOutputs` and reopens.
  - Under D1d, the new pair differs from the stored one, the id resolves, and it reopens.
  - So the mutation is red on both implementations.
- **CR5 (outputSwap reused): met.** `ui/PipelineDetailPage.outputSwap.test.tsx` exists. It mounts
  `/pipelines/pipe-1?outputId=out-a` (L141) and swaps via a `<Link>` to `?outputId=out-b` (L145, test at L204). It is
  named in D1d as a reused case that must stay green unchanged.
- **Trigger-equivalence argument ("store only when acting"): sound.**
  - Base acts exactly on effect runs where deps changed and the id resolves. D1d acts on renders where the pair differs
    from the last acted-on pair and the id resolves.
  - These coincide if no acted-on pair identity can recur. An acted-on `searchParams` identity cannot recur: every act
    is followed by the clear, which changes `location.search`, and `useMemo` gives a fresh object on any later return
    to the same string.
  - The claim "an old identity never recurs" is slightly over-broad for `allOutputs`. `EMPTY_OUTPUTS`
    (outputsSlice.ts:375) is a recurring fixed identity, but no id resolves against it, so it can never be part of a
    stored pair. Not material.
  - Pair changes while unresolved store nothing, so the later resolving render still compares against an older pair
    and acts. That is case (iv), with a red mutation.
  - An `allOutputs` change in the window before the clear lands re-opens in both base and D1d. This is equivalent.
- **Pathname-only clause: acceptable.**
  - Base can only re-act on a pathname-only `setSearchParams` identity change if the param is still present and
    resolving at that effect run. But base's own prior run at the same pair already opened and issued the clear in one
    effect, so this is limited to a navigation landing between the clear call and its commit.
  - Changing pipeline `id` also changes `allOutputs`, so that path is not pathname-only.
  - D1d tells the executor to document which outcome applies and to add a case or STOP if base can re-open. That is
    bounded, with an escalate-not-adapt fail-safe consistent with C3. It is not a blocking hand-wave.
- **Render-phase setState pattern is lint-attainable.** The host already uses conditional render-phase setState with
  no findings (L274-291, derived-state block). The lint proof is still gated on the complete ESLint JSON (2.8).

### Verdict: CONFIRM

### Non-blocking notes
- Tighten the wording of "an old identity never recurs". `EMPTY_OUTPUTS` does recur, but it can never resolve an id,
  so it is never stored. The executor may say so in the code comment.
- In 2.7, "outputSwap test reused unchanged, each with a named red mutation" reads as if the reused test needs a new
  mutation. D1d is authoritative: only cases (i)-(vi) need named red mutations, and the swap test only has to stay
  green unchanged.
- When the outputSwap test runs under `MemoryRouter`, `useNavigate` is also the non-data-router variant, so the same
  `setSearchParams` identity facts hold there.
