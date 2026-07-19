## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/portal-popover-hook/spec.md`, and the
  round-1 `skeptic-design-1.md` (treated as a claim, re-verified from scratch).
- **Root-cause diagnosis**: read `frontend/src/features/panels/ui/PanelCreationModal.css:12-25` — confirmed
  `.panel-creation-modal[open] { animation: panel-creation-modal-in var(--transition-slow) both; }`. Read
  `frontend/src/shared/ui/Modal.css:13-20` — confirmed `backwards` with the rationale comment. Ran
  `git show d7fb3816` — commit message independently states the identical mechanism ("Native `<dialog>` modals
  run an entrance animation with `animation-fill-mode: both`, which left a lingering `transform` on the
  dialog... Switch the fill to `backwards`"). The design's diagnosis and proposed fix match this precedent
  exactly. **Correct.**
- **Audit re-verification** (did not trust the design's claims — reran independently):
  - `grep -rln "<dialog" src --include=*.tsx` → `PanelCreationModal.tsx`, `PanelDetailModal.tsx`, `Select.tsx`,
    `Modal.tsx` (+ test files). Grepped `animation` across all 5 `PanelDetailModal*.css` split files — zero
    matches. Confirms "no transform animation, unaffected."
  - `grep -rln "usePortalPopover" src` → `Select.tsx`, `UserMenu.tsx`, `DashboardAppearanceEditor.tsx`,
    `ActionsMenu.tsx`. Read each: only `Select.tsx:51` conditionally targets `triggerRef.current.closest("dialog[open]") ?? document.body`; the other three always `createPortal(..., document.body)`. Confirms those three
    are never affected.
  - `grep -rln 'shared/ui/Modal"' src` → `CreatePipelineModal`, `RunHistoryModal`, `PipelinePreviewModal`,
    `PipelineShareDialog`, `ProposalReview`, `AddSourceModal` — all compose the already-fixed shared `Modal`.
  - Conclusion: the audited scope (one afflicted file, `PanelCreationModal.css`) is accurate.
- **Spec delta**: compared `specs/portal-popover-hook/spec.md` (change dir) against
  `openspec/specs/portal-popover-hook/spec.md` (base) — the MODIFIED requirement extends the existing
  requirement's text and name without contradicting it; the new scenario's coordinates
  (`top: rect.bottom+4-equivalent, left: rect.left`) match `usePortalPopover`'s actual `handleOpen` computation
  (confirmed by reading `usePortalPopover.ts` in round-1 evidence, re-confirmed by proposal/design text matching
  the hook's documented behavior).
- **AC coverage**: AC1 (alignment at 390×844) → tasks 2.1/2.2; AC2 (audit every call site) → task 1.2 +
  design.md Risks section (already contains the audit result); AC3 (regression coverage) → task 3.1 + spec
  delta scenario. All three ACs trace to concrete tasks.
- `git status --short` — only the untracked change directory exists; no code changed yet, consistent with this
  being a design-gate review.

### Verdict: REFUTE

The diagnosis, fix, and audit are all correct and represent a real improvement over round 1 — the planner
properly investigated the `Modal.css`/d7fb3816 precedent this time and the "one file" scope is accurate. One
concrete, actionable gap remains in the regression-test plan (AC3).

### Change Requests

1. **tasks.md — 3.1** (and the corresponding risk note in **design.md:71-73**): both specify the Jest
   regression test as asserting the dialog's "**resolved** `animation-fill-mode`" is not `both`/`forwards`.
   This is not feasible as worded: `frontend/jest.config.js` maps all `.css` imports to
   `src/test/styleMock.js`, which is `module.exports = {}` (confirmed by reading both files) — no real
   stylesheet is ever loaded into jsdom for component tests, so `getComputedStyle` cannot observe
   `animation-fill-mode` from `PanelCreationModal.css` at all in that environment. A test written literally per
   this instruction would either not compile against anything meaningful, or — worse — assert against jsdom's
   default/inherited value and trivially pass regardless of what the actual CSS file contains, giving false
   confidence and catching nothing if the fix regresses. This is exactly the "test that passes without
   exercising the fixed path proves nothing" failure the `systematic-debugging` law warns about, and it directly
   undermines AC3 ("Regression coverage for popover position relative to trigger inside a dialog").

   The codebase already has the correct, established pattern for this exact class of problem: a static
   CSS-source-text test using `fs.readFileSync` + regex/brace-matching on the raw `.css` file, precisely because
   "jsdom implements no real layout... no DOM-rendering Jest test can observe [CSS properties]" (verbatim
   comment in `frontend/src/shared/chrome/ActionsMenu.css.test.ts:4-8`, the HEL-308 regression guard). The same
   pattern exists in `PanelDetailModal.css.test.ts`, `inputs.css.test.ts`, and `MobileNavSheet.css.test.ts`.

   Revise task 3.1 to specify: add a `PanelCreationModal.css.test.ts` (mirroring `ActionsMenu.css.test.ts`)
   that reads the raw CSS source via `fs.readFileSync` and asserts, via regex, that the `.panel-creation-modal[open]` rule's `animation` declaration uses `backwards` fill mode (not `both`/`forwards`). Revise
   design.md's risk note (lines 71-73) to name this concrete mechanism instead of the infeasible
   "resolved `animation-fill-mode`" (computed-style) framing, and note that real pixel-alignment verification
   remains a Playwright/evaluator/skeptic responsibility (this part of the risk note is otherwise fine and
   should be kept).

### Non-blocking notes

- The spec delta's new scenario ("Popover portalled into a modal dialog aligns to its trigger") describes true
  runtime alignment behavior that, per the above, the Jest suite cannot directly exercise (no real layout/CSS
  in jsdom) — it's satisfied in practice by the combination of the static CSS-source test (change request 1)
  plus the evaluator/skeptic's Playwright verification at 390×844. Consider a one-line note in the spec or
  design.md making this split of responsibility explicit so a future reader doesn't expect the scenario to be
  Jest-covered end-to-end.
- Everything else in the revision (root-cause section, Decisions/Alternatives, Non-Goals, Impact,
  audit-driven Risks section) is sound, accurate against ground truth, and directly resolves round 1's findings.
