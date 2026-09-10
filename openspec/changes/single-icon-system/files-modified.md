## Round 2 skeptic REFUTE follow-up — full deprecated-alias enumeration

skeptic-final-1.md's round-1 REFUTE (3 aliases: AlertTriangle/CheckCircle2/XCircle, already fixed and
committed) and skeptic-final-2.md's round-2 REFUTE (8 more) were each scoped to what the report found by
inspection. Per driver ruling, re-derived the FULL set from the installed package's own type
declarations rather than trusting either report's count:

1. `node_modules/lucide-react/dist/lucide-react.d.ts`'s single closing `export { ... }` statement
   (line 27050) is the authoritative alias table — parsed every `Canonical as Alias` pair in it
   (4361 total aliased pairs across the whole library; `...Icon`-suffixed pairs excluded as a
   universal naming convention offered for every icon, not a deprecated-legacy-name signal — leaving
   2308 genuine legacy-name aliases library-wide).
2. Cross-referenced that full 2308-name alias set against every name actually imported from
   `"lucide-react"` across `frontend/src` (79 distinct imported names, enumerated by parsing every
   `import { ... } from "lucide-react";` statement in every file, via a small Python script — not a
   plain grep, so multi-line import blocks are counted too).
3. **Result: exactly 8 deprecated aliases in use, matching skeptic-final-2.md's count exactly** —
   `AlertCircle`→`CircleAlert` (`ToolCallIndicator.tsx`), `AlignLeft`→`TextAlignStart`
   (`stepNarrowing.ts` only — see the `OutputPicker.tsx` ruling below), `BarChart3`→`ChartColumn`
   (`stepNarrowing.ts`), `CheckSquare`→`SquareCheckBig` (`stepNarrowing.ts`), `Filter`→`Funnel`
   (`stepNarrowing.ts`), `HelpCircle`→`CircleQuestionMark` (`UserMenu.tsx`),
   `History`→`RotateCcwClock` (`AuditHistorySection.tsx`, `RunHistoryModal.tsx`),
   `LineChart`→`ChartLine` (`OutputsRail.tsx`, `OutputGalleryCard.tsx`, `OutputsGalleryTab.tsx`). No
   narrower count and no wider count — 8 is the reproducible answer, not an assumption carried over
   from the report.
4. Runtime identity verified for all 8 pairs via `node -e` (`Alias === Canonical`) — all true, same
   as round 1's 3.
5. **`AlignLeft` in `OutputPicker.tsx:3` ruled explicitly, not left unowned:** confirmed via
   `git show d8d398ca:frontend/src/features/panels/ui/OutputPicker.tsx` (the branch point) that this
   exact import (`AlignLeft, FileText, Image as ImageIcon, Minus, Search`) already existed on `main`
   before any HEL-443 commit — genuinely pre-existing, not introduced by this ticket. Left unrenamed:
   it's the same class of already-lucide, pre-existing code this change's Non-Goals section already
   scopes out (like `InlineError.tsx`'s em-relative sizing). The `stepNarrowing.ts` `AlignLeft`
   occurrence is different — introduced by THIS ticket's D5 mapping table (`faAlignLeft` → `AlignLeft`)
   — and is renamed.

All 8 renames applied (import specifier + every JSX/map reference); one sed collateral casualty caught
and fixed before commit: a blind `\bFilter\b` rename briefly changed the user-facing label string
"Filter rows" to "Funnel rows" in `stepNarrowing.ts` (the identifier and the display label happened to
be the same word) — reverted the label text back to "Filter rows", kept only the identifier rename.

Gates re-run fresh: tsc --noEmit, npm run lint, npm run format:check, npm test (301/301 suites,
3197/3197 tests), npm run build (grep -rli fontawesome dist: 0 hits) all pass.

## Cycle 2 — AC2 sizing fixes (evaluation-1.md CR1/CR2)

evaluation-1.md FAILed cycle 1 on AC2: several migrated lucide icons at hand-rolled (non-`IconButton`)
call sites were missing the explicit `size` prop design.md D2 requires, silently rendering at lucide's
fixed 24px default inside chrome CSS-sized for the old ~12-16px font-size-driven FontAwesome glyph.

**CR1 (the cited spot-check list) — all fixed**, each mapped to the nearest `ICON_SIZE` value by reading
the button/wrapper's own CSS `font-size` (the mechanism the old FontAwesome icon actually inherited):
`StepCard.tsx` (AlertTriangle/GripVertical/ChevronUp/ChevronDown/Power/Copy, `--text-xs`→sm),
`DashboardShareDialog.tsx` (Copy/Link2, `--text-xs`/`.ui-modal-btn`'s `--text-sm`→sm),
`ApiTokensSection.tsx`/`MfaBackupCodesList.tsx`/`MfaEnrollModal.tsx` (Copy, `--text-xs`/inherited→sm),
`BranchAffordance.tsx`/`PipelineRiverView.tsx`/`OutputsRail.tsx`/`OutputsGalleryTab.tsx`
(GitBranch/Plus, `--text-xs`→sm), `PreferencesEditor.tsx`/`KeyValueListField.tsx` (Plus, `--text-xs`→sm),
`SidebarItemList.tsx`/`Toast.tsx` (X — see CR2 note below on `SidebarItemList`'s actual disposition),
every `X` in `features/pipelines/ui/stepConfigs/*.tsx` (`.pipeline-detail-page__row-remove-btn`,
`--text-xs`→sm).

**CR2 (full re-pass, every migrated file) — additional sites found and fixed beyond the spot-check
list:** `CommandBar.tsx` (RotateCcw/RotateCw, `.cmd-btn`'s `--text-xs`→sm),
`ProposalHandoff.tsx` (Columns3 ×4, `.proposal-handoff__icon`'s `--text-base`→md),
`StaticSourceForm.tsx` (X ×2, `.add-source-modal__action-link`'s `--text-xs`→sm),
`ImagePanel.tsx` (Image, `.image-panel__placeholder-icon`'s `--text-3xl`/30px — above the 20px ceiling,
collapsed to `ICON_SIZE.lg` per the same "documented ceiling, not a preservation" reasoning as
`BottomNav.tsx`'s D2b case), `PanelCard.tsx` (GripVertical, `.panel-grid-card__handle`'s
`--text-xs`→sm), `SidebarBody.tsx` (Lock, `.sidebar-body__locked-notice-icon`'s `--text-xs`→sm),
`Select.tsx` (ChevronDown, `.ui-select__chevron` has no local font-size rule — inherits the
form-input default; sized to `ICON_SIZE.sm` as the nearest reasonable value, no stronger signal
available), `AggregateConfig.tsx` (AlertTriangle, `.pipeline-detail-page__filter-warning`'s
`--text-xs`→sm).

**CR2's "or provably still correctly sized by CSS" cases (b) — verified, not fixed, since a fix would
be wrong:** every lucide icon passed as an `icon=`/`emptyIcon=`/`cta.icon=` prop into `EmptyState`,
`PageStatus`, `pickerEmptyState`, `SidebarItemList`, or `MobileNavSheet` is sized by a `descendant`
selector that targets the `<svg>` element directly — `.ui-empty-state__icon svg { width: 1em; height:
1em; }` / `.ui-empty-state__cta-icon svg { ... }` (`EmptyState.css`) and
`.mobile-nav-sheet__create-action-icon svg { ... }` (`MobileNavSheet.css`) — CSS on the SVG element
itself overrides lucide's `width`/`height` presentation attributes, so these are genuinely
correctly sized without an inline `size` prop, unlike an ancestor `font-size` rule (which lucide does
not consume at all). Confirmed for every such site: `AppRoutes.tsx`, `AuditHistorySection.tsx`,
`ProposalReviewPage.tsx`, `PatchSetReviewPage.tsx`, `CombinedProposalReviewPage.tsx`,
`OutputsGalleryTab.tsx`'s LineChart, `PipelineRiverView.tsx`'s GitBranch, `PipelineProposalReviewPage.tsx`,
`RunHistoryModal.tsx`, `AgentMemoryList.tsx`, `ApiTokensSection.tsx`'s Key, `ConnectorSelectField.tsx`,
`MobileNavSheet.tsx`'s TriangleAlert, `SidebarBody.tsx`'s Database/GitBranch/MessagesSquare,
`SidebarItemList.tsx`'s SearchX/Plus (cta.icon) and its `X` (a pre-existing, already-lucide
`.dashboard-list__filter-clear svg { width: 1em; height: 1em; }` rule from prior HEL-548 work —
untouched, already correct), `pickerEmptyState.tsx`'s five entries, `PageStatus.tsx`'s default
TriangleAlert, `PublicDashboardViewerPage.tsx`'s two Link2, `DashboardShareDialog.tsx`'s EmptyState
Link2. `EmptyState.test.tsx`'s fixtures are left unsized (test-only, not production UI).

Gates re-run fresh after these fixes: `tsc --noEmit` / `npm run lint` / `npm test` (301/301 suites,
3197/3197 tests) / `npm run build` (`grep -rli fontawesome dist` — 0 hits) all pass.

## Files modified — cycle 1

### Task 0 (already committed as `8888766b`, standalone)

- `.github/dependabot.yml` — removed the stale `fortawesome:` co-versioning group.
- `scripts/check-dependabot-groups.mjs` — removed `fortawesome` from `DECLARED_FAMILIES`; added (then,
  in this cycle's Task 10 commit, removed) a temporary `DECLARED_INDEPENDENT` entry for the four
  `@fortawesome/*` packages to bridge the gap until Task 10 actually removes them.

### Foundation (Task 1)

- `frontend/src/shared/ui/iconSize.ts` — new file, `ICON_SIZE = { sm: 14, md: 16, lg: 20 }`.

### The 57-file FontAwesome→lucide swap (Tasks 2–9, D5/D6 mapping)

All 57 files from the premise-validated inventory, grouped by directory per tasks.md sections 2–9:
`app/AppRoutes.tsx`, `app/CommandBar.tsx`, `app/Sidebar.tsx` (Task 9a),
`features/assistant/ui/{ActiveConversationPanel,ProposalHandoff,ToolCallIndicator}.tsx`,
`features/audit/ui/AuditHistorySection.tsx`, `features/auth/ui/UserMenu.tsx`,
`features/dashboards/ui/{DashboardAppearanceEditor,DashboardShareDialog,ProposalReviewPage,
PublicDashboardViewerPage,RefinementChatDrawer,ProposalReview}.tsx`,
`features/panels/ui/{ImagePanel,PanelCard,OutputPicker}.tsx`,
`features/patchSets/ui/PatchSetReviewPage.tsx`,
`features/pipelines/state/stepNarrowing.ts`, `features/pipelines/types/step.ts` (D6 situation B — narrowed
`OpType.icon` to `LucideIcon`), `features/pipelines/ui/{BranchAffordance,OpDropdown,OutputGalleryCard,
OutputsGalleryTab,OutputsRail,PipelineRiverView,RunHistoryModal,StepCard,StepCard.test}.tsx`,
`features/pipelines/ui/proposalReview/PipelineProposalReviewPage.tsx`,
`features/pipelines/ui/stepConfigs/{AggregateConfig,AssertConfig,FilterConfig,LookupConfig,PivotConfig,
SortConfig,UnpivotConfig,WindowConfig}.tsx`,
`features/proposals/ui/CombinedProposalReviewPage.tsx`,
`features/settings/ui/{AgentMemoryList,ApiTokensSection,MfaBackupCodesList,MfaEnrollModal,
PreferencesEditor,SettingsPage}.tsx`,
`features/sources/ui/forms/{ConnectorSelectField,KeyValueListField,StaticSourceForm}.tsx`,
`features/sources/ui/SourceDetailPanel.tsx` (Task 9a),
`shared/chrome/{MobileNavSheet,pickerEmptyState,SidebarBody,SidebarItemList,BottomNav}.tsx` (D6 situation A
+ Task 9a), `shared/ui/{DataGrid,EmptyState,EmptyState.test,Modal,PageStatus,Select,SortableTh,Toast}.tsx`
(D6 situation A for `EmptyState`/`PageStatus`; D2a for `SortableTh`), `shared/ui/SortableTh.css` (removed
the `font-size` declaration per D2a, kept the color rules), `shared/ui/__snapshots__/SortableTable.test.tsx.snap`
(regenerated — legitimate diff from the icon-markup change).

### Task 10 — dependency removal

- `frontend/package.json` — removed `@fortawesome/fontawesome-svg-core`, `@fortawesome/free-brands-svg-icons`,
  `@fortawesome/free-solid-svg-icons`, `@fortawesome/react-fontawesome`.
- `frontend/package-lock.json` — regenerated via `npm install`; zero `fortawesome` references remain.
- `scripts/check-dependabot-groups.mjs` — removed the Task-0.4a temporary `DECLARED_INDEPENDENT` entry in
  this same logical change, now that the packages themselves are gone.

### Task 11 — accessibility red/green proof

- `frontend/src/shared/ui/iconAccessibility.guard.test.tsx` — new file. Demonstrates RED (a hand-rolled
  icon-only `<button>` with no `aria-label`/`title` has no accessible name) before GREEN (the same shape
  routed through `IconButton`, which makes `aria-label` a required prop, has one) — see the executor's
  report for the probe output. Also records a probe finding: `lucide-react` icons carry `aria-hidden="true"`
  by default on their `<svg>` regardless of props passed, unlike `FontAwesomeIcon` — so there was no
  non-compliant fixture to demonstrate RED against for the decorative-icon half of AC3; only the
  accessible-name half (icon-only interactive controls) carries real migration risk, and is the one given
  the full RED/GREEN pair.

## Not modified (explicitly out of scope, per design.md Non-Goals)

- `shared/ui/IconButton.tsx`/`IconButton.css` — `icon: ReactNode` and the `font-size` CSS rules are
  untouched; they still serve seven bare-text-glyph call sites unrelated to either icon library.
- `shared/chrome/InlineError.tsx`/`.css` — already lucide, em-relative sizing, out of scope.
- The OrbitMark brand logo (`size={18}` sites in `LoginPage.tsx`/`RegisterPage.tsx`/etc.) — not an
  icon-set glyph.
