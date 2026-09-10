## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- All 4 ticket ACs addressed in intent; task list (tasks.md) matches D7's
  Task-0/Task-10 split and the 57-file inventory.
- No scope creep observed beyond what design.md's D2b widening explicitly
  authorized (normalizing lucide-only inline `size` literals).
- `specs/icon-system/spec.md`, `specs/error-state-pattern/spec.md` (D6
  REMOVED+ADDED pair), `specs/dependabot-update-grouping/spec.md` (D7
  REMOVED+ADDED pair) present and match design.md's described shape.
- Planning artifacts (design.md) reflect the implemented D7 resolution:
  verified `8888766b` adds the interim `DECLARED_INDEPENDENT` entry and
  `13112952` removes it in the same commit that drops the packages —
  `node scripts/check-dependabot-groups.mjs` passes on HEAD.

### Phase 2: Code Review — FAIL

Issues:

1. **AC2 violation — several migrated call sites omit the required explicit
   `size` prop, silently changing rendered icon size from lucide's fixed
   24px default (not a member of `ICON_SIZE` = 14/16/20).** Design.md's D2
   explicitly calls this out as the change's central risk ("lucide does not
   pick this up from the surrounding `font-size`... leaving `size` unset
   would silently change the rendered glyph... to lucide's fixed 24px
   default") and D2a treats `SortableTh.tsx` as a hazard case specifically
   because of this mechanism. `SortableTh.tsx` was done correctly
   (`size={ICON_SIZE.sm}` on all three glyphs, `font-size` CSS rule
   removed). But the same pattern was missed in multiple other files in the
   same PR:
   - `frontend/src/features/pipelines/ui/StepCard.tsx:244,254,264,280,289`
     — `GripVertical`, `ChevronUp`, `ChevronDown`, `Power`, `Copy` all
     render with no `size` prop. These buttons
     (`.pipeline-detail-page__step-card-drag-handle` /
     `-move-btn` / `-toggle-enabled-btn` / `-duplicate-btn`, defined in
     `frontend/src/features/pipelines/ui/PipelineDetailPage.css:385-401`)
     are a fixed 24×24px box with `font-size: var(--text-xs)` (12px) — the
     mechanism the old FontAwesome icons relied on for their ~12px size.
     There is no CSS rule setting `width`/`height` on the icon/svg itself.
     With no `size` prop, these icons now render at lucide's built-in 24px
     default, filling the 24×24 button edge-to-edge with no margin — a
     real visual regression from the pre-migration ~12px icon, and not a
     value from the standardized `ICON_SIZE` set AC2 requires.
   - `frontend/src/features/dashboards/ui/DashboardShareDialog.tsx:124,159`
     — `Copy`, `Link2` (×2 incl. line 176) with no `size` prop, inline next
     to button text sized via `font-size: var(--text-xs)` /
     `--text-sm` (`DashboardShareDialog.css`).
   - `frontend/src/features/settings/ui/ApiTokensSection.tsx:84`,
     `MfaBackupCodesList.tsx:27`, `MfaEnrollModal.tsx:124` — same `Copy`
     pattern, no `size`.
   - Also missing `size`: `BranchAffordance.tsx:38` (`GitBranch`),
     `PipelineRiverView.tsx:300` (`Plus`), `OutputsRail.tsx:73` (`Plus`),
     `PreferencesEditor.tsx:226,323` (`Plus`),
     `KeyValueListField.tsx:93` (`Plus`), `SidebarItemList.tsx:329` (`X`),
     `Toast.tsx:113` (`X`), and the `X` icons across every
     `features/pipelines/ui/stepConfigs/*.tsx` file (Aggregate/Assert/
     Filter/Lookup/Pivot/Sort/Unpivot/WindowConfig).
   - The executor's own commit message for `13112952` narrows its claim to
     "Every **IconButton** call site... now passes an explicit `size`
     prop" — true as far as it goes, but the same font-size-inheritance
     risk D2 describes applies equally to hand-rolled (non-`IconButton`)
     buttons that used the identical CSS mechanism, and those were missed.
   - This is a mechanical, `file:line`-citable violation of AC2 ("All
     icons render from `lucide-react`, at one of a standardized,
     documented fixed size set") and of design.md D2's own stated
     mechanism, not a judgment call — confirmed by reading both the JSX
     and the corresponding CSS rule for each cited file, not inferred.

2. `frontend/src/features/pipelines/ui/StepCard.tsx:209` (`AlertTriangle`)
   also has no `size` prop — same pattern, not yet confirmed against a CSS
   rule but flagged for the same reason; re-check alongside the fix above.

No other mechanical CONTRIBUTING.md/DESIGN.md violations found in a
targeted pass; DRY/type-safety/error-handling/dead-code checks on the diff
were otherwise clean (D6 situation A/B implemented as designed, `faClone`→
`Files` vs `faCopy`→`Copy` correctly distinct per D5/Risks, D7 ordering
verified by direct commit inspection).

### Phase 3: UI Review — N/A (blocked by Phase 2 FAIL)

Not run: fixing the AC2 sizing gaps above is likely to change markup/CSS in
ways that would invalidate a UI pass taken now. Re-run once Phase 2 issues
are resolved. (Gates below were run as part of Phase 2's required fresh
verification, not a Phase 3 substitute.)

**Gates re-run fresh in `WORKTREE_PATH` (frontend/** changed):**
- `npm run lint` — PASS (zero warnings)
- `npm run format:check` — PASS
- `npm test` — PASS (301 suites / 3197 tests)
- `npm --prefix frontend run build` — PASS; `grep -ril fontawesome dist/`
  returns zero hits (AC4 bundle check independently confirmed)

**AC1 independently re-verified:**
- `grep -rn '@fortawesome\|FontAwesomeIcon\|\bfa[A-Z]' frontend/src` — zero
  real hits; the only matches are prose comments referencing
  "FontAwesomeIcon" as historical context (`IconButton.tsx:9`,
  `PanelCard.test.tsx:153`, `iconAccessibility.guard.test.tsx:45`), not
  imports or usages.
- `frontend/package.json` / `frontend/package-lock.json`: zero
  `fortawesome` matches; `frontend/node_modules/@fortawesome` does not
  exist.
- The interim `DECLARED_INDEPENDENT` entry from the Task 0 commit
  (`8888766b`) was confirmed removed in the Task 10 commit (`13112952`),
  in the same commit that drops the packages — `check-dependabot-groups.mjs`
  reports OK on HEAD.

**AC3 independently re-verified (not taken on the executor's word):**
- Read `iconAccessibility.guard.test.tsx`: real RED (hand-rolled `<button>`
  wrapping a decorative `Trash2`, asserted to have empty accessible name)
  before GREEN (`IconButton`, which requires `aria-label` at the type
  level, has one) — a genuine red-then-green pair, not a
  precondition-guaranteed assertion.
- Independently confirmed the executor's claim that lucide defaults
  `aria-hidden="true"` on its `<svg>` unless an a11y prop or children are
  present, by reading
  `frontend/node_modules/lucide-react/dist/cjs/lucide-react.js:92`:
  `...!children && !hasA11yProp(rest) && { "aria-hidden": "true" }`. This
  makes a non-compliant decorative-icon fixture structurally unreachable,
  as claimed — the "no RED fixture possible" note is accurate on
  inspection, not a claim taken at face value.

### Overall: FAIL

### Change Requests

1. Add an explicit `size={ICON_SIZE.sm}` (or the size that visually
   matches the button's prior ~12px/em-derived icon — verify against the
   `--text-xs`/`--text-sm` value each button's CSS previously drove) to
   every migrated lucide icon still missing one, at minimum:
   `frontend/src/features/pipelines/ui/StepCard.tsx:209,244,254,264,280,289`,
   `frontend/src/features/dashboards/ui/DashboardShareDialog.tsx:124,159,176`,
   `frontend/src/features/settings/ui/ApiTokensSection.tsx:84`,
   `frontend/src/features/settings/ui/MfaBackupCodesList.tsx:27`,
   `frontend/src/features/settings/ui/MfaEnrollModal.tsx:124`,
   `frontend/src/features/pipelines/ui/BranchAffordance.tsx:38`,
   `frontend/src/features/pipelines/ui/PipelineRiverView.tsx:300`,
   `frontend/src/features/pipelines/ui/OutputsRail.tsx:73`,
   `frontend/src/features/settings/ui/PreferencesEditor.tsx:226,323`,
   `frontend/src/features/sources/ui/forms/KeyValueListField.tsx:93`,
   `frontend/src/shared/chrome/SidebarItemList.tsx:329`,
   `frontend/src/shared/ui/Toast.tsx:113`, and every `X` icon in
   `frontend/src/features/pipelines/ui/stepConfigs/*.tsx`.
2. Do a full re-pass of the 57-file diff specifically for JSX lucide icon
   usages with no `size=` prop (a plain `grep -n "<IconName" file | grep -v
   "size="` per migrated file, per icon import, not just the files listed
   above — CR1's list was a spot-check, not exhaustive) and confirm each
   either (a) gets an explicit `ICON_SIZE` value, or (b) is provably still
   correctly sized by an existing CSS rule targeting the icon/svg element
   directly (not just a `font-size` rule on an ancestor, which lucide does
   not consume) — document which of (a)/(b) applies per file in
   `files-modified.md`.
3. After CR1/CR2 land, visually verify the affected controls (StepCard's
   action cluster, DashboardShareDialog's copy/create-link buttons, the
   settings Copy-to-clipboard buttons) in both themes at the corrected
   size, per design.md's "visual check required" instruction for exactly
   this class of change.
4. Re-run Phase 3 (UI review) once CR1-3 are resolved — it was not run this
   cycle given the Phase 2 fail.

### Non-blocking Suggestions

- Consider a lint rule or a one-off repo-wide check (e.g. a script that
  flags `<LucideIconName` JSX without a `size=` prop in files under
  `frontend/src`) so this class of regression is caught mechanically in
  future PRs rather than by manual review.
