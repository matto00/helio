## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Scope: the fold-in (ticket items 3-4, design D6/D7, tasks 6-8, ticket.md/proposal.md updates). Items 1-2
were CONFIRMed in skeptic-design-2.md. Reviewed at HEAD `c22e62acf156b3a3b30abcf19344dfeac0b65c09`
(SPLIT_BASE `a29a7e5ce`), with the plan edits still uncommitted in the worktree.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/split-step-card-state/HEL-1481`.
- **Ticket fold-in is real.** In Linear, HEL-1481 `updatedAt` is `2026-10-11T04:31:11Z`. Its description has
  items 3 (`usePipelineStepCreation.ts` is 405 lines, split it) and 4 (five comment sites, fix them in one
  comment-only commit). ticket.md matches. proposal.md adds both items and the HEL-1483 non-goal.
- **D6 premise (base file).** `git diff --stat a29a7e5ce HEAD -- usePipelineStepCreation.ts` is empty. I read
  the base file in full (`git show a29a7e5ce:...`).
  - It is 405 lines.
  - Hook sequence matches D6 exactly: useRef L66, useState L70 and L75, useCallback L76, useRef L88 and L91,
    then 8 useCallbacks at L92/97/118/122/143/220/235/322.
  - Ranges are right. `handleAddLaneStep` with its comment is L227-318. `createDraftIfComplete` with its
    comment is L320-393. Together they are the contiguous tail before the return at L395.
- **D6 deps claims (traced by hand, then confirmed by lint).**
  - `handleAddLaneStep` reads these outer bindings: `id`, `setStepsInitialized`, `stepsRef`, `setSteps`,
    `pendingDraftMetaRef`, `syncPendingDraftIds`, `markCreating`, `applyCreated`, `pushToast` (plus module
    imports). That is exactly its 9-entry deps list, so the claim holds.
  - `createDraftIfComplete` reads its 6 listed deps plus `creatingDraftIdsRef` (L329/331/389) and
    `setDraftCreateErrors` (L376/382), and nothing else. The claim holds.
- **D6 lint probe (scratch copy only).** I copied the frontend, root `eslint.config.cjs` and prettier config to
  `.concertino/runs/HEL-1481/evidence/skeptic-design-3/scratch/`. The script is `../split_probe.py`. It does
  D6 literally: verbatim tail moves, sub-hooks called in place one after the other, `PendingDraftMeta`
  imported type-only from the host.
  - The unmodified base file lints clean in the scratch setup (rc=0, 17 `react-hooks/*` rules active).
  - Split with base deps: M6 is **clean**. M7 reports exactly
    `react-hooks/preserve-manual-memoization` x2 (inferred `creatingDraftIdsRef` and `setDraftCreateErrors`)
    and `exhaustive-deps` "missing dependencies: 'creatingDraftIdsRef' and 'setDraftCreateErrors'". The host
    reports only unused imports that move with the code (`updatePipelineStep`, `isCompleteAiStepConfig`,
    `PipelineStepConfig`).
  - After adding the two names and pruning those imports: `eslint --max-warnings=0` on all 3 files gives rc=0,
    and `tsc --noEmit` gives rc=0. **No hidden lint error. No suppression is needed.**
  - Sizes: host 263, M6 129, M7 109.
  - After prettier, M6's moved region is byte-identical to base L227-318 (`diff` reports nothing). M7 differs
    from base only on the deps-array lines.
- **D6 characterization (identity test).**
  - `usePipelineStepMutations.ts:54` deps are `[clearDraftCreateError, createDraftIfComplete, setSteps]`.
    `handleStepConfigChange` and `handleAddLaneStep` are both in `STEP_INDEPENDENT_KEYS`. So pinning
    `createDraftIfComplete` transitively is real.
  - On the scratch split, `usePipelineDetailPage.identity.test.tsx` passes 2/2.
  - Adding an inline `{}` to M7's deps fails both tests on `"handleStepConfigChange"`. Adding it to M6's deps
    fails both tests on `"handleAddLaneStep"`. Each was reverted and the test is green again.
  - So the test catches any per-render identity change on either callback. That covers the only risk the two
    non-verbatim deps additions add. Both added values are stable by construction (a `useRef` object and a
    `useState` setter), so there is no lost-update risk to characterize.
  - Behaviour coverage of draft create exists, e.g. `StepCard.enumSaveError.test.tsx:210` "Failed to save this
    step". Task 6.1 records the full list.
  - The full `src/features/pipelines` jest run in scratch had 1508 pass and 1 fail, plus 3 suites that failed
    for an environmental reason: ENOENT on `backend/src/test/resources/...`, which is absent from the scratch
    copy. Re-run on the 3 named suites, the ENOENT reproduced. This is not caused by the split.
- **D7 sites (re-read at HEAD; these files are unchanged since SPLIT_BASE).**
  - `usePipelineOutputSheets.ts:26` (`EMPTY_ANALYZE_COLUMNS` "above"): the constant lives in
    `usePipelineAnalyzeLookups.ts:13`.
  - `usePipelineOutputSheets.ts:66-67` ("derived-state block above"): the block is in
    `usePipelineDetailPage.ts` (~L225-238, `setSeedToken` at L237).
  - `usePipelineDebouncedAnalyze.ts:96-97` (`pendingSinceRef`'s comment "above"): it is at
    `usePipelineDetailPage.ts:166-184`.
  - `usePipelineRunAndSaveActions.ts:46` and `:50` (`onTerminal` "below"): the handler is in
    `usePipelineRunStream.ts:35`. It does refresh previews, so the sentence's claim is still true; only the
    location pointer is wrong.
  - All five line numbers are correct.
- **D7 proof.** It has two checks: a line-class check (every changed line is a comment line) and a
  comment-stripped / AST equality check against the parent. The second check catches what the first misses
  (for example a trailing code-plus-comment line). Together they are adequate.
- **Round-2 drift sanity check (light).**
  - The branch has the characterization test, then the useStepCardState split, then the D2 trim.
  - Files are 211 / 90 / 207 / 131 / 178 / 164 lines, and `usePipelineStepStructure.ts` is 171.
  - The handler modules are the plain `stepCard*Handlers.ts` variant that D1 explicitly allows.
  - There is no `eslint-disable` in any changed file.
  - The final gate does the full proof review.
- Nothing was written to the worktree except this report (`git status` shows only the 4 plan files that were
  already modified).

### Verdict: CONFIRM

D6 is sound: verified by hand-tracing, and lint plus identity-test probes on a scratch copy of the exact
planned split. D7's site list is right and its proof is adequate. The notes below are polish for the executor
and do not block.

### Non-blocking notes

1. **Contradiction to tidy in design.md.** The Goals/Non-Goals section still says the "L209–210 comment
   pointing at `StepCardStateHandlers` above" is a non-goal / follow-up. D7 now explicitly puts that site in
   scope. D7 wins (it is later and explicit); amend the Non-Goals line so the two don't disagree.
2. **Concrete list of this PR's own cross-file pointers for D7.** These are what my grep of the moved comments
   found, so the executor's grep has a known-answer check:
   - `useStepCardEditorState.ts:116` ("`StepCardStateHandlers` above" now lives in `stepCardStateTypes.ts`);
   - `stepCardStateTypes.ts:55` ("`onUpsertSourceChange`'s persist call site below" now lives in
     `stepCardOpHandlers.ts`);
   - `stepCardOpHandlers.ts:71` ("onWindowChange's … pattern above" now lives in `stepCardFieldHandlers.ts:138`);
   - after D6, M6's moved comment at base L267 ("same deferred-create rule as `handleInsertStep` above" — which
     stays in `usePipelineStepCreation.ts`);
   - arguably, the host's args-type comment at L39-40 ("called after every mutation below"): some of those
     mutations move into M6/M7.

   These were checked and are not cross-file: the `useStepCardPersist.ts` above/below pointers,
   `stepCardOpHandlers.ts:101`, and the `usePipelineShapeInstantiation.ts` `anchorHasTail` pointers (stale for
   a different reason; follow-up as planned).
3. **`usePipelineOutputSheets.ts:25-27` has a second wrong pointer.** The sentence's subject, `EMPTY_OUTPUTS`,
   is not in that file. It is in `ui/LaneColumn.tsx:24`. Naming only `EMPTY_ANALYZE_COLUMNS`' file would leave
   the sentence still implying `EMPTY_OUTPUTS` is local. Fix both in the same comment edit.
4. **Same-class pointer outside the listed scope.** `ui/PipelineRiverView.tsx:40` says "mirrors
   `EMPTY_ANALYZE_COLUMNS` in `usePipelineDetailPage.ts`", but it now lives in `usePipelineAnalyzeLookups.ts`.
   This is stale from an earlier PR, not this one. Include it in the D7 commit (cheap, same class) or file it as
   a follow-up candidate; either is defensible. Record which.
5. **D6 byte-move whitelist.** Prettier reflows M7's deps array to multi-line once the two names are added
   (seen in the probe). The byte-move check therefore needs the deps-array lines whitelisted or normalised.
   The separate deps check is what should prove "base + exactly `creatingDraftIdsRef`, `setDraftCreateErrors`".
   M6's region stays byte-identical.
6. Unchanged from base and out of scope: `syncStepsFromServer` is passed to `usePipelineStepCreation` but never
   destructured. Leave it.

Probe artifacts: `/home/matt/Development/helio/.concertino/runs/HEL-1481/evidence/skeptic-design-3/`
(`split_probe.py`, `scratch/`, and the base-region extracts in `tmp.*`).
