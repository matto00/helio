## 1. Migrate rename inputs to TextField (zero visual diff — see design.md Decisions)

- [x] 1.1 `frontend/src/features/panels/ui/PanelCard.tsx`: replace the raw rename `<input>` (line ~231,
      `panel-grid-card__title-input`, `aria-label="Panel title"`) with `TextField`, preserving
      value/onChange/blur/keyboard/`autoFocus` behavior. In
      `frontend/src/features/panels/ui/grid/PanelGrid.css` (verify full path — not `ui/PanelGrid.css`), replace
      lines 222-236 (the `.panel-grid-card__title-input` base rule and its `:focus-visible` rule) with the exact
      compound-selector CSS in `design.md`'s Decisions section (base rule, `:hover:not(:disabled)` rule, and
      `:focus-visible` rule) — do not improvise; the design.md block is the source of truth, including the
      `border-bottom: 1px solid var(--app-accent)` token (not `--app-accent-mid`) and the explicit hover-state
      override that keeps the underline from recoloring on hover.
- [x] 1.2 `frontend/src/features/pipelines/ui/PipelineDetailFooter.tsx`: replace the raw name `<input>` (line
      ~144, `pipeline-detail-page__footer-output-input`, `aria-label="Pipeline name"`) with `TextField`, same
      preservation approach as 1.1. In `PipelineDetailPage.css`, replace lines 579-591 with the exact
      compound-selector CSS in `design.md`'s Decisions section — including `width: auto` (this input has no
      `width` today and would otherwise stretch to `.ui-input`'s `width: 100%` inside the wrapping flex footer
      row) and the `:hover`/`:focus`/`:focus-visible` overrides.
- [x] 1.3 `frontend/src/features/dataTypes/ui/TypeDetailPanel.tsx`: replace the raw name `<input>` (line ~116,
      `type-detail-panel__name-input`, `aria-label="Data type name"`) with `TextField`, same preservation
      approach as 1.1. In `TypeDetailPanel.css`, replace lines 173-191 with the exact compound-selector CSS in
      `design.md`'s Decisions section — including `width: auto` (kept `flex: 1` for layout) and the combined
      `:hover`/`:focus`/`:focus-visible` override.
- [x] 1.4a Do not leave any of the three base/state rule blocks half-migrated — each replacement must include
      its base-state rule AND its hover/focus-state rule(s) in the same edit, per design.md. A base-only edit
      (round-1's mistake, corrected in round 2) ships a visible focus-halo and hover-recolor regression.
- [x] 1.4 Verify DESIGN.md §5 button recipes in all three touched files — normalize only if a genuine violation
      is found (none expected based on Planning-time review; do not rewrite compliant buttons).
- [x] 1.5 Verify loading/empty/error states in the three touched views already go through
      `EmptyState`/`StatusMessage`/`InlineError`/spinner per §7 — confirm only, no expected changes.

## 2. Raw-element guard

- [x] 2.1 Read `PipelineShareDialog.test.tsx` first (prior art for this exact assertion shape: a raw `<input>`
      instead of the shared `TextField`). Add a test (new file, or an addition to each component's existing test
      file — pick whichever keeps the assertion closest to its component) asserting, per
      `specs/raw-element-guard/spec.md`: for each of the three migrated components, the element with the rename
      control's accessible name (`"Panel title"` / `"Pipeline name"` / `"Data type name"`) carries `TextField`'s
      `ui-input` class. Do not assert "no raw `<input>` anywhere in the render" — `TypeDetailPanel.tsx`'s
      per-field checkbox inputs are a legitimate, out-of-scope exception the spec explicitly carves out.

## 3. Verification

- [x] 3.1 `npm test`, `npm run lint`, `npm run typecheck` — zero new warnings.
- [x] 3.2 Confirm HEL-813's touch-target e2e guard (`e2e/hel813-*.spec.ts`) still passes.
- [x] 3.3 Confirm HEL-439's token-audit guard (`frontend/src/theme/tokenAuditSweep.css.test.ts`) still passes; if
      this change removes any literal font-size/color/spacing declarations, update baselines to shrink
      accordingly rather than leaving them stale.
- [x] 3.4 Visual verification (desktop, 430px, 768px) of all three migrated rename controls — look at the
      rendered result, not just the diff. Per design.md's "zero visual diff" decision, the expected outcome is
      **no visible change at all** in idle and rename/edit mode at any of the three widths; any visible
      difference is a defect in task 1.1-1.3's compound-selector overrides, not an accepted change.
