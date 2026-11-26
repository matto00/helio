# HEL-1542: Lane picker polish, hel908-tail-attach e2e repair, and "descendant" wording (deferred from HEL-1523)

## Description

Deferred from HEL-1523 (items 7-9). The original ticket text is preserved below under "Original ticket". Setup's premise
validation found material drift against main 014317f53 (evidence: `.concertino/runs/HEL-1542/evidence/premise-validation.md`
in the main checkout). The owner answered the ticket-drift escalation (escalation_id HEL-1542-1795647439065-9d63cb,
recorded `escalation.answered`, channel chat, answer_source human):

1. `proceed-with-restated-scope`
2. `keep-draft` (item 1a dropped; current draft behaviour stays)
3. `rewrite-all-four` (hel908-tail-attach rewritten against the spine/draft editor)
4. `link-only` (HEL-1145 linked, `hel908-full-flow.spec.ts` untouched, left to HEL-964)

## Restated scope (binding)

1. **1b: step labels, not UUIDs, in the draft-save refusal notice.** When Save & run is refused with a 400 that names
   steps (the lane-cycle gate's "Step '<id>' has a lane reference to '<id>', which would be its descendant." and the
   sibling dangling-target message), the notice SHALL show step labels, never the raw id of a step the page knows
   (draft steps, created steps by client id, and saved steps the draft removed). The one exception is a step the
   draft created and then deleted: the page holds it nowhere, so its id is shown as is (design D2, recorded
   acceptance). The notice's "Couldn't save step "X"" prefix SHALL name the step being saved (the message's subject),
   never the lane target. The fix lives in `frontend/src/features/pipelines/hooks/draftSaveRequest.ts` /
   `ui/PipelineDraftNotices.tsx`, plus the backend draft-save messages so that a created step is named by its clientId.
2. **Item 2: rewrite and un-quarantine `e2e/hel908-tail-attach.spec.ts`** against the current spine + draft editor.
   All four tests are rewritten (none deleted):
   - test 1 asserts the CURRENT rule: a trunk step can carry more than one tail/lane, and adding one keeps the add
     affordance available (it replaces the removed one-tail-per-step assertion);
   - test 2: a leaf tail follows its true owner after a later trunk append;
   - test 3: duplicating a tailed trunk step keeps the tail on the clone (the uncovered assertion);
   - test 4: removing a step that owns both a head child and a tail drops the cascade-deleted tail.
   Persistence is proven through Save & run plus reload (draft mode). Remove the quarantine entry in
   `playwright.config.ts` and update/remove its HEL-951/HEL-962 comment.
3. **Item 3: wording.** Only the three HEL-1515-attributed comments in
   `frontend/src/features/pipelines/hooks/useStepCardState.characterization.fixtures.ts` (L517/526/535) change
   "dependent" to "descendant". No blanket sweep: since HEL-1521, "dependent" is a distinct, correct term in this code.
   Archived openspec files stay untouched (archives are history); the PR says so.
4. **Dropped, with evidence:** item 1a (draft mode keeps the draft on refusal by design; HEL-1521 disables cyclic
   picks) and item 1c (`saveErrorIsValidation` removed by HEL-1685 along with all per-step saves).
5. **HEL-1145:** linked only (already `relatedTo` HEL-1542 in Linear); no edit to `hel908-full-flow.spec.ts`.

## Acceptance criteria

- 1b: red-first, mutation-proven jest tests at component/hook level. The UUID-in-notice defect and the wrong-step
  prefix each go red on main before the fix. A backend ScalaTest proves that a created step is named by its clientId in
  the lane-cycle 400 (red on main).
- The rewritten `hel908-tail-attach.spec.ts` passes 3 consecutive local runs at 2 workers, runs in CI (not in
  `testIgnore`), and the full spec file is run each time.
- A visual check against the running app, in both themes, for the changed notice. If the lane-cycle 400 cannot be
  reached through the UI, the check records that, with the path tried, rather than claiming it.
- No migration. No edits to HEL-1882's files (OutputRepository, insight refresh) or HEL-1013's files (REST connector,
  REST source schema, helio-mcp).

## Original ticket

1. **Lane picker polish** (frontend, pipeline step editor): after a rejected lane choice (400 lane-cycle), the picker
   keeps showing the rejected choice; the error message shows a raw step UUID instead of a step label;
   `saveErrorIsValidation` is not passed to the join/union/lookup config editors (it is for Pivot/Window in
   `StepOpEditor.tsx`).
2. **e2e** `hel908-tail-attach` (quarantined in `playwright.config.ts`, HEL-951): tests 2-4 look repairable by locator
   alone, which would restore step-duplicate e2e coverage (HEL-962). Test 1 asserts the one-tail-per-step rule HEL-912
   removed and needs a rewrite.
3. **Wording:** frontend comments (e.g. `useStepCardState.characterization.fixtures.ts` ~L519/528/537) and the archived
   HEL-1515 proposal/tasks say "dependent" where "descendant" is meant.

Carried over from HEL-962: when this lands, update or remove the quarantine comment naming HEL-962. HEL-1145 covers
the same menuitem selectors; fold it in or link it.
