## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Inventory re-derived myself** (not trusted from the artifacts), in the worktree:
  `grep -rl "@fortawesome" frontend/src | wc -l` → **57**; distinct `fa*` symbols → **67**;
  `grep -rl "lucide-react" frontend/src | wc -l` → **35** (design.md/proposal.md say 32 — off
  by 3; non-blocking, but the number is stale as written). Scope decision itself not
  re-litigated, per the driver ruling.
- **Is a shared icon-size util net-new?** `grep -rn "ICON_SIZE\|iconSize\|ICON_SIZES" frontend/src`
  → zero hits; `ls frontend/src/shared/ui/` shows no size module. D2 is genuinely net-new — agreed.
  `DESIGN.md` has no glyph-size scale either (only `--control-*` hit-target tokens, line 234).
- **How icons are sized today** — `frontend/src/shared/ui/IconButton.css:38-53` and
  `frontend/src/shared/ui/SortableTh.css` (read in full).
- **`IconButton.tsx`** read: renders `<span aria-hidden="true" className="ui-icon-btn__icon">{icon}</span>`.
- **`SortableTh.tsx`** read in full (three-state glyph, `aria-sort`, `aria-hidden` icon).
- **`faClone`/`faCopy` adjacency** — `grep -rln faClone` → **only** `features/pipelines/state/stepNarrowing.ts`;
  `grep -rln faCopy` → `ApiTokensSection.tsx`, `MfaBackupCodesList.tsx`, `MfaEnrollModal.tsx`,
  `DashboardShareDialog.tsx`, `pipelines/ui/StepCard.tsx`.
- **Off-scale sizes in lucide-only files** — enumerated the 27 lucide files with no FA import:
  `app/Sidebar.tsx` (16×3), `features/dashboards/ui/ProposalReview.tsx` (15),
  `features/panels/ui/OutputPicker.tsx` (18×4, 28), `features/sources/ui/SourceDetailPanel.tsx` (13).
- **`IconDefinition` typed prop contracts** — 7 files: `pipelines/types/step.ts`,
  `shared/chrome/{SidebarItemList,pickerEmptyState,MobileNavSheet}.tsx`,
  `shared/ui/{EmptyState.tsx,EmptyState.test.tsx,PageStatus.tsx}`.
- **Task 11.1's pointer** — `frontend/e2e` does not exist (root `e2e/` does);
  `grep -rln HEL-520 frontend/src e2e` → hits only `Modal.test.tsx`, `PipelineDetailHeader.css`,
  `tokenAuditSweep.css.test.ts`, i.e. no e2e "focus-presence mechanism" to reuse.

### Verdict: REFUTE

The migration direction, the capability split (`icon-system` vs `icon-button`), the spec scenarios'
form, and D4's red-before-green posture are all sound. What blocks execution is that the design
models the swap as *component substitution + a `size` prop*, when the codebase currently sizes
FontAwesome glyphs through **CSS `font-size`** — a mechanism lucide ignores. That contradiction sits
directly inside D2 and is unaddressed anywhere in design.md or tasks.md, and it touches a large
fraction of the 57 files.

### Change Requests

1. **D2 is factually wrong about `IconButton`, and the CSS sizing mechanism is missing from the
   design.** `frontend/src/shared/ui/IconButton.css:38-53` sizes the glyph via the variant's
   `font-size` (`--xs` → `--text-sm`, `--sm` → `--text-base`, `--md` → `--text-lg`); that IS the
   current glyph-size mechanism for every `FontAwesomeIcon` passed into `IconButton`. D2's claim
   that the `xs`/`sm`/`md` scale is "a distinct, unrelated scale … untouched by this change" does
   not hold: after the swap, lucide renders an SVG whose size comes from `size`/`width`/`height`,
   not `font-size`, so those rules become dead and every `IconButton` glyph silently falls to
   lucide's 24px default unless each call site is given an explicit size. Add a decision that
   (a) states which `ICON_SIZE` value pairs with each `IconButton` variant, (b) says what happens
   to the now-dead `font-size` declarations (removed, or replaced by an `svg { width/height }` rule
   on `.ui-icon-btn__icon`), and (c) picks one of those two mechanisms as canonical so call sites
   and CSS don't disagree. Add the corresponding task under section 3.

2. **`SortableTh` has the same CSS-sizing trap, with a documented prior regression.**
   `frontend/src/shared/ui/SortableTh.css` sizes `.sortable-th__glyph` with
   `font-size: var(--text-xs)`, and its comment records HEL-1022's follow-up where a relatively
   sized glyph computed to an illegible 7px. A straight component swap silently reverts that fix
   in the opposite direction (24px glyph in a 10px header). Task 3.2 currently asks only for a
   "three-state visual check"; extend it (and any other file whose CSS sizes an icon) to require
   the CSS rule be migrated per CR1's canonical mechanism, and note the HEL-1022 history so the
   executor doesn't re-open it.

3. **Spec Requirement 2 is broader than the task list, so the change ships violating its own
   spec.** `specs/icon-system/spec.md` says *"Every `lucide-react` icon instance SHALL be sized via
   [the] shared size constant … rather than an arbitrary inline `size` literal"*, but tasks.md
   enumerates only the 57 FontAwesome files. There are 27 lucide-only files, four of which carry
   literals outside {14,16,20}: `app/Sidebar.tsx` (16×3 — compliant value, still a literal),
   `features/dashboards/ui/ProposalReview.tsx` (`size={15}`),
   `features/panels/ui/OutputPicker.tsx` (`size={18}`×4, `size={28}`),
   `features/sources/ui/SourceDetailPanel.tsx` (`size={13}`). Resolve one way: either add a task
   normalizing these existing lucide call sites, or narrow the requirement's stated scope (and say
   so in Non-Goals) so it doesn't assert something the change knowingly leaves false.

4. **No decision covers the `IconDefinition` → lucide prop-type change, which is a real API shape
   change, not a substitution.** Seven files type an icon as a *data object* passed as a prop and
   rendered centrally (`pipelines/types/step.ts`, `shared/chrome/{SidebarItemList,pickerEmptyState,
   MobileNavSheet}.tsx`, `shared/ui/{EmptyState,PageStatus}.tsx` + `EmptyState.test.tsx`).
   lucide's equivalent is a *component type* (`LucideIcon`), so the prop type, every producer, and
   every render site change shape together, and the size/`aria-hidden` treatment moves from the
   consumer to the producer or vice versa. Add a decision (D6) fixing the replacement type and
   where sizing/`aria-hidden` is applied for these prop-passed icons; the current tasks list the
   files but give the executor no contract to implement against.

5. **The flagged `faClone`/`faCopy` collision is misattributed — the real one is elsewhere.**
   design.md's Risks section says the collision is in `OutputGalleryCard.tsx` or
   `RunHistoryModal.tsx`; `faClone` appears in exactly one file,
   `features/pipelines/state/stepNarrowing.ts:114` (the `dedupe` step-op icon), and neither of the
   two named files uses it. The actual adjacency is `pipelines/ui/StepCard.tsx`, which imports
   `faCopy` *and* renders step-op icons sourced from `stepNarrowing` — so a dedupe step's glyph and
   the copy action would both become `Copy` in the same card. Correct the citation so the
   verification lands on the right file. (`faSortUp`/`faSortDown`/`faSort` in `SortableTh.tsx` is a
   correctly identified risk — I confirmed the three-state render; note that a11y is already safe
   there via `aria-sort` + `aria-hidden`, so it is purely a visual-distinction check, and
   ChevronUp/ChevronDown collide with the generic chevrons used elsewhere.)

6. **Task 11.1 points at a mechanism that does not exist.** It says to reuse "HEL-520's rendered
   focus-presence mechanism … in `e2e/`". `frontend/e2e` does not exist, and HEL-520's guards are
   Jest (`frontend/src/shared/ui/Modal.test.tsx`) with no `e2e/` hits at all. Name the concrete
   guard the executor should extend (file + test level) so 11.1 is followable; 11.2's red/green
   injection procedure is otherwise concrete enough and I have no objection to it.

### Non-blocking notes

- design.md/proposal.md say lucide is in 32 files; the current tree measures 35. Not load-bearing
  (the direction argument is aesthetic, per D1, which I agree is the right justification given the
  refuted usage-share claim), but the number should be corrected or dropped.
- D5's mapping table is explicitly "guidance, gated by `tsc --noEmit`" — that framing is correct
  and I am not asking for it to be exhaustive. Two entries worth pre-checking against the installed
  version: `Group` (`faObjectGroup`) and `Columns3` (`faTableColumns`).
- `IconButton` already wraps its icon slot in `aria-hidden="true"`, so D3's first bullet holds; the
  spec's boundary with `icon-button` reads coherent to me — no gap and no duplication found.
