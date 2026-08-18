## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/modal-size-scale/spec.md` in full, fresh (not from round 1's report,
  though I read `skeptic-design-1.md` afterward to confirm what it claimed).
- Re-read the ground-truth source the design is grounded in:
  `frontend/src/shared/ui/Modal.tsx` and
  `frontend/src/features/panels/ui/PanelDetailModal.css` /
  `PanelDetailModal.tsx`.

**Change Request 1 (blocking): PanelDetailModal's fixed per-mode height ownership.**

- Confirmed `Modal.tsx`'s `dialogClass` construction exactly as design.md's
  Decision 1 now describes: `["ui-modal", \`ui-modal--${size}\`, className ??
  null].filter(Boolean).join(" ")` (`Modal.tsx` lines ~78-80) — `className`
  genuinely composes alongside the size class today, so a
  `PanelDetailModal`-scoped height override applied via `className` is
  mechanically sound, not hand-waved.
- Confirmed `PanelDetailModal.css`'s height rules are selector-scoped to
  `.panel-detail-modal` (`height: min(680px, 90vh)`) and
  `.panel-detail-modal--view` (`height: min(88vh, 900px)`) — both plain class
  selectors, not tied to any `Modal`-owned size-class selector, so keeping
  them while deleting only `width`/border/background/shadow/backdrop/
  animation (as tasks.md 3.5 now says) does not create a CSS specificity
  conflict with `Modal.css`'s new `ui-modal--md`/`ui-modal--full` width rules
  (disjoint properties, disjoint selectors).
- Confirmed the current component already applies both classes together:
  `className={\`panel-detail-modal${modalMode === "view" ? "
  panel-detail-modal--view" : ""}\`}` (`PanelDetailModal.tsx` line 313) — the
  base class is always present, `--view` is additive in view mode. This is
  the same pattern design.md's Decision 1 describes carrying forward onto
  `Modal`'s `className` prop, so the plan is directly derivable from code
  already in the file, not an invented mechanism.
- tasks.md 3.5 now reads: remove border/background/shadow/backdrop/`[open]`
  animation/**width** (owned by `Modal.css`'s `md`/`full` size classes) "but
  KEEP each class's `height` rule ... `Modal`'s size presets are width-only
  (no size owns a height), so `PanelDetailModal` keeps its own fixed-height
  CSS, applied via `Modal`'s `className` prop." This directly reverses round
  1's contradiction (round 1's task 3.5 said height was "now owned by
  Modal.css's md/full sizes," which was false since task 1.1 never gives
  Modal.css's sizes a height rule). The fix is substantive, not cosmetic: it
  changes what the executor is told to delete vs. keep, and states the
  concrete mechanism (className layering) rather than asserting an ownership
  transfer that never happens in task 1.1.
- design.md Decision 1's added paragraph states the same resolution with the
  same reasoning (bigger-change / non-goal-violating alternative explicitly
  rejected), so design.md and tasks.md now agree with each other and with the
  actual `Modal.tsx` mechanics. **Genuinely resolved.**

**Change Request 2 (non-blocking, required a stated verification plan): lost jsdom coverage for Tab/Shift+Tab wrap-around.**

- design.md's Risk 4 now states explicitly: "the final-gate Skeptic (and the
  Evaluator's UI-review pass) MUST manually verify, via Playwright against
  the running dev server, that Tab from the last focusable element wraps to
  the first (and Shift+Tab from the first wraps to the last) inside the
  migrated `PanelCreationModal`, and record that check in its report."
- tasks.md 4.5 mirrors this as a non-optional task, additionally requiring
  the *executor* to run the same check first and record it in their own
  verification notes "so the Evaluator/Skeptic can confirm it at their own
  passes."
- This is a concrete, checkable replacement plan (not "trust the browser"),
  and it is consistent between design.md and tasks.md — both name Playwright
  against the running dev server as the mechanism and both name the
  final-gate Skeptic as a required verifier. **Genuinely resolved**, not
  merely asserted.

**No new issues introduced by the revision.**

- Grepped `design.md`, `tasks.md`, `proposal.md`, `ticket.md`, and
  `specs/modal-size-scale/spec.md` for `TODO`/`TBD`/"figure out"/"to be
  decided"/"placeholder" — no matches.
- `specs/modal-size-scale/spec.md` is unchanged from round 1 and still
  correctly covers only the three genuinely new/changed capabilities (size
  scale, vetoable `onClose`, `headerActions` slot); it makes no height claim,
  consistent with the "no new capability, no spec delta" treatment of the
  height decision (which is implementation detail of an unmodified
  capability, `panel-detail-modal-css-structure`).
- `proposal.md` (unchanged this round) still doesn't contradict the revised
  `design.md`/`tasks.md` — it never asserted a height-ownership claim to
  begin with, so nothing there needed updating.
- tasks.md's task numbering, cross-references, and the 400-line CSS budget
  reminder in 3.5 are all still internally consistent; task 4.5's
  cross-reference to "tasks.md 4.2/4.5" in design.md's Risk section correctly
  points at itself and its sibling task.
- `workflow-state.md` confirms this is round 2 of a 3-round budget
  (`SKEPTIC_DESIGN_ROUNDS: 3`), consistent with the orchestrator's stated
  `N=2`.

### Verdict: CONFIRM

Both round-1 change requests are resolved with substantive, mechanically
verified fixes — not cosmetic rewording. Design and tasks now agree with each
other and with the actual `Modal.tsx`/`PanelDetailModal.css` code they're
grounded in. No new contradictions, ambiguities, or scope drift were
introduced by the revision.

### Non-blocking notes

- (carried over from round 1, still applicable, still non-blocking)
  `PanelCreationModal.css`'s current width rule (`max-width: 720px; width:
  100%`) is not byte-for-byte identical to `Modal`'s `lg` preset (`min(720px,
  calc(100vw - 32px))`) at narrow viewports (no 32px margin vs. a 32px
  margin) — worth a quick visual check at <720px width during execution.
- Task 3.1's abbreviated `<Modal ... />` JSX snippet doesn't spell out the
  `className={...}` prop explicitly (it elides with `...`), even though
  Decision 1 and task 3.5 both depend on it being passed
  (`"panel-detail-modal"` / `"panel-detail-modal--view"` toggling with
  `modalMode`, mirroring the existing template-literal pattern at
  `PanelDetailModal.tsx:313`). This is derivable from the surrounding text
  and the existing code pattern, not a genuine ambiguity — but the executor
  should not overlook it since 3.1's snippet doesn't list it by name.
