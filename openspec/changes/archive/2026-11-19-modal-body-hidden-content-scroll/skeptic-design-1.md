## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 94a8ef292ba5475e3906c2aa5760110a9d23abe9 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/modal-hidden-content-scroll/HEL-1774`.
- **Mechanism claims hold against the live code.**
  - `frontend/src/shared/ui/Modal.css:187-191`: `.ui-modal__body` is `flex: 1; overflow-y: auto; padding` with no `position`. `.ui-modal__inner` (`:131-136`) is not positioned either. `Modal.tsx:261-282` matches the stated structure.
  - `frontend/src/theme/theme.css:731-741`: `.sr-only` is `position: absolute` with **no insets**, so it sits at its static position. `Toggle.css:22` `.ui-toggle__input` is the same, and `.ui-toggle` is not positioned.
  - `OutputEditorSheet.css:27-34`: HEL-1763's group rule is present as described.
  - HEL-1763 Resolution (`.concertino/runs/HEL-1763/evidence/openspec/changes/fix-output-preview-canvas-scroll/design.md:49-56`) puts the escaping elements in the History and Ask groups, which sit low in a scrolling body. That fits the static-position mechanism.
- **Claim: `position: relative` does not re-anchor `position: fixed` popovers.** I checked this in Chromium with a minimal reproduction: a modal `<dialog>` with a body that is `position: relative; overflow-y: auto`, offset 150 px. A `position: fixed; top: 10px; left: 10px` child measured at `{top: 10, left: 10}`, so it is anchored to the viewport, not the body. The claim is confirmed, and rejecting `contain` is correct, because `contain` does create a fixed containing block.
- **Consumer list:** `grep -rlnE "<Modal\b|<BottomSheet\b" frontend/src --include=*.tsx` (tests excluded) finds 30 files. Every component named in design.md Context is in that list. Two consumers already override `.ui-modal__body`: `BottomSheet.css:49` (padding, overscroll) and `CommandPalette.css:25` (flex). Neither sets `position`, so the shared rule would apply to both. Task 1.1's grep covers the inventory.
- **Regression specs named in Decision 5 exist:** `hel1763-output-editor-preview-scroll`, `hel1752-output-editor-footer-fit`, `hel1668-phone-sheet`, `hel909-output-picker-panel-sheet`, `hel773-top-anchored-mobile-nav-sheet`. `Modal.css.test.ts` exists and already parses `Modal.css` statically.
- **AC coverage:** AC1 is covered by Decision 1 and tasks 1.x. AC2 is covered by Decision 2 and tasks 3.x. AC3 is covered by Decision 4 and tasks 2.1 and 4.x. No scope drift. CSS only, so no contract delta is needed.
- **The "future hidden element" guard cannot go red as specified (see CR1).** I measured this in Chromium at 375x812. The reproduction copies the shared modal's layout: the dialog is a flex column with `max-height: 90vh`, `.inner` is `flex: 1 1 auto; min-height: 0`, and the body is `flex: 1; overflow-y: auto; padding: 20px`. An `.sr-only` span is the body's last child:

  | body content | body `position` | dialog scrollHeight / clientHeight |
  |---|---|---|
  | 100 px (short, no body scroll) | none (unfixed) | **240 / 240 — no defect** |
  | 2000 px (body scrolls) | none (unfixed) | **2038 / 731 — defect** |
  | 100 px | relative | 240 / 240 |
  | 2000 px | relative | 731 / 731 |

  A hidden absolute element only escapes when its static position lies below the body's visible clip. That requires a body that overflows. In an "otherwise-short modal" it lands inside the visible content, and the dialog is not stretched even with the shared rule removed.

### Verdict: REFUTE

### Change Requests

1. **design.md Decision 4, "future hidden element" case, and tasks.md 2.1/4.3:** the injected `.sr-only` case is specified in "an otherwise-short modal". The measurements above show that case is green on unfixed CSS. Two claims fail as a result:
   - Decision 4's mutation (a) claim ("remove the shared rule → the injected-element case ... go red") is false.
   - The case cannot discriminate.

   This matters for AC3. HEL-1763 already fixed the Output editor naturally, so if the inventory finds no other naturally red modal, this injected case is the only discriminating guard for the shared rule. Revise the case so that the body overflows before the injection, for example:
   - inject a tall in-flow spacer (taller than the body's client height) followed by the `.sr-only` span as the body's last child; or
   - choose a modal whose body already scrolls at the test viewport.

   Keep scrollTop at 0. Then state in Decision 4 and task 2.1 that this case must be red in the committed red run (dialog scrollHeight greater than content bottom by much more than the tolerance), not merely run. Update the spec scenario "Hidden element added outside any positioned wrapper" so its WHEN names a body whose content overflows. As written, it is satisfiable by a test that can never fail.

### Non-blocking notes

- Decision 2 says the rule moves "exactly" the absolute descendants whose containing block is currently the dialog. In-place (non-portalled) absolute popovers with no positioned ancestor will also become clipped by the body's `overflow-y: auto`. The Risks section already covers this. Make sure the inventory's "Moved children" table records clipping, not only rects.
- `BottomSheet` animates/settles via `transform` on the dialog (`BottomSheet.css` `[data-sheet-settling]`). That already makes the sheet a fixed containing block mid-gesture, independent of this change. It is worth noting in the popover probe so a pre-existing mid-drag offset is not misattributed to the new rule.
- Mutation (b) (remove shared rule and HEL-1763 group rule → Output editor red) is plausible: HEL-1763's own red run exists at `.concertino/runs/HEL-1763/evidence/.concertino/scratch/HEL-1763/skeptic-red-run.txt`.
