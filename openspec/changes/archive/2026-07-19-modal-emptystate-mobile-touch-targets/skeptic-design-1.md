## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **Ticket AC alignment** — `ticket.md` lists three sub-44px targets
   (`.ui-modal__close`, `.ui-modal-btn`, `.ui-empty-state__cta`) with 4 acceptance
   criteria (rendered ≥44px both themes on a bottom-nav route, desktop unchanged,
   CSS-lock tests, npm test/lint/format pass). `proposal.md`, `design.md`, `tasks.md`,
   and `specs/modal-emptystate-touch-targets/spec.md` all cover exactly these three
   controls and all four ACs — traced task-by-task (tasks 1.1–1.3 → code changes;
   2.1–2.2 → CSS-lock tests; 3.1–3.2 → verification). No AC left uncovered, no
   scope drift beyond the ticket.

2. **Current CSS ground truth matches every numeric claim in the plan** — read
   `frontend/src/shared/ui/Modal.css` and `frontend/src/shared/ui/EmptyState.css`
   directly:
   - `.ui-modal__close` (Modal.css:97-113): `width: var(--control-sm); height: var(--control-sm);` no existing mobile media block in the file.
   - `.ui-modal-btn` (Modal.css:142-156): `height: var(--control-md);` no existing mobile media block.
   - `.ui-empty-state__cta` (EmptyState.css:94-109): `height: var(--control-md);` and the sidebar override (EmptyState.css:116-120) `.ui-empty-state--sidebar .ui-empty-state__cta { height: var(--control-sm); }`.
   - Token values confirmed via `grep -n "\-\-control-sm:\|\-\-control-md:" src/theme/theme.css` → `--control-sm: 28px; --control-md: 32px;`. This exactly matches the 28px/32px/32px figures asserted in ticket.md, proposal.md, and design.md.

3. **Precedent fidelity** — read `frontend/src/shared/ui/inputs.css.test.ts` and
   `frontend/src/shared/chrome/ActionsMenu.css.test.ts` (the cited HEL-308/314
   precedent tests). Both use the identical `findMediaBlock`/`findRuleBody`
   brace-matching pattern the design doc proposes reusing for the new
   `Modal.css.test.ts` / `EmptyState.css.test.ts`. The design's plan is a faithful,
   mechanical continuation of an already-proven pattern, not a novel approach.

4. **Closing-audit provenance** — read
   `openspec/changes/archive/2026-07-19-sweep-mobile-touch-targets/audit.md` lines
   58-74. It flags exactly these three controls with the same sizes (28px / 32px /
   32px-main-28px-sidebar) and the same phone-reachable call sites, and explicitly
   recommends this as a follow-up ticket "if the pipeline/source management flows
   are to be treated as first-class phone surfaces" — matching this change's stated
   motivation. The audit also flags `.ui-input`/`.ui-textarea` as borderline and
   explicitly out of scope for this sweep; the proposal correctly does not touch
   `inputs.css` text-field heights, so there is no silent scope creep picking up
   that flagged-but-deferred item.

5. **"Phone-reachable" claim verified** — `grep`'d for `EmptyState` usage:
   `TypeRegistryBrowser.tsx`, `PipelineEmptyState.tsx` (used by `PipelinesPage.tsx`),
   and `SourcesPage.tsx` all use the `EmptyState` main variant and are reachable via
   bottom-nav routes, confirming the CTA claim. `SidebarItemList.tsx` uses
   `variant="sidebar"` — and `App.css` (`grep -n "768px" App.css` → line 366,
   `.app-sidebar` hidden at `max-width: 768px`, lines 394-396) confirms the sidebar
   column is genuinely not mounted on phone, validating the design's "defensive,
   not required" framing for flooring the sidebar CTA via the base selector.

6. **No collision with existing mobile overrides** — read
   `frontend/src/features/panels/ui/PanelDetailModal.mobile.css` in full. Its
   HEL-303 mobile-tap-target rules use distinct BEM classes
   (`.panel-detail-modal__close`, `.panel-detail-modal__btn`, etc.) — a separate,
   standalone modal implementation that does not reuse `.ui-modal__close` /
   `.ui-modal-btn`. No double-application or specificity fight with the new rules.
   Confirms proposal's non-goal ("no changes to already-covered
   `.panel-detail-modal`-scoped overrides") is accurate, not just asserted.

7. **CSS mechanics of the "defensive floor" decision** — the design proposes adding
   `min-height: 44px` on the base `.ui-empty-state__cta` selector inside the mobile
   media block, which (per CSS `min-height`/`height` interaction — different
   properties, not a specificity contest) will floor the more-specific
   `.ui-empty-state--sidebar .ui-empty-state__cta { height: var(--control-sm) }`
   rule regardless of its higher selector specificity, since the used height is
   `max(height, min-height)`. This is technically sound (and, per point 5, moot
   in practice since the sidebar is unmounted at ≤768px).

8. **768px breakpoint is the ratified mobile-shell breakpoint** — `DESIGN.md` line
   156-157 references "sub-768 phone breakpoint" per HEL-300; consistent with the
   design/proposal's chosen breakpoint and every precedent file inspected.

9. **No placeholders/hand-waving** — proposal, design, tasks, and spec are fully
   concrete: exact selectors, exact property/value pairs, exact file paths, no
   `TODO`/`TBD`/deferred decisions that would block implementation.

10. **Spec scenarios are testable** — each of the 4 requirements has a phone-viewport
    scenario (measurable via `getBoundingClientRect()`, per task 3.2) and a
    desktop-preserved scenario, plus a CSS-lock-removal scenario. All are concrete,
    falsifiable, and mapped 1:1 to tasks.

### Verdict: CONFIRM

### Non-blocking notes

- Task 3.2's rendered verification (getBoundingClientRect at 390×844, both themes)
  is described as a manual/browser-driven check; the executor/evaluator should
  capture this evidence (e.g. Playwright script output or screenshots) rather than
  asserting it, consistent with the verification-before-completion law.
- The design's rationale for skipping a shared `--tap-target` token (would touch
  more files than this surgical sweep) is reasonable and consistent with prior
  HEL-308/314 precedent, which also used literal `44px`.
