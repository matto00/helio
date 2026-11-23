## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD e3eda3eda28683075c616a0ebd9935ad4c89b9f9. The planning artifacts are uncommitted in the change dir. Paths are under `frontend/src/features/pipelines/` unless noted.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/pipeline-viewer-read-only/HEL-1794`.

#### Round-1 change requests

- **CR1 (network watch): addressed.** The design now watches every non-GET to `/api/pipelines/**`, `/api/pipeline-steps/**` and `/api/outputs/**` over the whole viewer flow, with an allow-list of read-only POSTs.
  - I enumerated every non-GET in `services/*.ts`. The step writes are at `pipelineService.ts:150,165,175,181`. Output writes are at `outputService.ts:42,56,62`. Root writes are at `pipelineService.ts:199,215`, reorder at `:230`, schedule at `:389,398`, and shape expansion at `:423`. All of them fall inside the watched prefixes.
  - The read-only POSTs are `outputService.ts:257` (preview), `:280-281` (validate-expression) and `draftPreviewClient.ts:160` (draft-preview, sent with `fetch`, which Playwright still sees). All three are allow-listed.
  - One read-only POST is not allow-listed: `POST /api/pipelines/analyze-proposal` (`services/analyzeProposalService.ts:9`). It fires only while a sheet is open on a draft (`hooks/useDraftNodeCapabilities.ts:49-51`), so the green flow never sends it. See note 1.
- **CR2 (read-only presentation): addressed.** The design adds the `--readonly` modifiers, uses tokens only, sets a 4.5:1 contrast bar in both themes, and adds a mutation for the modifier. The opacity source is confirmed at `shared/ui/inputs.css:46-51`. The helper path is wrong; see note 2.
- **CR3 (copy inventory): addressed.** All six strings I listed in round 1 are in the D3 table, and I confirmed each by grep:
  - `PipelineSpine.tsx:222,235`
  - `PipelineSpineLayout.tsx:329-333`
  - `MobilePreviewTab.tsx:74`
  - `LiveOutputColumn.tsx:191`
  - `MobileStepSheet.tsx:63-64`

  The table also covers `OutputSheetPreviewCard.tsx:59`, now respelled as a whole paragraph, and `OutputHistoryModal.tsx:51`. Task 1.1 adds a string grep.
- **CR4 (red-first mechanics): addressed.** Inert stubs are in D4 and task 1.2, and they are promoted to standing constraint C15. `git commit -n` is named in the commit message and the PR body.
- **CR5 (allow-list and schedule): partly addressed.** The allow-list is now exact, with no regex or wildcards. Some names are still described rather than spelled out (the step row select, the Output toggle, the schema-disclosure toggle, the close control, the phone tabs), but the executor must record them verbatim in the spec. That is acceptable.
- **The schedule half of CR5 rested on a false premise, and the premise was mine (round 1).** See CR1 below.

#### Fresh checks on the current artifacts

- **Schedule reads and writes are owner-only on the server.**
  - `backend/.../services/pipelines/PipelineScheduleService.scala:38-46` (`find`), `:49-54` (`put`) and `:102-104` (`delete`) all gate on `pipelineRepo.findByIdOwned`. That function filters on `ownerId === caller` (`PipelineRepository.scala:113-121`).
  - `PipelineScheduleRepository.findByPipelineId` (`:59-66`) also joins on `pipeline.ownerId === caller`.
  - So a viewer's and an editor's `GET /api/pipelines/:id/schedule` returns 404. `state/pipelineScheduleThunks.ts:34-35` maps a 404 to `schedule: null`.
  - The result: on main, every grantee sees "Add schedule" (`SpineScheduleChip.tsx:17-29`) and "Set schedule" (`PipelineSpineHeader.tsx:72`), even when the owner has seeded a schedule. A grantee can never see "Edit schedule", "Pause schedule" or a schedule's text.
- **Draft wiring is implementable, but the design does not state the order.**
  - `usePipelineDraft` is called at `hooks/usePipelineDetailPage.ts:57`. `runRole` is computed at `:126`, after `usePipelineDirtyAndOwner` at `:115`, which depends on `roots` and so on `draft.overlay.ops`.
  - `isOwner` itself reads only `currentPipeline` and `currentUser` (`usePipelineDirtyAndOwner.ts:54-57`). `usePipelineRunRole` holds only selectors, so it can be hoisted above the draft without disturbing the HEL-1704 effect order. Alternatively, a ref can be created before the draft and written after `runRole`.
  - The design's phrase "read through a ref" covers this. Non-blocking note 3.
- **The disabled fieldset wraps only `StepOpEditor`** (`StepCardFocused.tsx:133-144`). The preview table and the step actions are outside it, which matches D3's split.
- **The rest of the design holds as stated.**
  - The D2 guard leaves `discard`, `rebase` and the restore path unguarded. `rebase` (`usePipelineDraft.ts:344-363`) and the prune effect (`:163`) are not user mutators, so this is correct under the HEL-1661 Q2 ruling.
  - The spec deltas are well-formed ADDED requirements with scenarios.
  - I found no placeholders and no tasks that contradict the design.

### Verdict: REFUTE

### Change Requests

1. **Correct the schedule premise everywhere. Today the static-text schedule is unreachable dead code for every role.** Owners always have `canEdit` and so get the button. Grantees always get `schedule === null` because of the owner-only 404 described above.
   - **design.md D3 "Schedule chip":** state that a grantee never receives a schedule (cite `PipelineScheduleService.scala:38-46`). For a viewer, the chip and the "Set schedule" menu item are simply not rendered. Either drop the static-text branch or justify it as dead code. Also fix D1's "the chip as static text" pending form.
   - **design.md D4 e2e:** remove the claims that seeding a schedule makes the red cover "Edit schedule" / "Pause schedule", and that "the schedule's static text is visible". As written, the green fails for any correct implementation. The red is "Add schedule" plus the "Set schedule" menu item, whether or not a schedule exists.
     - If the owner PUT stays in, re-purpose it as a guard: the viewer must still see no schedule control even when a schedule exists.
     - The editor control asserts "Add schedule". Note that an editor's save 404s today; that is pre-existing and out of scope.
   - **design.md D4 mutations:** "render the schedule chip as a button for viewers" must name the null-schedule "Add schedule" button. It is the only branch a viewer can reach.
   - **`specs/pipeline-detail-spine-layout/spec.md`:** reword "(the schedule is shown as static text when one exists)". It is not achievable frontend-only.
   - **tasks.md 3.1:** reword "schedule chip static/absent" to "absent".
   - **Product question for the orchestrator to escalate (I do not decide it):** should viewer and editor grantees be able to read a pipeline's schedule, and should editors be able to save it? The ticket assumes a viewer sees the schedule ("editing or pausing the schedule"), and its driver note says "frontend only expected".
     - Answer "no / not now": CR1 as written suffices, and the design should record the grantee schedule gap as a follow-up.
     - Answer "yes": this is a backend scope addition (owner-only GET/PUT/DELETE in `PipelineScheduleService`) that this design rules out under Non-Goals.
     - Either way, the revised design must not depend on the answer silently.

### Non-blocking notes

1. Add `POST /api/pipelines/analyze-proposal` to the network-watch allow-list as a read-only POST (`analyzeProposalService.ts:9`). It only fires with a draft open, so it does not affect the green. It would matter if the existing-draft viewer scenario were ever watched.
2. `e2e/support/stateContrastProbe.ts` exports only selectors (`INTERACTIVE_SELECTOR`, `FOCUSABLE_SELECTOR`). The contrast math is in `e2e/support/stateContrast.mjs` (`contrastRatio`, `compositeStack`, `parseColor`). Point D4 and task 3.4 at both files.
   - The measurement must include the element's and its ancestors' computed `opacity`. A bare computed-`color` read will not see the 0.55 dimming.
   - The planned "remove the read-only modifier → contrast red" mutation will catch a probe that ignores opacity, so keep that mutation.
3. In D2, state how `editable` reaches `usePipelineDraft` given the call order (draft at `usePipelineDetailPage.ts:57`, role at `:126`). Either hoist `usePipelineRunRole`, which is selector-only and safe since `isOwner` depends only on `currentPipeline`/`currentUser`, or use a ref written after the role is computed.
4. The desktop region `aria-label="Step editor and preview"` (`PipelineSpineLayout.tsx:277`) is a landmark, not a control. A viewer variant ("Step details and preview") would match the phone sheet's "Step details". Optional.
5. `ui/pipelineMobileTestKit.tsx:29-30` looks up the sheet as `dialog` named "Step editor". Viewer-branch tests need the new name, and editor tests are unaffected.
