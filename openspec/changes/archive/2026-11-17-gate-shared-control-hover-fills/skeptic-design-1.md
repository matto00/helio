## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD fd3fbe7d098e6518cfd5ea44469a5a398cde2742 (no implementation commits yet; artifacts uncommitted in the change dir).

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` returned `READY ... branch=task/gate-shared-hover-fills/HEL-1675`.
- **Inventory of the four shared files (design Context) is accurate.** `grep -n ':hover'`:
  IconButton.css:62/73/85 (3), ActionsMenu.css:62/80 (2), Modal.css:230/242/256 (3, the only hover rules in the file),
  inputs.css:30-32 (one 3-selector rule, border-only) and :145-146 (`.ui-select__option:hover, .ui-select__option--focused`,
  the mixed list). 3+2+3+3+1 = 12 hover selectors, so the D3 non-vacuity floor of 12 is correct.
- **(a) Gate-in-place preserves desktop hover.** A `@media` block adds no specificity and, when it matches, leaves
  source order untouched, so desktop resolves identically. Consumer overrides of these classes with `:hover` exist in
  `app/App.css:202-210, 557-558` (command bar border reset / dark surface-strong), `app/shell/ContextList.css:43-58`,
  `features/panels/ui/grid/PanelGrid.css:327`, and `features/pipelines/ui/spine/PipelineSpine.css:404-410` (already
  gated). All are higher-specificity or later-loading overrides that are unaffected on desktop. On touch they keep
  applying as before (none is a reveal; the command-bar/context-list ones are border resets that are harmless at rest).
  D1 is sound.
- **D2 split** is correct: `--focused` is the keyboard active-descendant state and must stay ungated.
- **Tidy items exist as described:** `PipelineMobile.css:474-486` and `PipelineSpineHeader.css:280-292` both have the
  paired `--primary:hover` blocks, and the merged declaration set in D6 (`border-color: transparent; background:
  var(--app-accent-strong); color: var(--app-accent-ink)`) computes the same as the pair. `PipelineSpineHeader.css:1-3`
  still says "Below ~1100px the meta text truncates". `SpineSourceCard.tsx:44` calls `useSourceSampleLabel` and
  `:88` renders `<SourceSampleLabel>`, which calls it again (`SourceSampleLabel.tsx:25`), so there are two hooks and two
  timers per card. `e2e/hel1668-header-meta.spec.ts:114` logs `GAP`, and the only assertions at 1280 are
  `nameTruncated` (`countVisible` is asserted at 1440 only).
- **(c) Dropping `useTopModalDialog` narrowing is justified.** `useTopModalDialog.ts:46` observes `document.body`
  subtree because modal `<dialog>`s mount in-tree wherever their owner renders, so there is no single narrower root
  without a registry. That growth matches the "tidy item that grows goes to a follow-up" rule. Accepted.
- **(d) Spine-area edits are small:** two CSS blocks plus a comment, one `SpineSourceCard.tsx` call-site change, and no
  edit to `pipelineDraft.ts`, draft hooks or draft preview. `SourceSampleLabel` has no caller other than
  `SpineSourceCard` (grep of imports), so "stays hook+view for other callers" is moot but harmless.
- **(b) Controls actually in the phone step sheet:** `MobileStepSheet.tsx` renders `BottomSheet` (Modal) with a ghost
  `IconButton` close button (`Modal.tsx:250-252`) and an `ActionsMenu` in `headerActions`. The menu items are Move
  up/down, Insert before/after, Branch from here and Add output (`useSpineStepActions.tsx:121-189`), with no danger
  item. `ui-modal-btn` appears only in page-level dialogs such as `PipelineDraftDialogs.tsx` (cascade confirm and leave
  guard), never inside the sheet itself.

### Verdict: REFUTE

### Change Requests

1. **The AC is narrowed without authority, and the most-tapped shared control in the sheet is missing.** The AC is
   "No sticky hover after a tap on **any** shared control in the sheet". The sheet's "Step actions" trigger
   (`ActionsMenu.tsx:167`, `className="popover__trigger actions-menu__trigger"`) gets its fill from
   `shared/chrome/Popover.css:21-24`:
   `.popover__trigger:hover { border-color: var(--app-border-strong); background: var(--app-surface-soft); }`.
   That rule is ungated. The only gated override is `.mobile-header .popover__trigger:hover`
   (`PipelineMobile.css:68-69`), which is the page header, not the sheet header. The trigger stays mounted when tapped,
   since tapping opens the menu, so it is the canonical sticky-hover case. Popover.css is not in scope and not even in
   the follow-up list. Add `Popover.css` to the gated set, the guard's FILES and the e2e, and update the floor from 12.
   Then **enumerate every shared stylesheet with an ungated `:hover` whose control renders inside
   `.mobile-step-sheet`**, and either gate it here or name it explicitly as deferred with a reason that reconciles with
   the "any" in the AC. Candidates I found but did not fully trace:
   - `shared/ui/disclosureSummary.css:40` (`OutputSchemaDisclosure` sits in the sheet's `StepPreviewTable`)
   - `shared/ui/SegmentedRadioGroup.css:40` (used by `ComputeFieldConfig`, `GenerateTextConfig`, `DateBucketConfig`
     and others)
   - `shared/ui/DataGrid.css:609, 641` (filter buttons) and `SortableTh.css` (the preview grid)
   - `shared/chrome/InlineError.css:51` (the retry button, if any sheet caller passes `onRetry`)

   The proposal Non-goals currently defer DataGrid by name even though a DataGrid renders in the sheet. Narrowing "any"
   to "the four listed" is a scope call the planner cannot make silently. Either cover the in-sheet set or make the
   narrowing an explicit, recorded decision. If it cannot be settled from the ticket, raise it as an escalation rather
   than self-approving it.

2. **D4: name the concrete in-sheet instance for each control, and say what happens when red cannot be produced.**
   D4 currently leaves "e.g. reopening at the same point" to the executor. Specify:
   - IconButton: which ghost or secondary instance stays mounted after a tap. The close button unmounts the sheet.
   - ActionsMenu item: which item, and how the red is observed after the menu closes.
   - `ui-modal-btn`: which dialog is reachable from the sheet, and the path to open it from the sheet. The only
     candidates are page-level (`PipelineDraftDialogs`), so the "reached from the phone step sheet" scenario must name
     the route.
   - Select trigger: which step kind's config the seeded pipeline uses so that a Select is present.
   - Popover trigger, per CR1.

   Add an explicit rule: if a control cannot be shown red on the unchanged CSS through a real sheet interaction, the
   executor must not count it as covered. It must record that, and the design must say what substitute evidence is
   acceptable (for example the guard plus a probe of the bare rule) or route it to an escalation. Otherwise
   "red first per control" can silently become red for two controls and asserted for the rest. Also state which tap
   primitive the spec uses (`realTap` from `e2e/support/hel1668.ts:150`, or plain `tap`), as measured red on the real
   surface.

3. **tasks.md has no task to file the follow-ups** that the proposal and design rely on: the wider shared `:hover`
   sweep (toast, MobileNavSheet, and whatever CR1 defers) and the `useTopModalDialog` narrowing. Add a task with an
   acceptance signal (the follow-up ticket ids recorded in the PR body or `files-modified.md`). An unfiled follow-up is
   a silently dropped ticket item.

4. **The spec delta's first scenario must match the revised control list.** It names IconButton, ActionsMenu item,
   modal footer button and Select trigger. Add the ActionsMenu/Popover trigger and any other in-sheet controls brought
   into scope by CR1. Update the Purpose line too, which lists only the four.

### Non-blocking notes

- D3: say whether the shared guard's FILES list is the exact set of files gated by this change (so a later ungated rule
  added to one of them fails), and keep the mutation proof per file, not just "one shared rule".
- D6 / task 2.4: name which measurement the 1280 assertion bounds (for example `trailingLeft - boxRight` or
  `boxRight - timeRight`). "The measurement it already logs" covers several fields.
- The desktop "equal to the pre-change values" comparison should cover both themes. D4 says light and dark for touch
  only.
