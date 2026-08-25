## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Re-derived from code, not from the orchestrator's revision summary.

- **Code facts underlying round 2's CR1 re-confirmed.**
  - `frontend/src/features/panels/state/panelsSlice.ts` — `status: "idle" | "loading" | "succeeded" | "failed"`;
    `fetchPanels.rejected` sets `state.items = []` and `state.status = "failed"`. Gate is real and correctly typed.
  - `frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx` — all edit-mode state is component-local
    `useState`: `modalMode` (:81), `title`/`background`/`color`/`transparency`/`chartAppearance` (:97-101),
    `isSaving` (:126), `subtypeDirty` (:127), `showDiscardWarning` (:132).
  - `frontend/src/features/panels/ui/grid/DesktopPanelGrid.tsx:302-312` — modal is `key={detailPanelId}`, with the
    in-code HEL-307 comment confirming the remount/re-seed intent. So an unmount (or a key change) discards all of
    the above. The corrected mechanism as now stated in design.md is accurate.
- **design.md prose corrections — ACCURATE.** The new "Correction (design-gate round 2)" block (:~82-100) and the
  rewritten Risk bullet (:~145-158) both state the unmount mechanism correctly, scope out edit-state preservation
  explicitly, and no longer claim "no data loss" or "renders blank". Good.
- **tasks.md 3.3 third bullet — SATISFIED.** Now asserts only observable behavior (loading -> failed ->
  succeeded-with-panel-present; nothing throws at each step; modal shown again after recovery) and explicitly names
  the modal's reappearance as the proxy for `detailPanelId` surviving. This is genuinely RED-able against an
  ungated effect.
- **specs/panel-detail-modal/spec.md — SATISFIED.** Requirement prose now distinguishes "not rendered while the
  backing panel is unresolvable" from "not permanently dismissed", carries the explicit unsaved-edits-not-preserved
  parenthetical, and the renamed scenario ("Modal recovers, rather than being permanently dismissed, ...") is
  observable and non-contradictory. Other three scenarios unaffected and still consistent.
- **Swept for residual instances of the false claim** (`grep -rn "unsaved\|discard"` across proposal/design/tasks/spec).
  Two sites still assert the refuted mechanism — see Change Requests. Everything else is either the corrected prose
  or the legitimate, unrelated discard-confirmation-prompt semantics.
- **Nothing else newly broken.** Goals/Non-Goals, the CR1/CR2 fixes from round 2 (Jest-as-gated-coverage, cross-actor
  simulation), the alternatives, and the Planner Notes are unchanged and remain consistent with the corrected text.

### Verdict: REFUTE

The substantive correction landed in all three called-out places and is factually accurate. But the sweep the
orchestrator was asked to make ("everywhere it previously appeared") missed two sites that still assert the exact
claim round 2 refuted. One of them is inside the code snippet the executor is expected to transcribe, so the false
rationale would ship as a source-code comment; the other is the implementation task's own justification. Both are
one-sentence edits.

### Change Requests

1. **`design.md:52-58` — the code-snippet comment still states the refuted rationale.** Inside the `useEffect`
   snippet the executor will copy into `DesktopPanelGrid.tsx`, the comment reads: *"never on 'loading'/'failed', so
   a network hiccup doesn't silently discard unsaved edit-mode state."* That is precisely the claim disproved in
   round 2 and retracted 30 lines later in the same file — a transient window discards that state regardless of the
   gate, because the unconditional render guard unmounts the modal. Because this is snippet text destined for the
   source file, leaving it means shipping a comment that misdescribes what the gate does. Rewrite the trailing
   clause to the correct rationale, e.g. *"never on 'loading'/'failed', so a network hiccup doesn't permanently
   dismiss the modal — `detailPanelId` survives the transient window and the modal reopens once the panel is
   confirmed still present. (It does not preserve unsaved edit-mode state; the render guard unmounts the modal
   either way — see the Correction below.)"*

2. **`tasks.md:17-22 (task 2.1)` — the implementation task repeats the same refuted justification.** It states the
   gate *"excludes a transient `fetchPanels` 'loading'/'failed' window ... from force-closing the modal and
   discarding unsaved edit-mode state"*. Same false claim; also still cites "`design.md`'s revised Decision
   (design-gate round 1)" when the operative text is now the round-2 correction. Restate as: excludes the transient
   window from *permanently* closing the modal (`detailPanelId` is preserved so the modal reopens once the panel is
   confirmed still present); unsaved edit-mode state is not preserved across the unmount either way and is out of
   scope. Update the cross-reference to design.md's round-2 Correction.

### Non-blocking notes

- `proposal.md`'s Impact bullet still lists only *"New Playwright regression test exercising the real open-modal →
  delete-panel interaction path"*, whereas tasks 3.1/3.2 (correctly, per round 1's CR1) make the **Jest**
  `DesktopPanelGrid` test the gated regression guard and demote Playwright to evidence. Worth adding the Jest test
  to the Impact list so the proposal doesn't imply the ungated suite is the guard. Not blocking — tasks.md governs
  execution and is unambiguous.
- Round 2's informational `markDashboardPanelsStale` edge (`status = "idle"` without clearing `items`) is still
  unmentioned. Still non-blocking (render guard covers it; no crash), but a one-line note in design.md would keep
  "`succeeded` is the only settled state" from reading as complete.
