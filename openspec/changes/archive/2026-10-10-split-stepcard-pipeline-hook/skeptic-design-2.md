## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 1b765f59d0d09d2d60d5c05f31a2e06083e3a105 (= origin/main base). The change dir is still untracked planning artifacts only.

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/split-stepcard-pipeline-hook/HEL-1465`.

#### Round-1 CR1 (deps-array policy): addressed in substance

- D2 now has a "Dependency arrays" paragraph that does four things:
  - It adds exactly the stable values the linter requires (ref objects, `useState` setters, `dispatch`, each traced to its base declaration).
  - It forbids `eslint-disable`.
  - It justifies identity preservation: these values never change identity.
  - It makes a non-stable demanded dep a stop-and-escalate condition, which is the right call, because such a dep would mean a stale closure the split would silently "fix".
- tasks.md C1 and C4 permit exactly this class of edit and forbid everything else.
- I checked this against the code.
  - `hasDraftFallbackMeta` has deps `[]` and reads `pendingDraftMetaRef`/`draftFallbackMetaRef` (L563-567).
  - `clearDeferWatchdog` has deps `[]` (L377-383).
  - `syncStepsFromServer` has deps `[id, dispatch]` (L784).
  - All of these are exactly the cases that need stable-value additions.
- The precedent holds: `usePipelineStepCreation.ts` lists `[setSteps]` (L109), `[handleInsertStep, stepsRef]` (L212), and `[id, stepsRef, applyCreated, pendingDraftMetaRef, draftFallbackMetaRef]` (L376).

#### Round-1 CR2 (prove the deps edits): addressed

- D3 adds a deps-check script. It passes only when the branch array is the base array plus whitelisted stable names, each traced to its base declaration. It has a red run (add `steps` -> FAIL). This is task 4.4.
- D3 also adds a mandatory F-146 identity characterization test.
  - It is committed GREEN ON BASE as its own first commit (task 1.2), red under a non-stable-dep mutation, and green on the head (task 4.5).
  - The "Expected: none needed" sentence is gone.
- The test is feasible.
  - The hook returns `setOutputName` and every C2/C3/C4 handler and getter (return object L1349-1442).
  - A `PipelineDetailPage.*.test.tsx` store/router harness already exists (`PipelineDetailPage.test.tsx`, `.draftCreate`, `.reorderGuard`, ...).
  - On base, none of the listed getters or handlers depends on `outputName`, so "stable across an `outputName` change" is true on base.

#### Round-1 CR3 (pin the cluster boundaries): addressed

- C1 explicitly ends at the debounce effect (L404-480) and excludes the `clearRunState` effect (L483-491).
- C2 explicitly ends at `getAnalyzeWarnings` (L635-638). `isDirty` (L640), the `beforeunload` effect (L642-650) and `pipelineName` (L652) stay in the host.
- I re-mapped C3 and C4 as well.
  - C3 runs from `syncStepsFromServer` (L770) through `handleInstantiateShape` (deps at L969).
  - C4 runs from the F-146 comment and `handleStepConfigChange` (L971/980) through `handleDuplicateStep` (L1256), including `useInFlightGuard` (L1234-1235).
  - Both are contiguous. Later code reads them only through the return object.

#### Round-1 CR4 (D5 vs spec "every message"): addressed with the stronger option

- D5 now also renders `match field '<f>'` for the input-side missing message when `op == "lookup"`.
- I verified this is exhaustive in `AnalyzeSchemaWarnings.scala`:
  - `referencedFields("lookup")` is `Vector(sourceKey)` (L287), so the generic input-side pass (L138-141) only ever names `sourceKey` for a lookup.
  - The secondary-side missing message names only `lookupKey` (L210-211).
  - The type-mismatch message is L222.
  - `missingMessage` (L247-251) is the single place to branch.
  - `lookupRenames` uses `renameMessage`, which names neither key, so it is correctly untouched.
- The new delta scenario "Missing match field names the editor's label" exists. Task 6.2 covers all three lookup messages plus the unchanged join message, with a red run on base wording.
- There is one existing spec assertion that the change will touch: `AnalyzeSchemaWarningsSpec.scala:429` asserts `include("key 'cust_id'")`.
  - The new text `"reference match field 'cust_id'"` contains `field 'cust_id'`, not `key 'cust_id'`.
  - So L429 will go red and must be updated. Task 6.1's grep finds it, so it is planned for.
- I found no frontend, e2e or helio-mcp consumer of the message text. helio-mcp mentions "lookup keys" only in tool descriptions of the warning *code*, not the message.

#### Round-1 CR5 (D4 test discriminates): addressed

- D4 and task 5.1 now assert, per card, that the `<label>`'s `htmlFor` resolves via `getElementById` to that card's own input. They explicitly reject `getAllByLabelText` because of the `aria-label` at `LookupConfig.tsx:102`.
- The distinct-id and single-occurrence assertions are kept, and both go red on base, where `id="lookup-key"` is hardcoded at L94 and L98.
- `TextField` spreads `...rest` onto `<input>` (`shared/ui/TextField.tsx:15,21`), so a `useId` value reaches the DOM.

#### Fresh review

- Scope: AC1-AC5 each map to tasks (2.x, 3.x, 4.x, 5.x, 6.x, 7.2). AC2's remainder is filed as HEL-1478 (`FOLLOWUPS_FILED`).
- No API or schema contract change: warning `code`s are unchanged and only the message text changes.
- Product-copy call: AC5 dictates the terms ("match field" / "reference match field") literally, and they are the lowercase forms of the existing labels at `LookupConfig.tsx:83` and L95. No escalation is needed.
- Placeholders: none blocking. The "executor states which" choice in D1 (where the warning guard lives) is DOM-neutral either way, and it is required to be stated.

### Verdict: CONFIRM

### Non-blocking notes

1. **Fix one stale sentence.** The design.md Risks bullet still says "deps arrays byte-identical". That is the exact claim round 1 refuted, and it now contradicts D2's dependency-array decision and constraints C1/C4. Decisions and constraints govern, so this is not blocking, but the sentence should be edited to "deps arrays = base + whitelisted stable names (deps check)" so the executor isn't handed a contradiction.
2. **Keep the existing `eslint-disable` in the C1 effect.** The debounce effect already has `// eslint-disable-next-line react-hooks/exhaustive-deps` at L471 (it deliberately omits `steps`). D2's "eslint-disable FORBIDDEN" means *no new* disables:
   - This existing one moves verbatim with the byte-identical body.
   - It must NOT be removed. Removing it would require adding `steps`, which is a behaviour change.
   - Because it suppresses exhaustive-deps for that effect, the effect's deps array should show zero additions in the deps check.
   - Please say so explicitly in execution notes.
3. **Pair the characterization test's mutation with its trigger.** D3 says the trigger is "e.g. output name changes" and the mutation "e.g. `steps` or `outputName`". The mutation must be the same value the test changes, or it cannot go red. If the trigger is `setOutputName`, mutate with `outputName`. The mandatory red run self-corrects this, but don't waste a cycle on it.
   - Stronger option: also add a variant that edits one step's config (`steps` changes), the actual F-146 scenario, and asserts identity for the C4 handlers only.
   - That variant must exclude `getAnalyzeColumns`/`getAnalyzeSchema`: they legitimately depend on `steps` on base via `getDraftFallbackSchema` (deps `[steps, analyzeByStepId, sourceSchemaForRoot]`, L561).
4. **D4 test.** `CSS.escape` may not exist under jsdom (the repo has no test usage of it). `document.querySelectorAll('[id="' + id + '"]')` or a `getElementById` plus a count over `querySelectorAll('[id]')` avoids that.
5. **Old phrase in the existing spec.** The existing spec's scenario title at `openspec/specs/pipeline-analyze-schema-warnings/spec.md:66` ("Lookup string source key against integer lookup key") keeps the old phrase. It is only a title, so it doesn't conflict with the ADDED requirement. Optionally rename it at archive time.
6. Carried from round 1: if StepCard.tsx lands around 260-270 lines, state it rather than inventing a fifth seam.
