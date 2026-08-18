## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/modal-size-scale/spec.md` in full.
- Read the actual current implementation the design is grounded in:
  `frontend/src/shared/ui/Modal.tsx`, `Modal.css`,
  `frontend/src/features/panels/ui/PanelCreationModal.tsx` (627 lines) and
  `.css` (689 lines), `frontend/src/features/panels/ui/PanelDetailModal.tsx`
  (428 lines) and `.css`/`.appearance.css`/`.binding.css`/`.sections.css`/
  `.mobile.css`, and `frontend/src/features/panels/hooks/
  usePanelDetailModalLifecycle.ts`.
- Cross-checked design.md's factual claims against the source: current size
  scale (`sm`=420/`md`=540/`lg`=720, width-only, all via
  `min(<px>, calc(100vw - 32px))`), `PanelCreationModal`'s hand-rolled
  `showModal`/backdrop-click/`onCancel`-intercepting/manual Tab-wrap-trap
  `<dialog>` (lines 191-302), `usePanelDetailModalLifecycle`'s `dialog`-scoped
  `cancel`/`click`/`keydown` listeners (lines 51-106) — all confirmed
  accurate.
- Confirmed `PanelDetailModal.css`'s two variants' actual pixel dimensions:
  `.panel-detail-modal { width: min(540px, 96vw); height: min(680px, 90vh); }`
  and `.panel-detail-modal--view { width: min(1200px, 96vw); height: min(88vh,
  900px); }` (lines 1-15) — matches design.md's Context section exactly.
- Read `openspec/specs/modal-dismiss-interactions/spec.md`,
  `panel-detail-keyboard-shortcuts/spec.md`, and
  `panel-detail-modal-css-structure/spec.md` — the three specs design.md
  declares "Modified Capabilities: none" for.
- Checked test infrastructure: `Modal.test.tsx` stubs
  `HTMLDialogElement.prototype.showModal`/`close` in jsdom (jsdom does not
  implement native dialog focus containment at all); `PanelCreationModal.
  test.tsx` tests 2.7/2.8 (lines 1169-1206) currently assert the *manual*
  Tab-wrap trap's JS behavior by querying `FOCUSABLE` elements and firing
  synthetic `keydown` events — this is testable today only because the trap
  is hand-written JS, not native browser behavior.
- Confirmed via `grep -rln "<dialog"` across `frontend/src` that the only
  literal `<dialog` JSX elements in the app are in `Modal.tsx`,
  `PanelCreationModal.tsx`, and `PanelDetailModal.tsx` — AC #2's scope
  ("no hand-rolled `<dialog>` outside `Modal.tsx`") is correctly bounded; no
  other component was missed.
- Confirmed `panel-detail-modal-css-structure`'s ~400-line budget is scoped
  by its own spec text to `PanelDetailModal*.css` files specifically, so
  `PanelCreationModal.css`'s current 689 lines is not a violation of that
  requirement.

### Findings

**1. Design/tasks contradiction: `PanelDetailModal`'s fixed per-mode height has no owner after migration (blocking).**

`design.md` Decision 1 and `tasks.md` 1.1 define the *entire* scope of what
gets added to `Modal.css` for the new `xl`/`full` presets: a `width` rule
only, following the existing `min(<px>, calc(100vw - 32px))` pattern — the
same pattern every existing `sm`/`md`/`lg` preset already uses (confirmed:
`Modal.css` has no `height` rule per size, only a blanket
`.ui-modal { max-height: 90vh }` cap; actual height today is content-driven
shrink-wrap up to that cap).

`PanelDetailModal.css`, by contrast, sets an explicit **fixed** height per
mode, not a cap: `height: min(680px, 90vh)` in edit/base mode and
`height: min(88vh, 900px)` in view mode (confirmed above), with
`.panel-detail-modal__inner { height: 100%; }` and
`.panel-detail-modal__view-body { flex: 1; ... }` filling that fixed box
regardless of content length.

`tasks.md` 3.5 nonetheless instructs the executor to delete
`PanelDetailModal.css`'s `width`/`height` rules for both variants because
they are "now owned by Modal.css's `md`/`full` sizes" — but task 1.1 never
gives Modal.css's size classes a `height` rule at all, for any size,
existing or new. This is an internal contradiction the executor will hit
immediately on task 3.5: following task 1.1 literally leaves no fixed-height
rule anywhere, so a `PanelDetailModal` in view mode with short content (e.g.
a small chart, a handful of table rows) would shrink-wrap to content height
instead of holding its current ~900px fixed box — a visible resize the
design's own stated Goal ("pixel-equivalent... no unexpected resize") and
the ticket's AC #1 ("open/close/animate/trap-focus identically to every
other `Modal`-based surface") explicitly rule out.

This needs a decision the design doesn't currently make: either (a) give
`Modal`'s size classes explicit height rules too (a materially bigger change
than "extend the size scale," and one that would change every other
existing `Modal` consumer's height behavior from content-driven to fixed —
directly contradicting the stated Non-Goal "No change to any other existing
`Modal` consumer's behavior"), or (b) keep a `PanelDetailModal`-scoped height
override (via the `className` prop `Modal` already exposes) layered on top
of `Modal`'s width-only size classes — which is the opposite of what task
3.5 currently tells the executor to delete. The design needs to pick (b) (or
some equivalent) explicitly and correct task 3.5's framing before
implementation starts; as written, a competent implementer following the
tasks literally produces a real visual regression.

**2. Non-blocking but worth flagging: the focus-trap regression coverage for `modal-dismiss-interactions` disappears with no replacement plan.**

`modal-dismiss-interactions`'s spec (unmodified by this change, per design.md's
"Modified Capabilities: none") has an explicit, scenario-backed requirement:
"Tab cycles forward... focus moves to the first focusable element,"
"Shift+Tab cycles backward... focus moves to the last." Today this is
automated-tested (`PanelCreationModal.test.tsx` 2.7/2.8) because the trap is
hand-written JS. `tasks.md` 2.2 deletes that JS trap in favor of native
`<dialog>` containment, and 4.2 says to "remove/replace" the associated
assertions. But `Modal.test.tsx`'s own header comment confirms jsdom does not
implement native `showModal`/focus-containment (it's stubbed as a bare
`jest.fn()`), so there is no way to *replace* tests 2.7/2.8 with an
equivalent automated jsdom test after the trap moves to native containment —
they can only be deleted, leaving this spec's two explicit scenarios with
zero automated regression coverage going forward. design.md's Risk #3
acknowledges the native-vs-manual behavioral-equivalence risk and calls it
"acceptable" by analogy to the 13 other `Modal` consumers — but none of
those has a spec asserting this exact wrap-around contract the way
`modal-dismiss-interactions` does for this one, so the analogy undersells
what's being given up. This doesn't have to block execution, but the design
should say explicitly how this loss of automated coverage will be verified
(e.g., a real-browser/Playwright check the evaluator or skeptic runs at the
final gate) rather than leaving it purely to "every other consumer already
relies on this."

### Verdict: REFUTE

### Change Requests

1. **Resolve the `PanelDetailModal` height-ownership gap before execution.**
   Update `design.md`/`tasks.md` to state explicitly how `.panel-detail-modal`'s
   fixed `height: min(680px, 90vh)` (base/edit) and
   `.panel-detail-modal--view`'s `height: min(88vh, 900px)` survive the
   migration — most likely by keeping a `PanelDetailModal`-scoped height rule
   applied via `Modal`'s `className` prop, layered on top of (not replacing)
   `Modal`'s width-only `md`/`full` size classes. Correct task 3.5's
   "now owned by Modal.css's md/full sizes" framing, since task 1.1 as written
   never gives Modal.css's size classes a height rule for any size.
2. **State the verification plan for the lost focus-trap automated
   coverage.** `modal-dismiss-interactions`'s Tab/Shift+Tab wrap-around
   scenarios currently have automated (jsdom-testable) coverage that this
   change removes with no automated replacement possible (jsdom stubs
   `showModal`, so it cannot exercise native dialog focus containment).
   Either add an explicit manual/real-browser verification step the
   evaluator or skeptic runs at the final gate, or otherwise state in
   design.md why relying purely on "every other `Modal` consumer already
   does this" is sufficient despite this spec's existing test-backed
   contract being unique among those consumers.

### Non-blocking notes

- `PanelCreationModal.css`'s current width rule (`max-width: 720px;
  width: 100%`) is not byte-for-byte identical to `Modal`'s `lg` preset
  (`min(720px, calc(100vw - 32px))`) at narrow viewports (no 32px margin vs.
  a 32px margin) — worth a quick visual check at <720px width during
  execution, though not a design-level blocker.
- Consider updating `Modal.tsx`'s JSDoc comment (currently documents only
  `sm(420px) | md(540px) | lg(720px)`) to include `xl`/`full` once added.
