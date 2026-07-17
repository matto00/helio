## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Ticket AC alignment.** Read `ticket.md` (updated 2026-07-17 wording: "no broken or misleading
  edit affordance" not "remove it"). `proposal.md` and `design.md` Decision 3 and tasks 2.1–2.4 use
  the exact updated language — no stale "remove the edit button" framing anywhere in the artifacts
  (`grep`-checked).
- **All 5 ACs trace to tasks:**
  1. MobileNavSheet ≥44px → tasks 1.1/1.2, spec delta `mobile-dashboard-sheet`.
  2. Honest edit affordance → tasks 2.1–2.4, spec delta `mobile-viewer-stack`.
  3. Panel-kind sweep + height tuning (incl. collection) → tasks 3.1–3.5.
  4. Token compliance → tasks 4.1–4.2.
  5. Layout byte-identity guard → design.md Decision 6 + tasks 5.4/5.5.
- **No placeholders/hand-waving.** `grep -rniE "TODO|TBD|figure out|placeholder"` across the change
  dir returned nothing.
- **No internal contradictions.** Read the existing `mobile-viewer-stack/spec.md` in full: the
  "Stack panels are read-only" requirement (no drag/resize/title-edit/delete on the card, but tapping
  opens the detail modal) is consistent with the new "Phone-width edit affordances are honest"
  ADDED requirement — the latter governs the modal's edit paths, not the card itself. No overlap or
  conflict with the pre-existing "Panel-field edits staged... persist without any layout write"
  requirement either.
- **Mechanism-reuse claims verified against real code, not assumed:**
  - `frontend/src/shared/chrome/MobileNavSheet.css:100` — confirmed `.mobile-nav-sheet__item` uses
    `min-height: var(--control-lg)` today, matching design.md's stated current state.
  - `frontend/src/features/panels/ui/PanelDetailModal.css:616+` — confirmed the exact HEL-245
    `@media (max-width: 768px) { min-height: 44px; }` literal-px pattern (with rationale comment)
    the plan says to mirror.
  - `MobilePanelStack.css.test.ts` / `PanelDetailModal.css.test.ts` exist and are the stated
    style-lock precedent for the new `MobileNavSheet.css.test.ts` (task 5.1).
  - `frontend/src/features/panels/ui/mobilePanelHeights.ts` — confirmed metric = 120px (within
    stated ~104–132px band), chart clamp(200, w×0.62, 340) with h-modulation — matches
    `openspec/specs/mobile-panel-sizing/spec.md`'s stated bands exactly, confirming Decision 4's
    premise (constants currently within-band, so no delta yet needed) is accurate, not asserted.
  - `MobileNavSheet.css:69–72` — confirmed the `.mobile-nav-sheet__grabber` `36px`/`4px` literals
    Decision 5 calls out as a sanctioned non-token exception actually exist.
  - `MobilePanelStack.tsx` — confirmed it holds no `useLayoutSave`/`markLayoutChanged` import path,
    supporting Decision 6's "no changes to mount/save paths" framing; tapping a panel opens
    `PanelDetailModal`, matching the edit-affordance audit's described flow.
  - `PanelDetailModal.tsx:319–322` — confirmed an `aria-label="Edit panel"` control exists today,
    giving task 2 a concrete, real target to audit rather than an invented one.
- **Capability names match reality.** `openspec/specs/{mobile-dashboard-sheet,mobile-viewer-stack,
  mobile-panel-sizing,mobile-bottom-nav}` all exist; the proposal's Modified Capabilities section
  references only real, existing capability directories.
- **Scope discipline.** Non-goals explicitly exclude behavior/backend changes, new mobile editors,
  new tokens/breakpoints, and HEL-306; tasks and design.md consistently defer non-trivial bugs to
  spinoff tickets rather than inline fixes (Decision 3, tasks 2.3/2.4). The conditional
  `mobile-panel-sizing` spec delta (only added if tuning exceeds the stated band) is a reasonable,
  well-justified openspec convention for an evidence-gated tuning pass, not scope creep.
- **No stray/uncommitted noise.** `git status --short` shows only the new change directory;
  `git diff main...HEAD --stat` is empty (no premature code changes at design gate, as expected).

### Verdict: CONFIRM

### Non-blocking notes

- Task 2 doesn't explicitly say what to do if the "Edit panel" button (`PanelDetailModal.tsx:319`)
  itself is under 44px or ambiguous about content vs. layout scope — but this is exactly what tasks
  2.1–2.3 are designed to discover and fix in-flow, so it's appropriately left to execution rather
  than pre-specified.
- Design.md Decision 1 asserts the phone-width media gate on `.mobile-nav-sheet__item` is "arguably
  redundant" since the sheet only renders below 768px (confirmed via `App.tsx` — the sheet is
  state-gated by `isMobileNavSheetOpen`, not itself breakpoint-CSS-gated, so the media query is a
  belt-and-suspenders convention match, not dead weight). No action needed — this is explicitly
  called out and accepted in the design, not an oversight.
