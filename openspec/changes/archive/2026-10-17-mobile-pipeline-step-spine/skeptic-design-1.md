## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 3d9e5a6cb1b4a95c343856283a074c8d663e801f (planning artifacts uncommitted in the change dir).
`openspec validate mobile-pipeline-step-spine --strict` → "Change 'mobile-pipeline-step-spine' is valid".

### What I verified (with evidence)

- **Ticket, board, standard.** I read ticket.md, proposal/design/tasks, the 3 spec deltas, PipelineMobile.png (approved board),
  HANDOFF.md (row 2 "Pipeline detail — mobile | Approved → HEL-1582"), DESIGN.md §3 (Surfaces, Control metrics), §10 and §12,
  the baseline (baseline.md, shot-375x812-dark.png) and premise-validation.md.
- **Phone code paths today.** `PipelineDetailPage.tsx` (phoneLayout = PipelineDetailHeader + tabs + PipelineRiverView /
  OutputsGalleryTab + PipelineDetailFooter), and the HEL-1579 pieces `PipelineSpineLayout`, `PipelineSpineHeader`, `PipelineSpine`,
  `SpineSourceCard`, `SpineOutputs`, `SpineStepRow`, `SpineLane`, `SpineStatusStrip`, `SpineRunStatus`, `useStepSelection`,
  `useRunHistory`, and `shared/ui/Modal.tsx` + `Modal.css`.
- **Jest coverage that runs through the river.** `grep -rl installPhoneShell frontend/src` → 9 test files, about 183 tests:
  PipelineDetailPage.test.tsx 132, .switch 15, .draftCreate 12, .createPlacement 8, .stepsError 7, .creatingStep 4,
  .shapeReparent 3, .reorderGuard 1, and PipelineDetailPage.spine.test.tsx:709 ("still renders the river view…").
  PipelineDetailPage.test.tsx:375-377 says they assert "the phone layout … and layout-independent page logic reached through the
  phone's card DOM". None of this appears in tasks.md.
- **Spec "Layout scope (HEL-1579)" paragraphs.** There are 41 of them in 19 capabilities (grep). I mapped each one to its
  requirement. Several carry obligations that are not about layout and have to keep holding on a phone:
  pipeline-run-truncation-reporting "A persisted row count is never displayed without its truncation context",
  pipeline-editor-page "Pipeline detail boot requests are bounded" and "A step card cannot be expanded while its create is in
  flight", pipeline-step-validation-display (×2), pipeline-step-warning-display, pipeline-step-schema-diff,
  pipeline-lane-editor-ui "Analyze and validation render on every lane", and pipeline-schedule-config-ui "Schedule bar shows
  current schedule state" (desktop text: "It is never hidden").
- **Schedule on phone.** Today's phone header shows a Schedule row (baseline screenshot: "Schedule  No schedule set"). D2's new
  header has no schedule state at all. Only the overflow items Set/Edit and Pause/Resume remain.
- **Source/Output card actions.** `SpineSourceCard` puts Edit source and Remove from pipeline in a quiet `ActionsMenu`.
  `SpineOutputs` puts History in a menu, plus a "+ Output" button. D4 restyles both cards "to the board (… chevron)" and says
  nothing about those menus. The spec requirement for the Steps tab lists neither.
- **Partial-count marker.** `SpineStepRow` puts `partial` only into the button's aria-label (SpineStepRow.tsx:73). The visible
  marker is the `TruncatedRowCountBadge` in `.spine-section__heading` (PipelineSpine.tsx), which is exactly where D4 makes
  things sr-only.
- **Modal composition (D6).**
  - `Modal` closes the native dialog synchronously when `open` goes false (Modal.tsx sync-open effect), so an exit animation
    needs BottomSheet to keep Modal open on its own side.
  - Modal.css:13-18 records that a lasting transform on the dialog makes it the containing block for `position: fixed` Select
    popovers portalled into it, which then sit in the wrong place. Every step editor uses `Select`.
  - The close button is `IconButton size="sm"`, and IconButton.css:103 already gives it a phone `::after` expander, so the
    ≥44px close is achievable without editing Modal.
  - HEL-1584's branch (60b6059bc) edits Modal.css: a Subtle `animation-name` override and `ui-modal--expanding`. That is a merge
    surface, not a scope collision.
- **Runs tab loader (D8).** `useRunHistory.openRunHistory` runs `setHistoryOpen(true)` and then loads (useRunHistory.ts:114-117).
  Calling it opens the modal. No "load without opening" export exists; `retryRunHistory` always reloads.
- **Added-step detection (D5).** The "a step that appears becomes selected" logic, including the AI-step temp-id → server-id swap
  resolved through `renderKey`, lives inside `useStepSelection` (useStepSelection.ts:58-110). D5 says phone does not use that hook
  and will "mirror" it.
- **e2e list in D9.** I grepped e2e/ for river selectors. Beyond the 6 named specs, hel968 (with a phone 375/430 touch test) and
  hel912 (375/430 lane stacking) also hit the river, but both are quarantined in playwright.config.ts:116 and :136. hel1345 runs on
  desktop. hel1277 crosses to 375 with a dialog open, which still works because the dialogs stay a sibling. The D9 list is
  adequate.
- **Height budget (D4/AC1).** My pessimistic estimate at 375×812:
  - Assumptions: real source card about 88px (name, kind and sample-label line), rows 64px, output card 76px (3 lines), 12px
    gaps.
  - The list ends at about 636px.
  - The bar sits at `bottom: var(--space-2)` on a page that ends at 744 (baseline), so its top is 696.
  - That leaves about 60px of margin, which is sound. PR #1052's diff does not touch `--bottom-nav-height` or `.app-content`
    padding (grep of `gh pr diff 1052`), so "clears the nav by construction" holds for now. D7's re-measure step covers the rest.
- **Opaque Dry run (D7).** DESIGN.md §3 says "Every other surface … stays fully opaque; this carve-out does not widen". The ticket
  says DESIGN.md v3 is binding, and "glass" is in the ticket's What, not in an AC. Opaque is the right call.
- **HEL-1631 slot (D7).** I read HEL-1631 in Linear. It wants "Draft · unsaved changes", Discard and Save & run. A
  `data-slot="draft-status"` row above the pills, a pill row whose two positions HEL-1631 swaps, and clearance driven by the
  measured bar height together fit that.

### Verdict: REFUTE

The direction is right and most of the decisions hold:
- the board fidelity
- the opaque pill
- the slot
- the height budget
- composing Modal
- deleting the river in this change (leaving it would be dead code, and the test fallout below happens whether or not the files
  are deleted)

Eight planning gaps need fixing first. Two are large (the jest coverage and the spec supersession). The rest are ambiguities a
competent implementer could get wrong, and some of those wrong readings would not show up in the planned gates.

### Change Requests

1. **Plan the about 183 jest tests that drive page logic through the phone river (tasks.md has no task for them).**
   - Swapping `phoneLayout` breaks every test in the 9 `installPhoneShell` files listed above.
   - That includes reorder (HEL-407), disable/duplicate (HEL-412), insert-at-position (HEL-410), dirty/Cancel confirm, beforeunload,
     Run/dry-run/status, the schedule bar, Share, root removal (HEL-968), the AI deferred create (HEL-1109), the switch/keying
     tests (HEL-1483), and more.
   - Add a task that sorts each `describe` block into one of three groups:
     - (a) layout-independent logic, retargeted to the desktop spine DOM or the new phone DOM with no weakened assertion;
     - (b) phone-specific behaviour, ported to the new phone layout;
     - (c) river-only, deleted, with the replacement test named.
   - Record the mapping in evidence.
   - Invert PipelineDetailPage.spine.test.tsx:709 so it asserts the new phone layout.
   - Task 5.3's "no edits to their assertions" cannot hold for these files, so say so explicitly.

2. **The superseding requirement ("River view and phone footer are retired") must not exempt the phone from obligations that are
   not about layout.**
   - As written, "at or below 768px the behaviour is the one specified here" drops, for phones, every obligation that a
     Layout-scope paragraph moved into desktop-only text.
   - Turn the default around: the desktop-side obligations of those paragraphs apply at ≤768px unless this capability says
     otherwise.
   - Name at least these: truncation context on counts, the boot-request bound, the create-in-flight guard, inline
     validation/warnings/schema-diff on every lane, and schedule-state visibility.
   - The full rewrite of the 41 paragraphs can stay a follow-up, but file that ticket now and cite its id in proposal.md Non-goals
     and design.md Risks. Today it is an unnamed "follow-up".

3. **Schedule state disappears on phone (a regression against today's phone header and against the desktop "never hidden").**
   - Show the schedule state on the phone page: "Add schedule" / the expression / a "Paused" marker, with full state in the title.
   - For example, reuse `SpineScheduleChip` in its compact icon form on header row 2, or as a line in the status line.
   - Add it to the "Phone pipeline detail header" requirement with a scenario for a paused schedule.
   - If you think it should stay hidden to match the board, that is a product call and needs escalating, not self-approving.

4. **Say exactly what the Source and Output cards do on phone.**
   - Spec and design must say:
     - what tapping the card (and its chevron) does;
     - that per-root Edit source and "Remove from pipeline" stay reachable on each Source card, which you need with 2+ roots
       because the overflow's Edit source exists only for a single root;
     - that each Output card keeps "History for <name>";
     - that "+ Output" stays.
   - All of them go into the 44px sweep. Today D4's "restyled to the board (… chevron)" can fairly be read as replacing the menus,
     which would silently drop multi-root removal and Output history on phone.

5. **Make the D6 gesture mechanism work on real touch, and state the transform and exit rules.**
   - (a) A pointer-event drag on a scrollable body gets `pointercancel` once the browser claims the pan (any `touch-action` that
     allows pan-y), whatever the `scrollTop`. So the "body at scrollTop 0" path cannot work as designed. Pick one:
     - implement it with a non-passive `touchmove` that calls `preventDefault` only when scrollTop is 0 and dy > 0, and prove it
       with a CDP touch drag in e2e;
     - or drop the body path from the motion-primitives requirement and its "Scrolled body scrolls" scenario (handle + header
       still satisfy AC2).
   - Specify `touch-action: none` on the handle and header.
   - (b) At rest the sheet must have no transform: remove the inline style, never leave `translateY(0)`. Modal.css:13-18 explains
     why: a transform containing block mis-anchors portalled `Select` popovers, and every step editor has one. Add a test.
   - (c) State that BottomSheet keeps `Modal`'s `open` true through its exit animation. Modal closes synchronously, so this is the
     only way to get an exit animation without editing Modal.
   - (d) State the order for a swipe or close that the consumer vetoes: request close first, and if the request is vetoed, spring
     back.
   - (e) State how BottomSheet's entrance overrides `.ui-modal[open]`'s `ui-modal-in`, including HEL-1584's
     `:root[data-motion="subtle"] .ui-modal[open]` rule.

6. **Define the sheet's step identity and when a new step opens.**
   - "Removing the open step closes the sheet" plus a `sheetStepId` stored as `step.id` will close the sheet when an AI step's temp
     id is swapped for its server id (HEL-1109). The desktop resolves that swap through `renderKey` (useStepSelection.ts:77-83).
   - Key the open sheet by `stepRenderKey`, or resolve it the same way.
   - Extract `useStepSelection`'s added-step detection into a shared helper rather than re-implementing it (D1 says "No handler is
     re-implemented").
   - Either include duplicate and shape-created steps (the desktop selects them) or say why the phone differs.

7. **D8: say what the Runs tab calls to load.**
   - `openRunHistory` opens the Run history modal (useRunHistory.ts:114-117).
   - Add a non-opening `ensureRunHistoryLoaded` (load only if not fresh) to `useRunHistory` and use that.
   - Add a unit test that activating Runs leaves `historyOpen` false.

8. **Keep the partial-count marker visible on phone.**
   - With D4's sr-only eyebrows, define what happens to the rest of `.spine-section__heading`: the "N steps" text and
     `TruncatedRowCountBadge`.
   - The badge must stay visible, because rows mark "partial" only in their aria-label (pipeline-run-truncation-reporting).
   - Add a scenario: truncated latest run, phone, partial marker visible.

### Non-blocking notes

- **AC2 evidence.** "Renders in jsdom" does not prove "editable at 375". Consider an e2e geometry sweep: every op kind's editor in
  the open sheet at 375, with no horizontal overflow and every control inside the sheet's bounds. The river did render these
  editors at phone width, so the risk is moderate.
- **Where `useSpineStepActions` lives.** It must live at `PipelineMobileLayout` level, not inside the Steps tab. The header
  overflow's Add source and Add Outputs from a shape have to work while Preview or Runs is active, and the sheet's Step actions
  menu needs `menuItemsFor`/`useLaneReorder`.
- **Long run errors.** A failed run's error log in a one-line status ("Failed: …") will be truncated. Make sure the full text is
  reachable (title, or the Runs tab).
- **Scenario name.** pipeline-detail-spine-layout delta: rename the scenario "Phone layout unchanged". A MODIFIED block replaces
  the whole requirement, so the old name need not be kept, and the current name contradicts its own body.
- **Telling HEL-1631.** HEL-1631's text puts the draft status "in the header". When this ships, record on HEL-1631 that on phone
  the slot is the action-bar `draft-status` row.
- **Opaque Dry run.** Agreed (DESIGN.md §3). Put the reason in the PR body so the deviation from the board's "glass" is visible to
  the owner.
