## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD b2da43a3d02ba1b84eb8296b9bd9ed742623a353 plus the uncommitted change dir
(ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-detail-spine-layout/spec.md). No servers started.

### What I verified (with evidence)

- **Round-1 change requests are resolved.**
  - CR1: `isOwner = true` (StepCardFocused.tsx:29) is now in design Context and D1, and is flipped to `false`.
  - CR2: `usePipelineDraftSave`'s optional `runRole` (usePipelineDraftSave.ts:43, read at :212/:217) is made required
    (D1a). proposal Why is corrected, and the 1.1 grep includes `runRole?:`.
  - CR3: D5 and 3.1 split control components (assert absence) from copy-only components (assert viewer copy). The
    spec's first scenario adds "role-dependent copy is the viewer variant".
- **The enumeration is complete.** I ran a wider grep than the plan's over `features/pipelines`, non-test:
  `(can*|isOwner|isEditor|isViewer|editable|readOnly|viewOnly|disabled|locked|interactive|allow*) = true|false`.
  - It returns exactly the 13 destructuring defaults design.md lists: the 12 from round 1 plus `isOwner`.
  - Optional role props (`?:`) are found only in those components' prop interfaces, `stepCardTypes.ts`
    (StepCardFocused's own props) and `usePipelineDraftSave.ts:43`.
  - `OutputEditorSheet`'s `isPipelineOwner` already defaults to `false` (fail-closed).
  - `shared/`, `features/ask`, `app/` and `hooks/` contain no such default.
  - Outside the pipeline page there is one: `features/panels/.../usePanelDetailEditState.ts:20`. It is correctly
    listed as a non-goal.
- **No flip removes a control from an owner or an editor.** I listed every non-test call site of each component and
  hook (`grep "<X\b|X("`). Each one passes the prop, derived from the role:
  - StepCardFocused: PipelineSpineLayout.tsx:290 and MobileStepSheet.tsx:80. Both pass `isOwner={page.isOwner}` and
    `readOnly={!page.canEdit}`.
  - `useSpineStepActions`: `canEdit: page.canEdit` at both layouts.
  - PipelineSpineHeader: `canEdit={page.canEdit}`.
  - SpineStatusStrip: `canRun={canRunFromUi(page.runRole)}` at both layouts.
  - PipelineSpine: `canEdit={page.canEdit}` at both layouts. It forwards `readOnly={!canEdit}` to SpineSourceCard and
    SpineOutputs.
  - OutputEditorSheet: `readOnly={!page.canEdit}` (PipelineDetailDialogs.tsx). It forwards `readOnly` to
    OutputEditorFooter and OutputSheetPreviewCard.
  - OutputHistoryModal: `readOnly={!page.canEdit}`.
  - RunHistoryModal and MobileRunsTab: `canRun={canRunFromUi(...)}`.
  - `usePipelineDraftSave`: only usePipelineDetailSaveWiring.ts:75, which passes `runRole`.
  - `page.canEdit` is `canEditFromUi(runRole)` (usePipelineDetailPage.ts:62).
  - The only caller that omits the prop is the test harness `test/conditionalFormatsEditorHarness.tsx:68`, which
    task 1.4 covers.
- **The tests can be non-vacuous, and the plan requires each one to be red.**
  - Copy-only defaults gate only copy, so a copy assertion is the right signal: OutputHistoryModal:54,
    OutputSheetPreviewCard:62, RunHistoryList:187.
  - Control defaults gate real controls:
    - SpineStatusStrip:34 (run control);
    - useSpineStepActions:136 (menu items);
    - PipelineSpineHeader:76-219 (rename, schedule, menu);
    - SpineSourceCard:82/104 and SpineOutputs:107;
    - OutputEditorFooter:35;
    - the StepCardFocused fieldset (`disabled={isCreating || readOnly}`, :136-138);
    - UpsertSourceConfig:137/161 (`isOwner`).
  - Task 3.4 requires a red run for each default flipped back on its own.
- **The e2e scan change is correct.**
  - `scan()` currently skips on `.disabled || closest("fieldset[disabled]")` (spec :113). `SELECTOR` (:77) has no
    `summary`.
  - `:disabled` matches only the form-associated controls a disabled fieldset actually disables. It does not match
    controls in the first legend, or links, summaries, `[role=button]`, draggables and contenteditables.
  - Both disabled fieldsets on the viewer page are real: `.step-focused__fieldset` (under `main` on desktop) and
    `output-editor-sheet__fieldset` (in `dialog[open]`).
- **The e2e proof is red first.** Under the old scan, a link or summary planted in a disabled fieldset is skipped, so
  the D4 self-test is red. Mutations (a) restore the fieldset skip and (b) drop `summary` each turn it red again. The
  planted-input assertion catches a scan that over-reports. The round-1 notes on planting are adopted: plant and scan
  in one evaluate, use a visible fieldset under a scan root, and keep the input outside the legend.
- **The comment fix is accurate.** `viewerCopy.test.ts` pins one entry's two strings, then loops over every entry
  asserting `viewer !== edit` and `/\b(add|edit|run the)\b/i`. Its header ("every viewer variant, with the
  editor/owner string beside it") overstates this, as D6 says.
- **No product decision is made that nobody asked for.**
  - The flips change no behavior on the real page, because every caller passes the prop.
  - D3 adds only pure navigation or disclosure to ALLOWED, and escalates anything that is a product call.
  - "Fix a found viewer edit affordance if small" follows HEL-1794's existing requirement and is not a new product
    call.

### Verdict: CONFIRM

### Non-blocking notes

1. **The guard as worded fails on the post-change tree.** D5 and 3.2 say: "an optional role prop in a file with no
   matching fail-closed default". `stepCardTypes.ts` declares `isOwner?:` (:14) and `readOnly?:` (:40), but their
   defaults are in StepCardFocused.tsx. A file-local check would therefore report it.
   - Fix: pair the interface file with its consumer explicitly (a small, commented map).
   - Do not loosen the check to "a default anywhere in the feature".
   - Also make the guard's scope agree: D5 says `features/pipelines/ui/**`, but 3.2 says `features/pipelines`, and
     `runRole?:` lives in `hooks/`.
2. **StepCardFocused has two defaults.** The `isOwner` test must pass `readOnly={false}` explicitly. If it does not,
   the disabled fieldset disables the "existing dataset" radio whatever `isOwner` is, and the test cannot turn red when
   only `isOwner` is flipped back. Task 3.4's per-default red run forces this; say it in 3.1.
3. **D1a's reason is inconsistent.** It says "hooks already follow the required-role rule", but `useSpineStepActions`
   (a hook in `ui/spine`) keeps an optional `canEdit` and only flips the default. That is harmless; either make it
   required too, or word D1a as "the data-layer hook".
4. **The D4 self-test must run the same in-page scan code as `scan()`, not a copy.** Factor the in-page body out so
   that plant + scan run in one evaluate. Mutations (a) and (b) are applied to `scan()` itself, and turning the
   self-test red is what proves the code is shared.
