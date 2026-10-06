## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `b16bfa1b3a74905eefc0208a01793efa047909c5`. The worktree has no commits beyond main, and the change dir is untracked. `usePipelineDetailPage.ts` is 1598 lines.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/pipeline-step-create-followups/HEL-1340`.

- **The owner ruling is real.** `.concertino/runs/HEL-1340/events.jsonl` has the following lines:
  - line 10: escalation `HEL-1340-1791301125002-645d44` raised, with options H1/H2/halt.
  - line 11: an `answer_discarded`.
  - line 12: `escalation.answered`, `answer: "H2-move-ac4-to-hel1345"`, `answer_source: "human"`.

  `ticket.md` (driver scoping and AC4), `proposal.md` (non-goals), `design.md` D5 and `tasks.md` C6 all record the move consistently. No task covers item 4. Item 5 stays excluded (C1).

- **CR1 (item 4 grounded in the server contract): resolved by moving it out of scope.**
  - `probe.md` records a route-level probe against embedded Postgres, not the dev DB. The verbatim source is included, and the run reported 3 tests passed.
    - Case 1 (`{rootId, position:2}`) and case 2 (`{rootId}`) both produce `NEW -> A -> B -> C` with `reparentedStepIds=[A]`.
    - Case 3 (`{position:2}`, no rootId) produces `A -> B -> NEW -> C`.
    - That confirms the round-1 code reading.
  - The ruling is legitimate and recorded.
  - HEL-1345 exists in Linear. Its title now reads "... (CONFIRMED by probe) — every UI append lands at head", and its updatedAt is 17:20 on 2026-10-06. Its description does not mention item 4 or the CR3 hazards. I could not read comments with the available tool, so I have not verified the claimed handoff comment. This is non-blocking: the scope move itself is grounded in the event log.

- **CR3 (reconcile drops local-only steps): moved out of scope together with item 4.**
  - This ticket adds no resync (C6, D5).
  - I confirmed that the draft-create `.then` (`usePipelineDetailPage.ts:1113-1142`) does a one-element swap and never calls `syncStepsFromServer`.
  - Nothing in the plan adds a new full-list replace.

- **CR2 (item-1 fixture vs a later resync): resolved, and it is consistent with the code today.**
  - The HEL-1321 probe (`archive/2026-10-06-ai-draft-step-stable-key/evaluation-2.md:57-78`) inserts through the last gap. With `[anchor-1, f-1]` that is index 1. The wire call is `position=1, rootId=root-1` (:775-778, :1104-1112).
  - Per probe.md case 1, today's server would return `[ai-1 (head), anchor-1, f-1]`. D2's post-create list puts `ai-1` at the head, so it matches.
  - On today's code nothing in the test's path refetches steps:
    - the draft insert returns before any create (:774-780);
    - the draft create does not resync;
    - `handleReorderSteps` reconciles from the PUT response, not a GET (:1281-1291).
  - So the second mock value is inert today. It is a forward-compatible fixture, not one that changes behaviour.
  - D2 also says honestly that HEL-1345 will change the placement and must update the fixture.
  - The mutation target is now correctly :1290.

- **CR4 (fallback lifetime across the swap): resolved in substance. The test is genuinely able to hold the analyze.**
  - The fallback gates are `getAnalyzeColumns`/`getAnalyzeSchema` (:569-588), keyed on `pendingDraftMetaRef.current.has(stepId)`. The meta is deleted at :1103 before the create.
  - After the swap, the persisted id sits at the same local index, so `resolveDraftFallbackSchema`'s backward walk (`stepNarrowing.ts:464-469`) or its anchor lookup (:459-462) still resolves correctly with re-keyed meta.
  - "Dropped once `analyzeByStepId` has the persisted id" falls out of the read order (analyze entry first), so it is implementable.
  - `analyzePipeline` is a service-level `jest.fn()` in `PipelineDetailPage.draftCreate.test.tsx:47,58`. A test can `mockImplementation(() => new Promise(() => {}))` before `create.resolve(...)`, which genuinely holds the post-swap analyze. A held analyze keeps `analyzeStatus` loading, and the debounce/watchdog redispatch is just another held call.
  - This file's analyze fixture (:274-287) never contains `ai-1` anyway, so scenario 2 is red without the fix and cannot be masked.
  - Spec scenario 2 is consistent with D4.

- **CR5 (call site vs render-time ref reads): option (b) is chosen, and no useEffect has to move.**
  - I grepped every use of the moved symbols:
    - `creatingDraftIdsRef`: :175, :1100-1151
    - `draftCreateErrors`/`setDraftCreateErrors`: :179, :1089, :1140, :1146, :1561
    - `creatingStepIds`/`markCreating`: :184-195, :781-905, :1590
    - `handleInsertStep`/`handleAddStep`/`handleAddLaneStep`: :759-905, plus return keys
  - None of them is read between their declaration and :731.
  - `pendingDraftMetaRef` stays at :166 for the render-time read at :362.
  - The page hook's `useEffect`s are at :321, 338, 403, 404, 482, 489, 607 and 672, all before :731. A hook called just after `syncStepsFromServer` crosses no effect boundary in the effects' relative order, and contains no effect itself.
  - The D3 input list covers every free variable of the moved handlers: `id`, `roots`, `stepsRef`, `setSteps` (:149, useState), `setStepsInitialized`, `syncStepsFromServer`, `pushToast` (:100) and `pendingDraftMetaRef`.
  - `handleStepConfigChange` (deps `[id]`) stays identity-stable, provided `createDraftIfComplete`/`clearDraftCreateError` are `useCallback`s over stable inputs. They are: refs, setters and `id`.
  - **But D3's new constraint text contradicts D3's own plan.** See Change Request 1.

- **Size:** item 2 does not need to be split. My round-1 assessment stands.

### Verdict: REFUTE

### Change Requests

1. **design.md D3: the constraint "No declaration is hoisted or sunk across an effect" contradicts the boundary D3 specifies.**
   - **What's wrong:** D3 moves ownership of `creatingDraftIdsRef` (:175), `draftCreateErrors` (:179) and `creatingStepIds`/`markCreating` (:184-195) into the new hook, and calls that hook "just after `syncStepsFromServer`, :731". That sinks those `useRef`/`useState`/`useCallback` declarations across eight effects (:321-672). Read literally, the constraint forbids the plan. An implementer who follows the constraint would have to keep those declarations in the page hook and pass them in. That exceeds D3's fixed input list and trips D3's own stop condition, which means a spurious split escalation. An evaluator auditing hunk by hunk against the constraint would REFUTE a correct refactor.
   - **Why it's otherwise safe:** I grepped every reader, and no reader of those symbols lies between :175 and :731. Moving non-effect hook declarations does not change effect order or behaviour. So the plan is sound and only the rule is wrong.
   - **Required revision:** reword the rule to what the round-1 CR asked for: "no `useEffect` changes its relative declaration order, and the new hook declares no effect". Then state explicitly that the moved `useRef`/`useState`/`useCallback` declarations (:175-195) relocate to the call site at :731, which is safe because nothing between :175 and :731 reads them (cite the grep).

2. **design.md D4: say where the fallback-meta map lives and how `getDraftFallbackSchema` reads it.**
   - **What's wrong:** the map is written by `createDraftIfComplete` (new hook, called at about :731) and read by `getAnalyzeColumns`/`getAnalyzeSchema` (:569-588, before the call site). It therefore cannot be created inside the new hook: it would be a use before declaration. It must be created in the page hook next to `pendingDraftMetaRef` and passed in as an added input. That is legitimate in commit 3, since D3's stop condition governs the refactor commit.
   - **Second gap:** `getDraftFallbackSchema` (:557-567) passes `pendingDraftMetaRef.current.get(stepId)` as `meta`. Unless it also reads the fallback map, a lane draft (`meta.parentStepId`) in flight or post-swap loses its exact-anchor resolution. It silently degrades to the array walk that HEL-1109 CR2(a) deliberately rejected.
   - **Required revision:** D4 must state:
     - (a) the map is a page-hook ref passed into `usePipelineStepCreation`;
     - (b) `getDraftFallbackSchema` takes its `meta` from `pendingDraftMetaRef` or else the fallback map;
     - (c) the swap re-keys the entry temp id → persisted id in the same `.then`, before `setSteps`.
   - Optionally, add a lane-draft variant of scenario 1 or 2 to the test plan.

### Non-blocking notes

- I could not verify the claimed HEL-1345 handoff comment, because comments are not readable through the available tool. HEL-1345's description still says "suspected" and omits item 4 and the CR3 merge-preserving rule. Confirm the comment exists before delivery, so that the hazards are not lost.
- The Risks line "`handleInsertStep`'s create-immediately resync also drops local-only steps → noted as a follow-up" names no ticket. Either point it at HEL-1345 or file one.
- The D2 fixture relies on the mount issuing exactly one steps GET (the `mockResolvedValueOnce` initial list). `lastFetchedIdRef` (:327) guarantees this today. If a second mount GET ever happened, the test would show `ai-1` from the start and fail loudly rather than pass vacuously, so that is acceptable.
- Under today's head-splice defect, the eventual real analyze entry for the persisted step will carry the root source schema, not the anchor's output. That is correct to leave to HEL-1345, and D4's read order handles it correctly.
