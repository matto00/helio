## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 1b765f59d0d09d2d60d5c05f31a2e06083e3a105 (= origin/main base; the change dir is untracked planning artifacts only).

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/split-stepcard-pipeline-hook/HEL-1465`.
- **Sizes**: `wc -l` gives StepCard.tsx 508, usePipelineDetailPage.ts 1443, useStepCardState.ts 602, LookupConfig.tsx 144. These match design.md.
- **D2 contiguity (scrutiny a)**: I mapped every top-level statement of `usePipelineDetailPage.ts`.
  - C1 `clearDeferWatchdog` starts at L377. The debounce effect ends at L481. `laneGraph` (L372) and `stepsFingerprint`/`stepsFingerprintRef` (L361-368) come before it, so in-place extraction is order-safe.
  - C2 runs L511-638 (`analyzeByStepId` .. `getAnalyzeWarnings`, with the draft-fallback cleanup effect at L572 inside it). It is contiguous.
  - C3 runs L755-979 (comment, then `syncStepsFromServer` L770 .. `handleInstantiateShape` end). It is contiguous, about 210 lines.
  - C4 runs L980-1272 (`handleStepConfigChange` .. `handleDuplicateStep`, including `useInFlightGuard` at L1234). It is contiguous, about 293 lines, so the planned two-hook split is needed.
  - No primitive hook needs reordering. Later code reads C3/C4 outputs only through the return object (L1349-1442).
- **D2 dependency-array claim, refuted by measurement.** D2 says bodies stay byte-identical and "callback dependency arrays are unchanged byte-for-byte". In the base, refs (`useRef`) and state setters are local, so `react-hooks` treats them as stable and leaves them out of deps (`clearDeferWatchdog` `[]`, `syncStepsFromServer` `[id, dispatch]`, `hasDraftFallbackMeta` `[]`, `handleInstantiateShape` `[id, pushToast, roots]`, the L572 effect, and others). Once they arrive as sub-hook params, the linter no longer knows they are stable.
  - **Probe**: a minimal hook taking a ref param and a setter param with the base-style deps, linted with the worktree's own `eslint.config.cjs` via `--stdin-filename frontend/src/features/pipelines/hooks/zzProbe.ts`. Nothing was written to the worktree.
    - Result: `react-hooks/preserve-manual-memoization` **error** x2, plus `react-hooks/exhaustive-deps` warning x2, exit 1. Reproduced on a second run (exit 1).
    - Adding the ref/setter to the deps arrays lints clean under `--max-warnings=0` (exit 0).
    - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1465/evidence/skeptic-design-1/{probe.ts,probe2.ts,probe-lint-red.txt,probe2-lint-green.txt}`.
  - **Precedent**: the existing sibling extraction `hooks/usePipelineStepCreation.ts` already lists `stepsRef`/`setSteps` in deps (L109, L212, L376). This confirms that is how the repo resolves it.
  - Base lint of both target files is clean (exit 0). The split as designed would therefore fail the zero-warnings lint gate.
- **D1 DOM preservation (scrutiny b)**: I read StepCard.tsx in full.
  - The header subtree is L248-376 (the warning chip is nested in the toggle button, so it correctly stays in the header). The warnings region is L381-400 and the preview tray L473-503.
  - These are plain JSX subtrees with no hooks. Extracting them into prop-fed function components gives identical DOM.
  - Keeping `useId` in StepCard keeps the hook sequence `useState, useStepCardPreview, useStepCardState, useId`.
  - Line estimate after extraction: about 216 lines plus call sites, so roughly 250 lines. Tight but plausible.
  - Re-indentation is tolerated by the HEL-1399 `d3.py` method, which strips whitespace.
- **Scope bounding (scrutiny c)**: the Linear ticket itself says "The 1443-line hook may warrant its own ticket". HEL-1478 exists (Backlog, Follow-up, relatedTo HEL-1465) and names the remainder plus useStepCardState.ts. Estimated post-split size is about 790 lines, still over budget but explicitly filed. Acceptable.
- **D5 wording (scrutiny d)**: LookupConfig.tsx labels are "Match on field" (L83/85) and "Reference match field" (L95/102). AC5 dictates "match field" / "reference match field" literally. Not a product call, so no escalation.
  - The existing spec (`openspec/specs/pipeline-analyze-schema-warnings/spec.md` L52, L66-68, L160-165) only requires that messages "name both keys/types". The ADDED requirement does not conflict with it.
  - Grep finds no frontend/e2e/helio-mcp consumer of "source key '" / "lookup key '". The only hit is AnalyzeSchemaWarnings.scala:214.
- **D5 vs spec delta, internal contradiction found.**
  - The delta requirement says "**Every** analyze warning message emitted for a lookup step that names the step's `sourceKey` ... SHALL refer to [it] as the 'match field'".
  - The missing-input-side `sourceKey` warning comes from the generic reference pass (AnalyzeSchemaWarnings.scala L138-141). `missingMessage(step.op, fieldName, ...)` has `secondary=false`, so it renders `lookup: field 'customer_id' not found in this step's inferred input schema` (L247-251).
  - D5 changes only the type-mismatch message and the secondary-side missing message. The implementation would therefore violate its own spec delta. The delta also has no scenario for this message.
- **D4 (lookup id)**: LookupConfig is rendered as JSX (`StepOpEditor.tsx:296`), so adding `useId` there is rules-of-hooks-safe.
  - However, the input carries `aria-label="Reference match field"` as well as the `<label htmlFor>`. `getAllByLabelText("Reference match field")` would therefore return both inputs on the base too, through aria-label. That assertion cannot go red and proves nothing about label association.
- **Proof plan (scrutiny e)**: it mirrors HEL-1399 `d3.py` (whitespace-stripped range search with printed permitted-new gaps) and `d3b.py` (comment-stripped primitive hook sequence with sub-hooks inlined). It has red runs, import-only test diffs, and a running-app light/dark comparison.
  - Gap: d3b checks only the hook call sequence, not deps arrays. Given the finding above, deps arrays will change, and D3's "Expected: no characterization test needed" no longer holds under AC3's own rule ("characterization test ... for any non-verbatim restructuring").

### Verdict: REFUTE

### Change Requests

1. **D2 and D3: replace the false "dependency arrays byte-identical" claim with a decided, provable approach.**
   - State that every ref object, `useState` setter (`setSteps`, `setStepsInitialized`), and other base-stable value that becomes a sub-hook param is added to the deps arrays that read it. This follows the `usePipelineStepCreation.ts` precedent (L109/212/376).
   - Explicitly forbid `eslint-disable` for `react-hooks/preserve-manual-memoization` or `react-hooks/exhaustive-deps` as the workaround.
   - Justify identity preservation: the added values are referentially stable for the component's lifetime, so callback/memo/effect identity and firing are unchanged.
   - Update C1 in tasks.md (Standing Constraints) to permit exactly this class of deps-array edit, and keep forbidding every other edit.
2. **D3: prove the deps edits, don't just assert them.**
   - (a) Extend the byte-move script, or add a sibling check, so each `useCallback`/`useMemo`/`useEffect` deps array in the branch equals the base array plus only names from a declared stable-value whitelist (the `useRef` results and setters). Print each delta, and add a red run (add a non-stable name, e.g. `steps`, and the check must fail).
   - (b) Per AC3's own rule, commit on the base first a green characterization test that pins F-146 identity stability. For example: render `PipelineDetailPage` with two steps, edit one step's config, and assert the handlers passed to the other `StepCard` (`onConfigChange`, `onRemove`, `onToggleEnabled`, `onDuplicate`, `getAnalyze*`-derived props) keep the same references, or that the untouched StepCard does not re-render.
   - Show it red under a mutation that adds a non-stable dep (e.g. `steps`) to one handler, then green on the split head.
   - Remove the "Expected: none needed" sentence.
3. **D2: pin the cluster boundaries so the plan cannot be read two ways.**
   - C1: does it end at the debounce effect (L481), or include the `clearRunState` unmount effect (L483-491)?
   - C2: "~L511-658 ... and the effect after it" would pull in `isDirty` (L640), the `beforeunload` effect (L642-650), and `pipelineName` (L652), none of which are analyze code, into a hook named `usePipelineAnalyzeLookups`. Pin C2 to end at `getAnalyzeWarnings` (L638), or rename and justify.
   - Moving code within a range does not change behaviour, but cohesion should be decided at planning, not left to the executor.
4. **Reconcile D5 with the spec delta's "every message" requirement.**
   - Either extend D5 so the generic input-side missing message for a lookup's `sourceKey` uses `match field '<f>'` (e.g. when `op == "lookup" && field == cfg.sourceKey`), and add a delta scenario plus a red spec assertion for it.
   - Or narrow the ADDED requirement's wording to the two messages D5 actually changes, and state that the generic `field '<f>'` message is unchanged.
   - Either is acceptable. The artifacts must agree.
5. **D4 test: make the label-association assertion discriminating.**
   - `getAllByLabelText("Reference match field")` passes on the base through the input's `aria-label`. Instead, assert for each card that its `<label>` element's `htmlFor` resolves (`document.getElementById(label.htmlFor)` or `label.control`) to the input inside that same card.
   - Keep the distinct-id and single-occurrence assertions, which are what go red on the base.

### Non-blocking notes

- StepCard.tsx after D1 is estimated at about 250 lines. If it lands at around 270, the executor should say so rather than add a fifth seam.
- When C3 moves the `usePipelineStepCreation` call into the new sub-hook, the inlined hook-sequence script must treat it as a nested custom hook, which d3b's regex already counts. Make sure the base and branch sequences inline it the same way.
- The remaining "secondary input" phrasing differs from the card's "Reference source" label. It is correctly out of scope per the ticket, and worth adding to HEL-1478 or a copy follow-up.
