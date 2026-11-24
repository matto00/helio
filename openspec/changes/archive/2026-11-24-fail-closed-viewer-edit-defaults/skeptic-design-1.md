## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD b2da43a3d02ba1b84eb8296b9bd9ed742623a353 plus the uncommitted change dir
`openspec/changes/fail-closed-viewer-edit-defaults/` (ticket.md, proposal.md, design.md, tasks.md,
specs/pipeline-detail-spine-layout/spec.md). No servers started.

### What I verified (with evidence)

- **Listed defaults exist.** I grepped `features/pipelines` (non-test) for `(canEdit|canRun|editable|...)\s*=\s*true|readOnly\s*=\s*false`.
  It returns exactly the 12 sites design.md Context names: RunHistoryModal.tsx:169, StepCardFocused.tsx:46,
  OutputHistoryModal.tsx:26, OutputEditorFooter.tsx:33, SpineOutputs.tsx:47, OutputEditorSheet.tsx:99,
  OutputSheetPreviewCard.tsx:29, useSpineStepActions.tsx:80, SpineSourceCard.tsx:45, PipelineSpineHeader.tsx:65,
  SpineStatusStrip.tsx:15, PipelineSpine.tsx:106.
- **Optional `readOnly?`/`canEdit?`/`canRun?` props.** Every hit in `ui/` has a destructuring default, except
  `stepCardTypes.ts:40`. That is StepCardFocused's own props interface, defaulted at StepCardFocused.tsx:46.
  design.md's claim that it is "read as falsy by step-config components" is wrong: `grep readOnly stepConfigs/`
  finds nothing. The claim is harmless because the executor re-derives the list.
- **Mobile.** `ui/mobile/*` reads `page.canEdit`/`page.runRole` from the required page state and passes them
  explicitly: MobileStepSheet.tsx:101 `readOnly={!page.canEdit}`, MobileRunsTab.tsx:20, PipelineMobileLayout.tsx:72
  and :184 and :236. No mobile component has a fail-open default of its own.
- **Every production caller passes the prop.** I listed each JSX/hook call site with
  `grep -rnE "<Component\b"`, excluding tests. All pass the prop, derived from the role: PipelineSpineLayout.tsx:82,
  :220, :230, :278, :314; PipelineMobileLayout.tsx:72, :184, :236; PipelineSpine.tsx:187 and :283
  (`readOnly={!canEdit}`); OutputEditorSheet.tsx:315 and :438 (forward `readOnly`); PipelineDetailDialogs.tsx:96,
  :106, :116; RunHistoryModal.tsx:210 (forwards `canRun`); MobileRunsTab.tsx:20. No module outside
  `features/pipelines` imports these components. So flipping the defaults removes no control from an owner or
  editor on the real page.
- **Test blast radius.** I counted `readOnly`/`canEdit`/`canRun` occurrences per test file. Sixteen
  `OutputEditorSheet*.test.tsx` files, three `StepCardFocused*.test.tsx` files, `OutputEditorFooter.test.tsx`,
  `OutputHistoryModal.rules.test.tsx`, `RunHistoryModal.test.tsx` and several spine tests pass no role prop.
  Many of them rely on the old default, not only `test/conditionalFormatsEditorHarness.tsx`.
- **D2 (`:disabled`) is correct.** scan() in e2e/hel1794-viewer-read-only.spec.ts:113 skips on
  `.disabled || closest("fieldset[disabled]")`. `:disabled` matches exactly the form-associated elements a
  disabled fieldset disables, outside its first legend. `a[href]`, `summary`, `[role=button]`, draggables and
  contenteditables never match it, so they get scanned. `summary` is missing from SELECTOR (line 77), as claimed.
  The phone step sheet is `BottomSheet` → `Modal` → `<dialog>`, so `dialog[open]` already covers it as a scan root.
- **D3.** Links and summaries really do sit inside viewer fieldsets: `stepConfigs/ComputeFunctionReference.tsx:28`
  has a "Functions and operators" summary inside StepCardFocused's fieldset, and the Output sheet has an
  "Ask about this Output" summary. Putting a pure disclosure or a navigation link into ALLOWED is factual
  classification, and it matches the existing precedent ("Output" disclosure, "Pipelines" crumb). The rule to
  escalate a genuine product call is right. D3 does not make a product decision nobody asked for.
- **D4 is a real red-first proof.** Under the old scan, a planted link or summary inside `fieldset[disabled]` is
  skipped, and summary is not selected at all, so the test is red. Mutations (a) and (b) each turn it red. The
  planted `<input>` assertion also catches dropping the `:disabled` skip.
- **D6.** viewerCopy.test.ts's header claims to pin "every viewer variant, with the editor/owner string beside it".
  The test pins one entry's two strings and loops `viewer !== edit` plus `/\b(add|edit|run the)\b/i`. The
  diagnosis is accurate.

### Verdict: REFUTE

### Change Requests

1. **Enumeration gap: `StepCardFocused.tsx:29` `isOwner = true`.** This is a fail-open permission default in a
   component this change already edits. `FocusedStepCardProps.isOwner?` (stepCardTypes.ts:14) flows through
   StepOpEditor.tsx:317 to `UpsertSourceConfig`, where `isOwner` enables the owner-only "existing dataset" target
   (UpsertSourceConfig.tsx:137 and :161). A caller that passes `readOnly={false}` for an editor but forgets
   `isOwner` gives a non-owner the owner-only option. Neither tasks 1.1's grep nor D5's guard pattern catches it.
   Decide this in design.md:
   - either flip it to `false` (both production callers already pass `isOwner={page.isOwner}`:
     PipelineSpineLayout.tsx:294, MobileStepSheet.tsx:84), add it to the guard and the per-component test,
   - or list it under Non-goals with the reason (owner-vs-editor, not viewer).
   Do not leave it unmentioned.
2. **Enumeration gap: `hooks/usePipelineDraftSave.ts:43` `runRole?: PipelineRunRole`.** It is optional and read
   without a default: `runRole === "viewer"` at lines 212 and 217. An omitted role therefore allows Save & run and
   the cascade confirm. That contradicts proposal.md's premise that "Its hooks require the caller's role". The
   scope (`features/pipelines/ui` only) and the tasks 1.1 grep (`readOnly?:|canEdit?:|canRun?:`) both miss it.
   Either:
   - make it required (the only caller, usePipelineDetailSaveWiring.ts:89, already passes it), or fail closed on
     `undefined`, and widen the 1.1 grep to `runRole?`,
   - or name it as a non-goal with a reason, and correct proposal.md's Why.
3. **D5 / tasks 3.1 would produce vacuous tests for copy-only defaults.** `RunHistoryList`/`RunHistoryModal`
   (`canRun`, RunHistoryModal.tsx:186-188), `OutputHistoryModal` (`readOnly`, line 54) and `OutputSheetPreviewCard`
   (`readOnly`, line 62) gate only copy, through `copyFor(..., !readOnly)` or the empty-state description. They
   render no edit or run control in either state. An "asserts no edit/run control" test passes against the old
   default, so the proposal's claim that "each is red against the old default" is false for these three.
   Revise D5 and 3.1 to give each component its observable acceptance signal:
   - for copy-only components, assert the viewer copy (e.g. "No runs yet." and not "Run or dry-run this
     pipeline…"),
   - for control components, keep the control-absence assertion,
   - require that each assertion is shown red with only that component's default flipped back (tasks 3.4 already
     records this, so make 3.1's assertion match).

   The spec delta's first scenario has the same gap: it only says "renders no … control". Add "and shows the
   viewer variant of any role-dependent copy", or equivalent.

### Non-blocking notes

- D1's reason for rejecting required props ("every test render of these components would have to change") also
  applies to the chosen flip: about 20 test files render these components with no role prop, and those that assert
  edit controls must now pass `readOnly={false}`/`canEdit`. Task 1.4 says "test harnesses (e.g. …)", which
  understates the work. Say "every test render that asserts an edit or run control" so the executor does not stop
  at the harness. Required props plus a fail-closed default would also give a compile-time catch; consider it, but
  it is not required.
- D5's guard catches only literal destructuring defaults. A future `readOnly?: boolean` read as falsy with no
  default (the pattern 1.1 also enumerates) would pass it. Either label that limit in the guard's comment, or also
  fail on an optional role prop (`(readOnly|canEdit|canRun|isOwner)\?:`) whose component lacks a default.
- D4: plant and scan inside one `page.evaluate`, so a React re-render cannot drop the foreign nodes in between.
  Plant into a fieldset that is under a scan root and visible (desktop's `.step-focused__fieldset` inside `main`),
  and put the input outside the fieldset's first `<legend>`.
- D6: the rewritten comment should state the regex limit (only "run the" counts as a run invitation), not just
  "invites no edit/run".
- design.md Context: correct "readOnly?: boolean … read as falsy by step-config components". It is
  StepCardFocused's own prop, defaulted at StepCardFocused.tsx:46.
