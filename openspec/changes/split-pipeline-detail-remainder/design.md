## Context

See proposal.md (Why). Base: origin/main 744c37720 (HEL-1465 merged). Paths are relative to
`frontend/src/features/pipelines/hooks/`. `usePipelineDetailPage.ts` is 816 lines. React 19.2.8; the React Compiler is
lint-only here (`eslint-plugin-react-hooks`; `vite.config.ts` has no compiler plugin), so suppressions change no
runtime code. HEL-1465's archive (`openspec/changes/archive/2026-10-10-split-stepcard-pipeline-hook/`) and evidence
(`.concertino/runs/HEL-1465/evidence/`, incl. `scripts/`) are the methodology template.

Probe on base (L423 suppression deleted): 7 `react-hooks/refs` errors + 1 `exhaustive-deps` warning, which names
`steps.length` (not `steps`, as the ticket says). Sites: L109 `analyzeStatusRef.current =`, L129 `stepsRef.current =`,
L164 `sseActiveRef.current =`, L274 `skipNextAnalyzeRef.current = true` (inside the derived-state setState-during-render
block), L336 `pendingDraftMetaRef.current.has` (render-time READ in `stepsFingerprint`), L339
`stepsFingerprintRef.current =`, L500 `allOutputsRef.current =`. Repo precedent for "latest value" refs is to write them
in an effect (`useLaneReorder.ts` L56-63, `usePipelineRunEvents.ts` L81-83).

## Goals / Non-Goals

**Goals:** zero render-time ref access in the host, with no suppression masking it; debounced effect out of the host;
host remainder clusters extracted; every new file <= ~250 lines; observable behaviour (DOM, request counts, render
counts, handler identities, effect order) unchanged.
**Non-Goals:** `useStepCardState.ts`, `usePipelineStepStructure.ts` (follow-up ticket); host under 250 (state
declarations + return object remain; report the measured count); any intended behaviour change.

## Decisions

### D1 — Render-time ref accesses (item 1; one commit per sub-decision, AFTER the characterization commit)
Equivalence basis (revised, design gate r1 CR1). The page IS rendered inside transitions:
`main.tsx:62` `<BrowserRouter>` without `useTransitions`, and react-router 7.18.3 wraps every router state update in
`startTransition` (`chunk-YRTY65LJ.js:288-294`). So the host's mount render, and its re-render on `setSearchParams`
(~L536), can be transition renders that pause before commit or are discarded. A render-time write and a commit-time
write differ only when a render's mirrored value differs from the last committed value and that render does not commit
before a reader runs. The executor must prove, per mirrored value, that a transition render sees the committed value:
- `steps` and `sseActive` are local `useState` values never set inside a transition (grep every setter call site; none
  is in a `startTransition`, and a pending urgent update is processed before the transition lane).
- `analyzeStatus` and `allOutputs` come through `useAppSelector` (`useSyncExternalStore`), which re-renders synchronously
  on a store mismatch, so a transition render never commits or exposes a torn value.
- `stepsFingerprint` derives from `steps` and the D1c draft-id state.
Cover the discarded-mount-render case on the seed path (D1b). Task 1.2 records the router's `startTransition` use with
file:line in node_modules, not only a `src/` grep. If the argument fails for any value, that is a STOP.
**Reader inventory is mandatory**: for each ref, list every reader (file:line) and
classify it as event handler / timer / passive effect / layout effect / child ref callback / render. A reader in render, or in a layout effect
that could run before the new write (a child's, or an earlier hook's), is a STOP condition (escalate, do not adapt).

- **D1a mirror refs** (L109, L129, L164, L339, L500): move each write into `useLayoutEffect(() => { ref.current = v; })`
  (no deps array, so it runs on every commit like the render-time write) at the original site, in the original order.
  Alternative rejected: `useEffect` (repo precedent). A passive flush can lag a non-discrete (fetch-resolved) render, so a
  handler could read a stale `stepsRef`. Layout timing is the strict match.
- **D1b `skipNextAnalyzeRef`** (L274): a transition-keyed effect on `stepsInitialized` is NOT equivalent, because
  `usePipelineStepStructure.ts` L186 and `usePipelineStepCreation.ts` L136/L226 also set it true without setting the skip.
  Required shape: the seeding signal becomes state, set in the SAME derived-state block (batched into the same re-render,
  so no extra render). For example, a `seedToken` counter, consumed inside the debounced effect against a ref written
  only in that effect, on exactly the effect run the base flag was consumed. If the token joins the effect's deps,
  prove it changes only in the render where `stepsFingerprint` also changes (persisted steps are never pending drafts).
  Constraints: no extra render, no setState inside an effect, no new suppression.
- **D1c `pendingDraftMetaRef` render read** (L336): the fingerprint must exclude pending AI drafts without reading the
  ref in render. Preferred: a state mirror of the pending-draft id set, updated at EVERY mutation site of
  `pendingDraftMetaRef` (grep: `usePipelineStepCreation.ts` `.set` L152/L263/L370, `.delete` L318, plus any `.clear`)
  in the same synchronous batch as a re-render-causing setState that already exists there. Alternative: derive draft
  status from `steps` itself. Rejected: design gate r1 verified a `Step` carries no draft marker. Location (CR3): the
  mirror `useState` is declared in the host before `stepsFingerprint` (~L335). Its setter is passed through
  `usePipelineStepStructure`'s params into `usePipelineStepCreation`, alongside `pendingDraftMetaRef` (this grows the
  271-line file, which is accepted; the trim is deferred to the follow-up). All four sites (`.set` L152/L263/L370,
  `.delete` L318) were verified co-batched with a re-render-causing setState at design gate r1. STOP condition:
  a mutation site with no co-batched re-render means the base render-time read can observe a mutation that no state
  reflects, which is a behaviour difference. Escalate; do not force it.
- **D1 lint proof** (CR2, r2 CR2): after D1, deleting the L423 suppression yields a COMPLETE diagnostic list (ESLint
  `--format json`, recorded in full) of exactly one entry: the `exhaustive-deps` warning, byte-equal to base's, naming
  only `'steps.length'`. Nothing else of any rule. Any additional name
  (e.g. a seed token read but left out of deps) fails the proof, because the moved suppression would then hide it, which
  amounts to a new suppression. The red run is the same probe on base (7 errors). Base message:
  `.concertino/runs/HEL-1478/evidence/skeptic-design-1/lint-probe-base.json`.

### D1d — `?outputId=` deep-link effect (owner ruling 2026-10-10: `rewrite-deep-link`; escalation answered via chat)
Found at execution: with D1a-c in, deleting the L423 suppression exposed a second masked compiler error,
`react-hooks/set-state-in-effect` on the HEL-909 deep-link effect (post-D1c ~L551-565: `setOutputSheet({ output: target })`
inside `useEffect`). Probe: `.concertino/runs/HEL-1478/evidence/lint-probe-D1.txt`. It reproduces in a standalone file,
so items 2 and C7 cannot land without either this rewrite or a new suppression. A new suppression is forbidden (C1).
- **Shape (r4-revised).** Opening the sheet moves to the "adjust state during render" pattern, the same as the host's
  derived-state block. A `useState<{ searchParams; allOutputs } | null>(null)` holds the pair at which the sheet was
  last opened from a deep link. It MUST start at the `null` sentinel; `useState(currentPair)` would skip the open when
  Outputs are already in Redux at mount. At render, ONLY when `outputId` is present AND resolves in `allOutputs` AND
  the current (searchParams, allOutputs) pair differs by identity from the stored one: store the pair and call
  `setOutputSheet({ output: target })`. No state is set when there is no deep link, or while the id is unresolved, so
  no-deep-link renders (T3) gain no extra render pass.
  Trigger equivalence: base acts on every change of its deps where the id resolves. The new code acts on exactly those
  renders, because the stored pair is always an older pair. `searchParams` is memoised on `location.search`, and the
  selector returns the stored array or a fixed empty one, so an old identity never recurs.
  `setSearchParams` is NOT stable: react-router 7.18.3 builds it with `useCallback([navigate, searchParams])`, and
  `BrowserRouter`'s `navigate` depends on the pathname. It is deliberately left out of the render-time comparison. Its
  changes are a superset of `searchParams` changes plus pathname-only changes, and on a pathname-only change the base
  effect re-runs with an unchanged pair, where it either re-opens the same target (the param is still present only
  before the clear lands) or does nothing. The executor documents which, and if base can re-open there, it adds that
  case or STOPs.
  The param clear (`setSearchParams(..., { replace: true })`) stays in a `useEffect` with the same condition and deps as
  base. The full ESLint JSON must show that `react-hooks/set-state-in-effect` does not flag it.
- **Declared behaviour difference.** The sheet opens in the render that sees the param, not one commit later, so one
  intermediate commit with the sheet closed disappears. Nothing else may change.
- **Characterization, committed green BEFORE the D1d code commit, and verified green on base 744c37720 too.** Use a
  scratch `git -C <worktree> worktree add <scratchpad>/HEL-1478-base-check 744c37720` outside every `frontend/` Jest
  root, with `node_modules` symlinked; run only the new test file there; remove it by exact path with `git worktree
  remove`. Page-level cases, each with its own named red mutation, recorded and reverted:
  (i) `?outputId=<known>` opens the editor sheet for that Output (red: drop the open);
  (ii) the param is removed from the URL (red: drop the clear);
  (iii) close the sheet, then change `allOutputs` (an Output update or a refetch), and assert the sheet stays closed
  (red: drop the clear);
  (iv) a link that arrives before Outputs load opens once they load (red: evaluate only on `searchParams` change);
  (v) an unknown id opens nothing and leaves the param (red: clear unconditionally);
  (vi) Outputs already in Redux at mount, `listOutputs` held pending: the sheet opens (red: initialise the stored pair
  to the current pair instead of `null`).
  Reused, which must stay green unchanged: the HEL-1430 A-to-B URL swap test in
  `ui/PipelineDetailPage.outputSwap.test.tsx`. Tests must not assert the intermediate closed commit. T1-T4 stay green
  unchanged, T3's counts included (r4 probe: `.concertino/runs/HEL-1478/evidence/skeptic-design-4/`).
- **Lint proof (supersedes D1's).** After D1d, deleting the L423 suppression yields a complete ESLint JSON of exactly
  one entry, the base-equal `'steps.length'` warning. If yet another masked error appears, STOP and escalate again;
  do not stack fixes without a ruling.
- **Moves.** D1d's code is inside C7. C7 (D3) then moves the post-D1d code byte-identically.

### D2 — Move the debounced re-analyze effect (item 2; split commit)
New `usePipelineDebouncedAnalyze.ts`, called immediately after the `usePipelineAnalyzeDeferWatchdog` call (hook order
unchanged), taking `clearDeferWatchdog`/`forceDeferredAnalyze` and the refs/values it reads, and returning nothing.
`MAX_ANALYZE_DEFER_MS` and its comment move with it. The effect body is byte-identical to the post-D1 commit. Its
existing `// eslint-disable-next-line react-hooks/exhaustive-deps` moves UNCHANGED (HEL-1465 D2a precedent: a moved
suppression is not a new one). Fixing the `steps.length` dep was considered and rejected: adding `steps.length`
re-runs the effect when a pending draft is added, and replacing the guard with `stepsFingerprint === ""` diverges when
every step is a draft. Both are behaviour changes. Masking proof (CR2, r2 CR2): with the suppression deleted in
the new file, the file's complete ESLint JSON diagnostic list is exactly one entry, the base-equal `'steps.length'`
`exhaustive-deps` warning; recorded in full, then reverted.

### D3 — Host remainder (item 3; split commits; ranges are on 744c37720, so re-record exact post-D2 ranges)
Each cluster is contiguous and becomes one sub-hook called where the cluster began, taking a params object (refs as
objects, never `.current`) and returning the bindings later code reads:
- C5 `usePipelineRunStream` — the `usePipelineRunEvents` call with its inline `onTerminal` (~L223-260); returns
  `sseData`.
- C6 `usePipelinePageLoad` — `lastFetchedIdRef` + fetch effect, `sourcesRequestedRef` + sources effect,
  `retryPipelineLoad` (~L276-319). The derived-state block (~L262-275) stays in the host.
- C7 `usePipelineOutputSheets` — `outputsByStepId` through the `searchParams` effect (L490-544, re-measured at design gate r1), including the D1a
  `allOutputsRef` layout effect (ref passed in; it is declared earlier and read by C5).
- C8 `usePipelineSourceScheduleActions` — `handleEditSource`, `handleToggleScheduleEnabled` (L546-577). It may merge
  into C7 if the combined file is <= ~250.
- C9 `usePipelineRunAndSaveActions` — `refreshVisibleOutputPreviews` through `dismissCancelConfirm` (L647-719),
  incl. the `useRunToUpdate` call.
Stays in host: selectors and state, the derived-state block, `stepsFingerprint`, `laneGraph`, isDirty/beforeunload/
pipelineName/sourceByRootId/isOwner, the HEL-1465 sub-hook calls, the return object. Deps edits: only stable values
the linter now requires (refs, setters, `dispatch`, `navigate`/`setSearchParams` only if proven stable on base, each
traced to its declaration). Any non-stable demanded dep is a STOP. No `eslint-disable`.

### D4 — Proof
- **Characterization, committed GREEN ON BASE as the first commit; test files untouched afterwards** (each with a
  recorded red mutation, reverted):
  T1 identity: extend `usePipelineDetailPage.identity.test.tsx` to every handler C5-C9 returns (`retryPipelineLoad`,
  `handleOpenOutput`, `handleOpenOutputHistory`, `handleCloseOutputHistory`, `handleAddOutput`,
  `handleCloseOutputSheet`, `handleEditSource`, `handleToggleScheduleEnabled`, `handleRunPipeline`, `handleDryRun`,
  `handleRunToUpdate`, `confirmCancelDiscard`, `dismissCancelConfirm`) across an unrelated re-render. Exclude
  `handleSave`/`handleCancel` if the trigger changes `outputName`/`isDirty`. The mutation adds the value the trigger
  changes.
  T2 analyze dispatch (fake timers): page open with persisted steps gives exactly 1 `analyzePipeline` over >= 1s
  (F-105); a config edit gives exactly 1 more after 300ms; an edit during a run defers, then dispatches once when the
  run settles; a stuck guard force-dispatches at `MAX_ANALYZE_DEFER_MS`; adding a pending AI draft dispatches
  nothing, and completing it dispatches; F-105 variant with steps already in Redux at first render (seeding in the
  mounting render); a draft create failure (the `usePipelineStepCreation.ts` L370 restore). The L370 case states its
  timing regime and pins a per-phase count: e.g. a rejected create held past the 300ms debounce gives one analyze while
  in flight and one more after the failure restores the draft (assert each phase, not only a total).
  **Red-ability (design gate r2 CR1): one named red mutation per T2 case**, each recorded, then reverted. At minimum:
  delete host L274 (the F-105 case and its seed-at-mount variant go red); delete creation L370's meta restore (the L370
  case goes red); force the L375 defer guard false (the defer case goes red); remove the watchdog arm (the stuck-guard
  case goes red); drop the draft exclusion from `stepsFingerprint` (the draft case goes red); remove the debounce timer
  (the edit case goes red). A reused existing test gets its own mutation too. After D1c, re-run the L370 case with the
  mirror update at L370 omitted and record it red. Reuse existing tests where they already pin a case (cite file:test).
  T3 render count: host render count for T2's open + one edit is pinned (it guards D1b/D1c "no extra render").
  T4 run completion: a run (HTTP path) refreshes `previewOutput` for every loaded Output, and so does the SSE
  `onTerminal` path (L245-248) at page level, not only `usePipelineRunEvents.test.ts:236`. Both guard `allOutputsRef`.
  Scope of T1-T4 (CR6): they guard D1a; they cannot fail on a render-to-layout timing shift. D1a's proof is the reader
  inventory plus the D1 transition argument. T1-T4 are the proof for D1b/D1c and the splits.
- **D1 commits** are declared behaviour-adjacent: T1-T4 must stay green unchanged, and the D1 lint proof holds.
- **Split commits (D2, D3)**, proven against the post-D1 commit, not base: byte-move script with a red run;
  `--color-moved=zebra` diff with every non-moved line justified; the primitive hook sequence (sub-hooks inlined)
  equals the post-D1 sequence, with a red run swapping two hooks; a deps check (= post-D1 + whitelisted stable names)
  with a red run adding `steps`; `*.test.*` diffs import-only. Reuse/adapt `.concertino/runs/HEL-1465/evidence/scripts/` (add `useLayoutEffect` to `hooklib.py`'s deps extraction,
  which at L96 covers only useCallback/useMemo/useEffect).
- **Running app, base vs head, light + dark**: throwaway user, pipeline with >= 3 steps and one Output; outputs rail,
  output sheet opened via `?outputId=`, schedule bar, a completed dry run; screenshots plus an editor-region DOM
  snapshot diff. Network counts: `/analyze` on page open (expect 1) and after one edit (expect 1 more).
- All evidence goes under `/home/matt/Development/helio/.concertino/runs/HEL-1478/evidence/`. Playwright output stays
  there or in the worktree, never at the main checkout root.

### D5 — Fold-ins (own commit each), plus comments made false by D1/D2 (fixed in the commit that falsifies them)
Comments to fix (CR5): `usePipelineDetailPage.ts` ~L147-148 and ~L151 (render-time update wording);
`usePipelineStepCreation.ts:39`; `usePipelineStepMutations.ts:154` ("`stepsRef` (assigned in render)");
`usePipelineAnalyzeDeferWatchdog.ts:18-21` docblock. Grep for any other "during render"/"in render"/"every render"
claim about these refs.
`usePipelineAnalyzeDeferWatchdog.ts` L65 comment: "the debounce effect below" now names `usePipelineDebouncedAnalyze`
(comment-only diff). Spec scenario retitle: a direct edit of `openspec/specs/pipeline-analyze-schema-warnings/spec.md` L66
to `Lookup string match field against integer reference match field` (title line only; the body keeps the `sourceKey`/
`lookupKey` field identifiers). Delta rejected: openspec 1.10 refuses a MODIFIED block that drops the old scenario
title, so the change sets `skip_specs: true` and archives with `--skip-specs`.

## Risks / Trade-offs

- [D1 timing shift is observable in a path no test covers] → reader inventory + T1-T4 + full pipelines suite + e2e +
  running-app request counts; any STOP is escalated rather than adapted.
- [D1c touches `usePipelineStepCreation.ts` logic] → each added setState is co-batched (proven per site), and T3 pins
  render counts.
- [Moving an existing suppression reads as "new eslint-disable"] → stated explicitly; masking probe shows it hides
  nothing beyond `exhaustive-deps`.
- [Large PR] → items 4-5 deferred; split commits byte-proven; D1 isolated in its own commits.

## Migration Plan

None. Rollback = revert.

## Planner Notes

- Scope (self-approved per driver brief): items 1-3 + the two fold-ins. Items 4 (`useStepCardState.ts`) and 5
  (`usePipelineStepStructure.ts` trim) are filed as one follow-up ticket, cited in the PR body. Item 1 is a
  behaviour-adjacent change needing its own proof; adding a second file family would make review unwieldy.
- A STOP site is reported and filed as a follow-up ticket (AC1). The orchestrator files tickets; the executor returns
  the evidence.
- If D1 hits a STOP site: items 2-3 still need the host lint-clean, so the orchestrator decides (escalating to the
  owner if it is a product call) whether to ship D3's clusters that don't carry the blocked site, or to stop.
- tasks.md orders characterization tests FIRST, deviating from the "tests last" template rule, because the proof
  standard requires them green on base before any change.
- Models (driver): executor sonnet, evaluator/skeptic opus, auditor sonnet.
