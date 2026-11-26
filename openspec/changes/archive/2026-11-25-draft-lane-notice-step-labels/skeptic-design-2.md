## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: worktree HEAD 014317f538d3ec10f0394407f2c36d7e8e4fb7d4 (= main; the change dir is the only untracked path).
The owner's rulings (restated scope, keep-draft, rewrite-all-four, link-only) are taken as given and not re-litigated.

### What I verified (with evidence)

Server citations (design Context / D1):
- `DraftDiff.scala:88` builds `clientIds` (clientId -> resolved id) inside `plan`; `resolveSteps` L196 mints `newId()` for a
  clientId step. Inverting it gives the resolved-id -> draft-key map D1 describes. Confirmed.
- `DraftDiff.requireLaneTargetsExist` L305-310 names the subject by `w.id` (the resolved, server-minted id for a created
  step). Confirmed. It runs inside `plan` (L95 in the transaction, and in the pre-lock plan), so before `cascadeGate`.
  A created-subject dangling case is therefore red on main and reachable as a 400 (not masked by the 422).
- `validatedConfig` L289-300: `rewriteLaneClientId(typed, id => clientIds.get(id).orElse(Some(id)))` at L296. The
  fallback means the target is the sent value unless it is a draft clientId. D1's reasoning (target is a removed stored
  id or an unknown id, already client-sent) holds.
- `DraftSaveTransaction.laneGate` L236-240 has the exact quoted message, judged on the written rows. It is called at
  L217 inside `apply`, which receives the in-transaction `plan` (L95, L106, param L194). So a map on that `DraftPlan`
  matches the UUIDs actually written. Confirmed.
- `DraftPlan` is constructed in exactly one place (`DraftDiff.scala:108`), so adding a field has no test fallout.
- `DraftDiff.scala:416` nodeStepId message: confirmed. The spin-off note (insight reads name a created Output by its
  resolved id, ~L379) is accurate.
- Planner note "0 hits for 'would be its'": re-run. No backend, frontend or e2e test asserts "has a lane reference" or
  "is not a step of the draft". The copy change breaks no existing test.
- `cascadeGate` (L162-186) fires on any removal (`removesAnything`), so D4 test 4's "Save goes through the cascade
  confirmation" is right.

Client citations (D2/D3):
- `stepNamedBy` is at `draftSaveRequest.ts` L49-59 and uses array order (`steps.find`). `noticeForSaveError` is at
  L140-177 and passes `ctx.draftSteps` only. Confirmed.
- `ctx.steps` is `stepsRef.current` (`usePipelineDraftSave.ts:184`), the persisted list (also used as `persistedSteps`,
  L145). The saved-label lookup for a removed lane target is real data.
- `toDraftSteps` (`pipelineDraft.ts:323`) sends a draft step's page id as `clientId`, so the server's draft key equals
  the page id. The lookup works.
- `PipelineDraftNotices.tsx:44-47` renders `Couldn't save step "<stepName>": <message> Your draft is still here.`
  Confirmed. The existing `draftSaveRequest.test.ts` cases (L96-106, L173-180) still hold under the earliest-occurrence
  rule.

e2e / config (D4/D5):
- `pipelineSpine.ts` exports `spineRows`, `spineRow`, `selectRow`, `clickRowMenuItem`, `editorAction`.
  `hel1684-draft-structural.ts` exports `pickStep` (L173, `#step-palette-option-${kind}`), `stepMenu`, `saveAndRun`,
  `openPipeline`. `recordRegisteredUser` is in `support/userCleanup.ts:59`. The round-1 CR2 citation is fixed.
- In `draftOps.ts`, `spliceAfter` (L168) moves every child of the anchor under the fresh step, and `duplicate` uses it
  (L281). `deleteStep` (L139) drops the subtree except the head child, which takes the deleted step's place, and touches
  no other config. So D4's draft assertions for tests 3 and 4, and the dangling-target UI path in Risks, match the code.
  `attachLane`/`spliceAfter` are not exported, but D4 cites them as behaviour, not as imports. That is fine.
- `playwright.config.ts` L106-110 is the hel908-tail-attach quarantine entry. HEL-962 / this spec appear nowhere else
  in the repo outside openspec (grep). D5 is accurate.
- Item 3: `useStepCardState.characterization.fixtures.ts` L517/526/535 are exactly the three HEL-1515 "dependent"
  comments.

Round-1 CRs: CR1 (saved-steps lookup, recorded acceptance for unknown ids, created-subject dangling case in 1.1 and
spec), CR2 (helper locations), CR3 (assert twice, in the draft and after reload, plus the [C1] standing constraint) and
CR4 (every-occurrence substitution, matching the spec) are all addressed in the artifacts.

AC coverage: 1b jest red-first + mutations (tasks 2.1/2.2), backend ScalaTest red on main (1.1/1.2), e2e 3 runs at 2
workers, full file, de-quarantined (3.3/3.4), visual in both themes with a recorded fallback (3.5), wording (2.3). No
migration and no HEL-1882/HEL-1013 file is in the Impact list. Every AC maps to a task with a checkable signal.

### Verdict: CONFIRM

### Non-blocking notes
- Task 2.1 says only (a), (b), (d) are red on main. (c) (a created step's clientId becomes its label in the message) is
  also red on main if it asserts the message text, since main renders the message verbatim. Record whichever is
  observed; do not force it green.
- The substitution matches ids as substrings. Temp `step-N` ids (`stepNarrowing.ts:387`) are short. Longest-first guards
  only between known ids, not against a known short id inside unrelated text. Draft messages capitalise "Step" and use
  `steps[i]`, so no collision is known, but a `step-N` in the known set is worth excluding or a word-boundary match.
- The lane-cycle backend cases that also remove a step will hit `cascadeGate` (422) before `laneGate`. The test body
  needs `confirmCascade` for those.
- D5's "other entries that mention HEL-962 are updated" is vacuous (there are none). That is harmless.
