## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 014317f538d3ec10f0394407f2c36d7e8e4fb7d4 (the change dir is untracked; no code changes yet).
The owner's rulings (escalation HEL-1542-1795647439065-9d63cb, `escalation.answered`, answer_source human:
proceed-with-restated-scope / keep-draft / rewrite-all-four / link-only) are taken as given. I did not re-litigate them.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/draft-lane-notice-labels/HEL-1542`.
- **laneGate citation (design Context):** correct. `DraftSaveTransaction.scala:236-240`, message at L238
  `Step '${v.stepId}' has a lane reference to '${v.targetId}', which would be ${v.relation.describe}.`. It runs on
  `writes.readRows` after the inserts (L216-217), so a created step appears under its server UUID. `apply` receives the
  locked-state `plan` (L95, L106), so D1 can thread the plan's map into `laneGate`. `Relation.describe` values are
  `the step itself` / `its ancestor` / `its descendant` / `a step that depends on it through a lane link`
  (`LaneCycleViolations.scala:17-21`). The `Itself` case names the same id twice, and D2's substitution handles that.
- **requireLaneTargetsExist citation:** correct. `DraftDiff.scala:305-310` uses `w.id` (`StepWrite.id` = `r.id` =
  `newId()` for a created step, L196, L313). D1's claim about the target holds in substance: `validatedConfig` rewrites lane
  ids through `clientIds.get(id).orElse(Some(id))` (L296). A created step's clientId therefore resolves to an id in
  `byId` and cannot be the dangling target. The dangling target is always an id the client sent: an unknown id, or the
  **stored id of a step the draft removed**. The design's wording ("already a client id or an unknown id") is loose: a
  clientId target never reaches this message. The conclusion still holds.
- **clientIds at L88:** correct (`resolved.collect { case r if r.req.clientId.isDefined => clientId -> r.id }`).
- **Other DraftDiff step messages use `r.key`:** confirmed for resolveParents (L226-243), requireAcyclic (L260),
  normalizeSteps (L276), validatedConfig (L291-299) and resolveSteps (L190-205, which uses an index or the client-sent id).
  The only step-naming message that is not quoted is `Duplicate step id or clientId in the draft: a, b` (L201). The client
  cannot send it, because its ids are unique.
- **Other draft-save 400s:** `cycleCheck` → `PipelineCycleGuard` names data sources by name or id, not steps
  (`PipelineCycleGuard.scala:42-62`). `checkReferences`/`checkStepReferences` name data sources
  (`DraftSaveService.scala:135-165`). `PipelineRootWrites.scala:174` is a step-naming lane message, but it is on the
  non-draft `DELETE /roots` path, so it is rightly out of scope. Output messages (`Output '$key'`, `outputs[$i]`) name
  Outputs, not steps (see the notes for one sibling defect there).
- **Client citations:** `stepNamedBy` is at `draftSaveRequest.ts:49-59`, uses array-order `steps.find`, and falls back to
  created Outputs (HEL-1733 D9). `noticeForSaveError` is at L140-177 and passes the message verbatim. It is called from
  `usePipelineDraftSave.ts:183-189` with `draftSteps: draft.draftSteps`, plus `steps: stepsRef.current` (the saved
  steps). The prefix render is at `PipelineDraftNotices.tsx:40-55`. A created step's page id is its clientId, which
  `toDraftSteps` sends as `clientId` (`pipelineDraft.ts:323`), so after D1 a created step's key matches a page id. Defect
  1b is real and the AC's red-on-main claims are achievable.
- **Backend red test achievable:** a created step can introduce a lane cycle. For example, insert `draft-new` before X
  (X relinked under `parentClientId: draft-new`) with `draft-new`'s lane naming X (a descendant), or a lane to its own
  clientId (Itself). On main this names `newId()`, so the test goes red. The existing-steps scenario is a guard, green on
  main, and that is acceptable. `grep "would be its|has a lane reference|which is not a step of the draft"` over
  backend/src/test, frontend/src and e2e returned 0 hits, so the Planner Note about no existing copy assertion holds.
- **hel908-tail-attach intents map onto the draft editor:** "tail/lane" = the `lane` op → `attachLane`, a new child at
  sibling position ≥1 (`draftOps.ts:198-212`). Duplicate = `spliceAfter`: every child of the anchor, tails included, moves
  under the clone (`draftOps.ts:168-178`, used at L280), so "tail kept on clone" is the real current rule. Delete =
  `deleteStep`/`removalOf`: the head child is reparented and the other children's subtrees are removed
  (`draftOps.ts:115-153`), so the "cascade-deleted tail" rule holds. A removal triggers the server `cascadeGate` 422
  (`DraftSaveTransaction.scala:167-186`), and the design's "through the cascade confirmation" is correct. All four tests
  map.
- **Quarantine citation:** `playwright.config.ts:106-110` is the only HEL-962/tail-attach mention outside archives (grep).
  CI picks up specs by config glob plus `testIgnore` (`ci.yml:91`, `scripts/e2e-shard.mjs`), so removing the entry is
  enough to run it in CI.
- **Item 3 lines:** `useStepCardState.characterization.fixtures.ts` L517/526/535 each read "HEL-1515: a lane to a
  dependent is a 400…". This is confirmed.
- **Helper citation (D4):** WRONG, see CR2. `grep "^export" e2e/support/hel1684-draft-structural.ts` exports no
  `selectRow`, `editorAction`, `spineRows` or `clickRowMenuItem`. They live in `e2e/support/pipelineSpine.ts` (L7-49),
  which hel1684 imports. The palette helper is `pickStep` (`#step-palette-option-<kind>`, hel1684 L173-178), not a
  `role="option"` locator.

### Verdict: REFUTE

The plan is close. One substantive gap and three precision fixes are needed before an implementer can execute it without
guessing.

### Change Requests

1. **D2 / spec: the dangling-target message still leaks a UUID, and the design claims it will not.** The restated scope
   explicitly covers "the sibling dangling-target message". Its target is the stored id of a step **the draft removed**
   (a join/union/lookup whose lane target was deleted in the draft; nothing in `draftOps.deleteStep` touches other steps'
   configs, so this is plausibly the easiest step-naming 400 to reach in the UI). That step is in `ctx.steps` (saved) but
   **not** in `ctx.draftSteps`, and `draftSteps` is the list `stepNamedBy` is given today. If D2 substitutes over
   `draftSteps` only, the notice shows the raw UUID. That breaks the spec's "SHALL NOT show the id of any step on the
   page" and the ticket's "never a raw step id". Revise D2 to:
   (a) resolve labels over `draftSteps` first, then the saved `steps` (so a removed target is named by its saved label);
   (b) say what an id found in neither list renders as. The case: a draft-created step that a later draft op deleted,
   whose clientId stays in a lane config. Either a fixed phrase ("a removed step") or an explicit, recorded acceptance of
   the verbatim id;
   (c) delete the false claim "after D1 none should remain".
   Add to task 2.1 a jest case for the removed-target dangling message (red on main). Add a `pipeline-draft-save`
   scenario and a 1.1 backend case for `requireLaneTargetsExist` with a **created** subject step (`Step '<newId()>'`
   on main, so red). Today 1.1 covers only the lane-cycle gate, though D1 changes both messages.
   Under the Risks entry for the visual check, name the dangling-target path (delete a lane target in the draft, then
   Save & run) as the first UI path to try.
2. **D4 helper citation is wrong.** Replace "Reuse `e2e/support/hel1684-draft-structural.ts` helpers (`selectRow`,
   `editorAction`, `spineRows`, `clickRowMenuItem`, the palette's `role="option"`)" with the real locations:
   `e2e/support/pipelineSpine.ts` (`spineRows`, `spineRow`, `selectRow`, `clickRowMenuItem`, `editorAction`), and
   hel1684-draft-structural.ts for `pickStep` (`#step-palette-option-<kind>`), `stepMenu`, `saveAndRun` and `openPipeline`.
   An executor told to import nonexistent exports will improvise new selectors, which D4 is meant to prevent.
3. **D4 must say each test asserts the tree twice: in the draft, before Save & run, and after reload.** HEL-908's tests
   2-4 existed to catch a **without-reload** defect class: the client rendering a stale tree (tail on the original, a
   phantom cascaded tail) until reload. The draft-editor equivalent is the client's draft replay
   (`spliceAfter`/`deleteStep`), and that is what the tests would lose if they asserted only after reload. As written,
   "persisted by Save & run, then a reload is asserted" can be read as "post-reload only". That reading drops the
   original intent the owner chose to keep (`rewrite-all-four`). Make both assertion points explicit, and for test 3/4
   name the pre-save draft assertion (tail under the clone's row; no cascaded tail row).
4. **Spec and D2 disagree on scope.** The `pipeline-draft-mode-ui` requirement says the notice SHALL NOT show any page step
   id, but D2 substitutes only quoted (`'<id>'`) occurrences. The one unquoted step-naming message
   (`DraftDiff.scala:201`, duplicate keys) is unreachable from the client. Either scope the requirement to ids the server
   quotes, or have D2 substitute every occurrence (longest-first already guards prefixes). Write down which, so the
   implementer's test and the spec agree.

### Non-blocking notes

- D2's sentence "Every server message that names a step puts the subject first" has an exception:
  `outputs[$i]: nodeStepId '<sid>' is a step the draft removes` (`DraftDiff.scala:416`), where the subject is an Output.
  The prefix behaviour there is unchanged from main (array order and earliest occurrence pick the same id). Worth a
  footnote, no change needed.
- Say whether created Outputs compete with steps on "earliest occurrence" or stay a fallback after steps (today they are a
  fallback). Either is fine; pick one.
- Sibling defect, out of scope (spin-off candidate): `planOutputs`' `readsOk` builds `Output '$id': …` with `id`, which is
  `newId()` for a created Output (`DraftDiff.scala:361, 379, 389-390`). So an insight-reads 400 on a created Output names
  a server UUID, against HEL-1733 D9's "a created Output is named by its client id".
- D1's wording "the target … is already a client id or an unknown id": more precisely, it is an unknown id or a removed
  step's stored id. A clientId resolves and never dangles.
