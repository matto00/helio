## Context

See proposal.md (Why). Base: origin/main 1b765f59d. Sizes on base: `ui/StepCard.tsx` 508, `hooks/usePipelineDetailPage.ts` 1443, `hooks/useStepCardState.ts` 602 (not named by the ticket). Paths below are relative to `frontend/src/features/pipelines/`.

`StepCard` is a `React.memo` component (F-146) whose hook sequence is `useState(expanded)`, `useStepCardPreview`, `useStepCardState`, `useId`. `usePipelineDetailPage` is one ~1250-line hook body whose refs (`stepsRef`, `pendingDraftMetaRef`, `draftFallbackMetaRef`, `skipNextAnalyzeRef`, `pendingAnalyzeRef`, `analyzeStatusRef`, `sseActiveRef`, ...) are declared at the top and read by later clusters; every `useCallback`/`useMemo` identity matters to `StepCard`'s memo (F-146).

The lookup "Reference match field" input is `id="lookup-key"` in `ui/stepConfigs/LookupConfig.tsx`; the lookup warning text is built in `backend/src/main/scala/com/helio/domain/engine/AnalyzeSchemaWarnings.scala` (`lookupKeyWarnings` type-mismatch message; `missingMessage`'s `key '<f>'` wording for a secondary-side field, shared with `join`).

Proof precedent: HEL-1399's evidence (`.concertino/runs/HEL-1399/evidence/d3.py`, `d3b.py`, `D3-byte-identity.txt`, `D3b-hook-sequence.txt`) — byte-identity of moved regions with only whitelisted new import lines, and a comment-stripped primitive-hook-sequence comparison with sub-hooks inlined at their call sites.

## Goals / Non-Goals

**Goals:**
- `StepCard.tsx` <= ~250 lines; every new StepCard module <= ~250.
- `usePipelineDetailPage.ts` reduced by extracting four contiguous clusters (below); every new sub-hook file <= ~250 (a cluster over that is split into two consecutive sub-hooks).
- Rendered DOM, hook primitive sequence, callback identities and effect ordering unchanged.
- Unique per-step lookup input id; lookup warning copy aligned to the card labels.

**Non-Goals:**
- Getting `usePipelineDetailPage.ts` under 250 in this PR. The remainder (pipeline load + SSE wiring at the top, outputs/output-sheet/search-param handlers, source edit + schedule toggle, run/dry-run/save/cancel) and `useStepCardState.ts` (602) are filed as HEL-1478 (cite in the PR body).
- Any change to warning `code`s, join warning copy, or "secondary input" wording beyond the two key terms the ticket names.
- Any behaviour change inside the split commits.

## Decisions

### D1 — StepCard seams (verbatim moves)
- `ui/stepCardTypes.ts` (or `StepCard.types.ts`): the `StepCardProps` interface moved verbatim (with its doc comments), exported.
- `ui/StepCardHeader.tsx`: the header `<div className="pipeline-detail-page__step-card-header">…</div>` subtree (toggle button with draft/error/warning/count chips + actions cluster) moved verbatim as a component receiving exactly the values it reads as props. This is the PR #905 "indicators" seam; the warning chip stays inside the header because it is a child of the toggle button (moving it out would change DOM).
- `ui/StepCardWarnings.tsx`: the "Check before running" region moved verbatim, rendered at the same position. The `useId()` for `warningsHeadingId` STAYS in `StepCard` (passed as a prop) so `StepCard`'s primitive hook sequence is unchanged; `StepCardWarnings` calls no hooks. Called only under the same `expanded && warningCount > 0` guard, or the guard moves inside the component — either way the DOM is identical; the executor states which.
- `ui/StepCardPreviewTray.tsx`: the `previewOpen && step.enabled` preview tray subtree moved verbatim.
- `moveUpLabel`/`moveDownLabel`/`warningCount` computations may move into the component that reads them only if they call no hooks.
Rationale: JSX subtree extraction with props is the HEL-1365/1399 pattern; `React.memo` stays on `StepCard` only, the new children are plain function components (their props change whenever StepCard re-renders anyway, so memoizing them buys nothing and would be a behaviour-adjacent change).

### D2 — usePipelineDetailPage seams (sub-hooks called in place)
Each cluster becomes `hooks/<name>.ts` exporting one hook, called at exactly the line where the cluster began, taking the outer values it reads as one params object and returning the bindings later code reads. Bodies are byte-identical except the destructured params header, the return object, and the stable-value deps additions described below (each on its own diff hunk and enumerated in the proof). Clusters (base line ranges approximate; the executor records the exact ranges):
- C1 `usePipelineAnalyzeScheduler` — `clearDeferWatchdog` (~L377) through the end of the analyze-trigger effect that precedes the "Clear run state when navigating" comment (~L481). The `clearRunState`/`resetRunScopedState` unmount effect (~L483–491) is NOT in C1; it stays in the host.
- C2 `usePipelineAnalyzeLookups` — from the "Per-step analyze columns / schema" comment / `analyzeByStepId` (~L493–511) through `getAnalyzeWarnings` (~L638), inclusive of the `useEffect` at ~L572 inside that range. It ENDS at `getAnalyzeWarnings`: `isDirty`, the `beforeunload` effect and `pipelineName` (~L640–652) stay in the host. This is PR #905's "analyze selectors into their own hook" seam.
- C3 `usePipelineStepStructure` — `syncStepsFromServer`, the `usePipelineStepCreation` call, `handleAddOutputViaAggregateTail`, `handleInstantiateShape` (~L770–979).
- C4 `usePipelineStepMutations` (split into two consecutive hooks if > ~250, e.g. config/remove/reorder and roots/toggle/duplicate) — `handleStepConfigChange` … `handleDuplicateStep` incl. the `useInFlightGuard` call (~L980–1273).
Refs are passed as the ref objects themselves (never `.current` snapshots), so every read happens at the same time as before.

**Dependency arrays (design-gate R1 finding).** In the base, refs (`useRef` results) and state setters are local to the hook, so `react-hooks/exhaustive-deps` / `react-hooks/preserve-manual-memoization` know they are stable and they are (correctly) omitted from deps. Once they arrive as sub-hook params the linter cannot know that, and the repo's zero-warnings lint fails (probe: `.concertino/runs/HEL-1465/evidence/skeptic-design-1/`). Decision: in each extracted `useCallback`/`useMemo`/`useEffect`, add exactly the stable values (ref objects, `useState` setters, `dispatch`, and other values proven referentially stable on base — each such name listed with its base declaration) that the linter now requires, and nothing else. This is the established pattern (`usePipelineStepCreation.ts` already lists `stepsRef`/`setSteps` in deps). Because those values never change identity, adding them changes no callback/memo identity and no effect firing. `eslint-disable` comments are FORBIDDEN as a workaround. Any dep the linter demands that is NOT provably stable is a stop-and-escalate condition (it would mean the base had a stale-closure the split would "fix", i.e. a behaviour change).
Alternative rejected: a context/reducer restructure — not behaviour-preserving, not reviewable.

### D2a — Notes from design gate round 2
- The existing `// eslint-disable-next-line react-hooks/exhaustive-deps` in C1 (~L471, deliberately omitting `steps`) moves UNCHANGED with its effect; it must not be removed (removing it would force `steps` into deps — a behaviour change). The "no eslint-disable" rule forbids only NEW disables.
- The characterization test's red mutation must add the same value the test changes (if the test re-renders by changing `outputName`, the mutation adds `outputName`). `getAnalyzeColumns`/`getAnalyzeSchema` legitimately change identity when `steps` changes on base (~L561); exclude them from any steps-edit variant.
- D4 test: use an `[id="..."]` attribute selector rather than `CSS.escape` (may be absent in jsdom).
- If `StepCard.tsx` lands ~260–270 lines, state it rather than adding a fifth module.

### D2b — C1 narrowed (found at implementation; verified by probe)
The base host carries `// eslint-disable-next-line react-hooks/exhaustive-deps` (the debounced re-analyze effect). A hooks-lint suppression makes the React Compiler lint skip the whole function, which MASKS its `react-hooks/refs` errors on the host's pre-existing render-time ref writes (`stepsRef.current = steps` etc., 7 sites). Moving that effect (and its suppression) out of the host exposed those 7 errors on the host (probe: host with C1 as designed -> 7x `react-hooks/refs`; with the effect kept in the host -> 0). Fixing them is a behaviour change and a new disable is forbidden (C1/C4), so C1 is narrowed: `usePipelineAnalyzeDeferWatchdog` takes `clearDeferWatchdog`, `forceDeferredAnalyze` and the unmount cleanup (base L373-403) and the debounced effect STAYS in the host, byte-identical, with its existing suppression, right after the call (hook order unchanged). `MAX_ANALYZE_DEFER_MS` stays with it. HEL-1478 (remainder) should take the render-time ref writes as its first item.

### D3 — Proof (per commit group)
- Byte-move script (HEL-1399 `d3.py` pattern) over every moved region: sha256 of base region == branch region after removing only the whitelisted new lines (imports, params destructuring header, return object, component signature). Red run: a deliberate one-character edit in a moved region makes the script report DIFFERENT; reverted.
- `git diff --color-moved=zebra` output saved; every non-moved added line listed and justified.
- Hook sequence script (HEL-1399 `d3b.py` pattern): comment-stripped primitive hook sequence of base `StepCard` and base `usePipelineDetailPage` equals the branch's with sub-hooks inlined at call sites; red run by swapping two hook lines.
- Split commits change test files import-only (`git diff` of `*.test.*` in those commits shows only import lines).
- Deps check: a script compares every extracted hook call's deps array on the branch with the base array, passing only when branch = base + names from the whitelisted stable set (each whitelisted name traced to a `useRef`/`useState` setter/`useAppDispatch` declaration on base). Red run: add a non-stable dep (e.g. `steps`) to one array -> FAIL; reverted -> PASS.
- Characterization (required, since the deps edits are non-verbatim): a test committed GREEN ON BASE FIRST (its own commit, before any split commit) that pins F-146 identity stability across an unrelated re-render — e.g. `renderHook(usePipelineDetailPage)` (with the repo's existing store/router test harness) asserting that the returned handlers/getters from every extracted cluster (`getAnalyzeColumns`, `getAnalyzeWarnings`, `handleStepConfigChange`, `handleRemoveStep`, `handleReorderSteps`, `handleToggleStepEnabled`, `handleDuplicateStep`, `handleInstantiateShape`, ...) keep the same identity when an unrelated value (e.g. output name) changes, or equivalently that an untouched `StepCard` does not re-render. Shown red under a mutation that adds a non-stable dep (e.g. `steps` or `outputName`) to one of those callbacks, reverted, then green on base and on the branch.
- Running app before/after (base vs branch, light and dark): a throwaway user's pipeline with join, lookup, aggregate and compute steps, at least one step showing warnings expanded, a step preview open, two lookup steps expanded. Screenshots + DOM snapshot of the editor region diffed. Screenshots go to `.concertino/runs/HEL-1465/evidence/` in the main checkout.

### D4 — Unique lookup id (separate commit, after the split)
`LookupConfig` derives `const lookupKeyId = useId();` and uses it for both `htmlFor` and the `TextField` `id` (React `useId` is the repo's existing pattern, e.g. `StepCard`'s `warningsHeadingId`). Test: render two `LookupConfig`s (or two lookup StepCards expanded), assert the two inputs' ids differ, `document.querySelectorAll('#'+CSS.escape(id))` has length 1 for each, and that each card's `<label>` element with text "Reference match field" has an `htmlFor` that resolves (via `document.getElementById`) to THAT card's own input (scope with `within(card)`). Note: the input also carries `aria-label="Reference match field"`, so `getAllByLabelText` passes on base and is not a valid red; the distinct-id, single-occurrence and per-card `htmlFor` assertions are the ones shown red on base (ids equal) before the fix.

### D5 — Lookup warning wording (separate commit)
Type mismatch: `lookup: match field '<sourceKey>' is <t> on the input but reference match field '<lookupKey>' is <t> on the secondary input; values of different types never match, so no row will find a match (types are from the inferred schemas)`.
Missing keys: `missingMessage` renders, for `op == "lookup"`, `reference match field '<f>'` when `secondary` (the `lookupKey`, from `lookupKeyWarnings`) and `match field '<f>'` when not (the input-side pass at ~L138–141, whose only lookup reference is `sourceKey` per `referencedFields` ~L287). The `join` branch keeps `key '<f>'` and every other op keeps `field '<f>'`, byte-identical. Terms are lowercase forms of the card labels "Match on field"/"Reference match field" (ticket item 3); the remaining "secondary input" phrasing is out of scope. Grep frontend, helio-mcp, e2e and backend tests for the old phrases and update assertions; `AnalyzeSchemaWarningsSpec` gets assertions that the new phrases appear and "source key"/"lookup key" do not (red on base).

## Risks / Trade-offs

- [Hook extraction changes a closure's captured value] → params are the same bindings captured at the same render; refs passed as objects; deps arrays equal base plus only provably-stable additions (deps-check script); hook-sequence script + full pipelines test suite + running-app comparison.
- [Large diff hard to review] → moves are byte-proven; the remainder is filed rather than crammed in.
- [Copy change breaks an agent's string match] → warning `code`s are the machine contract and are unchanged; grep for consumers of the old phrases.

## Migration Plan

None (no data/API change). Rollback = revert.

## Open Questions

None blocking. Remainder filed as HEL-1478.
