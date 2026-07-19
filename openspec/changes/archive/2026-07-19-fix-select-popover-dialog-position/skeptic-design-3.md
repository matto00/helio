## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/portal-popover-hook/spec.md`, and both
  prior skeptic reports (`skeptic-design-1.md`, `skeptic-design-2.md`) — treated as claims, re-verified below.
- **Round-1 fix (root-cause vs. straw-man alternative)**: confirmed `design.md`'s Decisions section now
  adopts the CSS fill-mode fix (`design.md:44-59`) instead of the earlier JS containing-block-compensation
  approach, and explicitly documents the rejected JS alternative with reasoning. Confirmed against ground
  truth by reading `frontend/src/shared/ui/Modal.css:14-22` (contains `animation-fill-mode: backwards` and the
  exact rationale comment quoted in design.md) and `frontend/src/features/panels/ui/PanelCreationModal.css:12-14`
  (still `both` — unfixed, as expected pre-implementation, and matches the described defect).
- **Round-2 fix (regression-test feasibility)**: confirmed `tasks.md` §3.1 and `design.md`'s risk note
  (lines 71-75) now specify a static CSS-source assertion via `fs.readFileSync`, explicitly citing
  `ActionsMenu.css.test.ts` as precedent. Read `frontend/src/shared/chrome/ActionsMenu.css.test.ts` in full —
  confirmed it is exactly the pattern described (reads raw `.css` via `fs.readFileSync`, brace-matches to a
  rule body, regex-asserts a CSS property), validating that the newly-specified approach is a real, working
  pattern already proven in this codebase rather than an untested proposal.
- **AC coverage, re-traced**: AC1 (alignment at 390×844) → tasks 1.1/2.1/2.2, spec scenario "Popover portalled
  into a modal dialog aligns to its trigger". AC2 (audit every Select-inside-dialog site) → task 1.2, with the
  audit's expected result already recorded in design.md's Risks section (PanelDetailModal unaffected — no
  transform animation; shared-Modal dialogs unaffected — already `backwards`; ActionsMenu/UserMenu/
  DashboardAppearanceEditor unaffected — always portal to `document.body`). AC3 (regression coverage) →
  task 3.1 (static CSS-source test) plus the explicit note that true pixel alignment is an
  evaluator/skeptic Playwright responsibility, not a Jest one — this division of labor is now stated plainly
  in design.md rather than left implicit (addresses round-2's non-blocking note as a bonus).
- **Internal consistency**: proposal.md's "What Changes"/Impact sections, design.md's Decisions/Risks, and
  tasks.md's three sections all agree on the same scope (one CSS file, one-line change, no JS/API changes) —
  no contradictions found between the artifacts.
- `git status --short` confirms only the untracked change directory exists; no code has been touched yet,
  consistent with a design-gate review before implementation.

### Verdict: CONFIRM

Both round-1 and round-2 findings were substantively incorporated and independently verified against ground
truth (not just re-stated). The plan is a minimal, root-cause-correct, precedent-backed fix with a workable
regression test and a complete, re-confirmed audit. All three acceptance criteria trace to concrete tasks. No
new blocking issues found.

### Non-blocking notes

- None beyond what's already captured in design.md's Planner Notes (follow-up spinoff ticket to fold
  `PanelCreationModal` into the shared `Modal` primitive) — reasonable to leave as a follow-up rather than
  in-scope here.
</content>
