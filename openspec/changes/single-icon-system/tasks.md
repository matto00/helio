## 0. Dependabot `fortawesome` group retirement (design.md D7 — driver-ruled `proceed-to-delivery`,
design-gate round 5; MUST be the literal first commit of Execution, standalone, before any other
task in this file)

- [x] 0.1 Delete the `fortawesome:` group block from `.github/dependabot.yml` (between the `groups:`
      key and the `echarts:` group).
- [x] 0.2 Delete the `fortawesome` entry from `DECLARED_FAMILIES` in
      `scripts/check-dependabot-groups.mjs`.
- [x] 0.3 Do NOT touch `scripts/check-dependabot-groups.selftest.mjs` — its `fortawesome` references
      are self-contained fixture literals, not derived from the real `DECLARED_FAMILIES`; touching it
      is out of scope and would weaken its own test coverage.
- [x] 0.4 Commit standalone (not bundled with any icon-migration change). **The pre-commit hook
      passing is the proof for this task** — record that `.husky/pre-commit` (which runs
      `check-dependabot-groups.mjs`) ran and passed on this commit. If it still fails, this is a NEW
      finding (the fix was wrong/incomplete) — stop and escalate to the driver rather than iterating
      silently.
- [x] 0.4a **(Driver correction, executor cycle 1 — see design.md D7's correction.)** Add the four
      `@fortawesome/*` packages to `DECLARED_INDEPENDENT` in `scripts/check-dependabot-groups.mjs` as
      part of this same Task 0 commit, with a comment marking it HEL-443-temporary. Without this, the
      documented 4-part fix alone makes the pre-commit hook FAIL (not pass) because the packages are
      still in `frontend/package.json` until Task 10. Task 10 MUST delete this entry in the same
      commit that removes the packages.
- [x] 0.5 The `specs/dependabot-update-grouping/spec.md` delta is already included in this change (a
      `REMOVED`+`ADDED` pair — `MODIFIED` isn't usable here since the validator refuses to silently
      drop the surviving FontAwesome-scenario title, same landmine as the `error-state-pattern`
      delta; the successor requirement drops the FontAwesome scenario and adds an `echarts` one) — no
      additional authoring task needed, just confirm
      `openspec validate single-icon-system --type change --strict` still passes after 0.1-0.2 land.

## 1. Foundation

- [x] 1.1 Add `frontend/src/shared/ui/iconSize.ts` exporting `ICON_SIZE = { sm: 14, md: 16, lg: 20 }`.
- [x] 1.2 Re-derive the `@fortawesome` file inventory fresh (do not trust the count in `design.md` if
      time has passed) and confirm it still matches 57 files / 67 symbols before starting the swap.
- [x] 1.3 **(Revised at design-gate round 2 — the original plan here was withdrawn as a breaking,
      unnecessary change.)** `IconButton.tsx`/`IconButton.css` are **not modified** by this change —
      `icon` stays `ReactNode`, the `font-size` CSS rules stay in place (they size 7 text-glyph call
      sites — `PanelCard.tsx`, `TableDisplayFields.tsx`×4, `DashboardList.tsx`, `SidebarItemList.tsx`
      — that use neither icon library and are out of scope). Instead: at every `IconButton` call site
      being migrated from a `FontAwesomeIcon` to a lucide icon (sections 2-9 below), pass an explicit
      `size` prop per D2's mapping (`xs`→`ICON_SIZE.sm`/14, `sm`→`ICON_SIZE.md`/16,
      `md`→`ICON_SIZE.lg`/20 — the last is a deliberate size increase from today's 18px, not a
      preservation) — lucide does not inherit `font-size` the way `FontAwesomeIcon` did, so an unset
      `size` would silently regress to lucide's 24px default. Do not touch `InlineError.tsx`/`.css`
      (already lucide, outside this change).

## 2. App shell & chrome (app/, shared/chrome/)

- [x] 2.1 `app/AppRoutes.tsx`, `app/CommandBar.tsx`
- [x] 2.2 `shared/chrome/MobileNavSheet.tsx`, `shared/chrome/pickerEmptyState.tsx`,
      `shared/chrome/SidebarBody.tsx`, `shared/chrome/SidebarItemList.tsx`

## 3. Shared UI primitives (shared/ui/) — highest accessibility risk

- [x] 3.1 `shared/ui/DataGrid.tsx` — confirmed untouched by HEL-520; includes the pin/unpin
      (`faThumbtack`/`faThumbtackSlash`) toggle control — verify `aria-pressed` behavior survives
      the icon swap.
- [x] 3.2 `shared/ui/Modal.tsx`, `shared/ui/Toast.tsx`, `shared/ui/Select.tsx` — `IconDefinition`-typed
      files (`PageStatus.tsx`) are handled separately in 3.4a (design.md D6).
- [x] 3.2a `shared/ui/SortableTh.tsx` + `SortableTh.css` (design.md D2a — HEL-1022 regression hazard):
      swap the `faSort`/`faSortUp`/`faSortDown` glyphs per D5's mapping (verify the three-state visual
      result, not just typecheck), size via `ICON_SIZE.sm` passed as the `size` prop, and **remove**
      `.sortable-th__glyph`'s `font-size: var(--text-xs)` declaration — do not leave it in place, since
      lucide ignores it and a stale rule invites exactly the illegible-glyph regression HEL-1022 fixed.
- [x] 3.3 `shared/ui/EmptyState.tsx` and `shared/ui/EmptyState.test.tsx` — `IconDefinition`-typed,
      handled in 3.4a alongside the other 4 files (design.md D6).
- [x] 3.4a **(Revised at design-gate round 2 — corrects a factual error in the original plan for 5 of
      7 files.)** Situation A (design.md D6): `shared/ui/EmptyState.tsx` (+ its test fixture),
      `shared/ui/PageStatus.tsx`, `shared/chrome/{pickerEmptyState,SidebarItemList,MobileNavSheet}.tsx`
      already accept `IconDefinition | ReactNode` with a shipped lucide-element convention (HEL-539/
      HEL-548). Drop the `IconDefinition` arm of the union in each, delete the now-dead
      `isValidElement` branches, and convert the one remaining FontAwesome producer
      (`pickerEmptyState.tsx`'s `faComments` entry → `<MessagesSquare />`, matching its four
      already-lucide sibling entries). Do NOT narrow these to a component-reference type — `ReactNode`
      is the established, correct convention here. This change already includes a
      `specs/error-state-pattern/spec.md` delta narrowing `EmptyState`'s icon-prop requirement to
      `ReactNode`-only (design-gate round 3, CR1) — no additional task needed to author it, just make
      sure `EmptyState.tsx`'s implementation actually matches what that delta states.
      **Cross-reference:** `shared/chrome/SidebarBody.tsx` (task 2.2) also imports `faComments` —
      `pickerEmptyState.tsx`'s header comment states its `chat` entry is locked to match
      `SidebarBody.tsx`'s `SidebarItemList` props verbatim (enforced by `pickerEmptyState.test.ts`),
      so convert both call sites to `<MessagesSquare />` together, not independently.
- [x] 3.4b Situation B (design.md D6): `pipelines/types/step.ts`'s `OpType.icon: IconDefinition` is
      genuinely FontAwesome-only with no existing lucide convention. Narrow it to `LucideIcon` (from
      `lucide-react`), update `stepNarrowing.ts`'s op-type definitions to assign lucide component
      references instead of `fa*` values, and update the two consumer sites
      (`pipelines/ui/OpDropdown.tsx:115`, `pipelines/ui/StepCard.tsx:206`) to render the component
      directly (`const Icon = step.opType.icon; <Icon aria-hidden="true" size={ICON_SIZE.md} />`)
      instead of wrapping it in `FontAwesomeIcon`. Also update `step.ts`'s file-header comment
      (currently describes the icon field as "FontAwesome") so it doesn't outlive the dependency.

## 4. Dashboards & proposals

- [x] 4.1 `features/dashboards/ui/DashboardAppearanceEditor.tsx`,
      `features/dashboards/ui/DashboardShareDialog.tsx`,
      `features/dashboards/ui/ProposalReviewPage.tsx`,
      `features/dashboards/ui/PublicDashboardViewerPage.tsx`,
      `features/dashboards/ui/RefinementChatDrawer.tsx`
- [x] 4.2 `features/proposals/ui/CombinedProposalReviewPage.tsx`,
      `features/patchSets/ui/PatchSetReviewPage.tsx`

## 5. Panels, audit, auth

- [x] 5.1 `features/panels/ui/ImagePanel.tsx`, `features/panels/ui/PanelCard.tsx`
- [x] 5.2 `features/audit/ui/AuditHistorySection.tsx`, `features/auth/ui/UserMenu.tsx`

## 6. Settings

- [x] 6.1 `features/settings/ui/AgentMemoryList.tsx`, `features/settings/ui/ApiTokensSection.tsx`,
      `features/settings/ui/MfaBackupCodesList.tsx`, `features/settings/ui/MfaEnrollModal.tsx`,
      `features/settings/ui/PreferencesEditor.tsx`, `features/settings/ui/SettingsPage.tsx`
      (this group carries `faSun`/`faMoon` — verify the theme toggle explicitly.)

## 7. Sources

- [x] 7.1 `features/sources/ui/forms/ConnectorSelectField.tsx`,
      `features/sources/ui/forms/KeyValueListField.tsx`,
      `features/sources/ui/forms/StaticSourceForm.tsx`

## 8. Assistant

- [x] 8.1 `features/assistant/ui/ActiveConversationPanel.tsx`,
      `features/assistant/ui/ProposalHandoff.tsx`, `features/assistant/ui/ToolCallIndicator.tsx`

## 9. Pipelines (largest group — 20 files)

- [x] 9.1 `features/pipelines/types/step.ts`, `features/pipelines/state/stepNarrowing.ts` — this is
      the same work as task 3.4b (Situation B); done there, not twice — see 3.4b for the actual
      procedure.
- [x] 9.2 `features/pipelines/ui/BranchAffordance.tsx`, `features/pipelines/ui/OpDropdown.tsx`,
      `features/pipelines/ui/OutputGalleryCard.tsx`, `features/pipelines/ui/OutputsGalleryTab.tsx`,
      `features/pipelines/ui/OutputsRail.tsx`, `features/pipelines/ui/PipelineRiverView.tsx`,
      `features/pipelines/ui/proposalReview/PipelineProposalReviewPage.tsx`,
      `features/pipelines/ui/RunHistoryModal.tsx`, `features/pipelines/ui/StepCard.tsx`,
      `features/pipelines/ui/StepCard.test.tsx` — `StepCard.tsx` renders both `faCopy` (its own
      copy-action icon, line ~296) and, via `stepNarrowing.ts`, the `faClone`-sourced "Dedupe rows"
      step-op glyph in the same view; per design.md D5 (corrected), map `faClone`→`Files` and
      `faCopy`→`Copy` so the two stay visually distinct — do NOT map both to `Copy`.
- [x] 9.3 `features/pipelines/ui/stepConfigs/{AggregateConfig,AssertConfig,FilterConfig,
      LookupConfig,PivotConfig,SortConfig,UnpivotConfig,WindowConfig}.tsx` (8 files)

## 9a. Lucide-only literal-size normalization (design.md D2b — widens spec-icon-system's sizing
requirement to non-FontAwesome files; corrects design-gate round 1 CR3, round 3 CR2)

- [x] 9a.1 `app/Sidebar.tsx` (`size={16}` ×3 → `ICON_SIZE.md`), `features/dashboards/ui/ProposalReview.tsx`
      (`size={15}` → `ICON_SIZE.sm`), `features/panels/ui/OutputPicker.tsx` (`size={18}` ×4 →
      `ICON_SIZE.md`, `size={28}` → `ICON_SIZE.lg`), `features/sources/ui/SourceDetailPanel.tsx`
      (`size={13}` → `ICON_SIZE.sm`), `shared/chrome/BottomNav.tsx:38` (`size={22}` →
      `ICON_SIZE.lg`/20 — decided deliberate reduction, see design.md D2b; verify the mobile bottom
      nav visually in both themes), `shared/chrome/SidebarBody.tsx` (`size={12}` pin badge →
      `ICON_SIZE.sm`/14, visual check since it's a small status glyph; `size={14}` ×3 → source from
      `ICON_SIZE.sm` instead of a raw literal, value unchanged), `app/CommandBar.tsx:209`
      (`size={16}` → source from `ICON_SIZE.md` instead of a raw literal, value unchanged). Re-grep
      for any other raw numeric `size={N}` literal on a lucide icon component across `frontend/src`
      not caught by this enumeration before closing this task — design-gate rounds 1 and 3 both found
      additional sites beyond the prior enumeration, so treat this list as evidence of an
      undercounting pattern, not a guarantee this pass is now exhaustive.

## 10. Dependency removal & bundle verification

- [x] 10.1 Remove `@fortawesome/fontawesome-svg-core`, `@fortawesome/free-solid-svg-icons`,
      `@fortawesome/free-brands-svg-icons`, `@fortawesome/react-fontawesome` from
      `frontend/package.json`; run `npm install` in `frontend/` to regenerate
      `frontend/package-lock.json` with those entries gone. In the **same commit**, delete the
      HEL-443-temporary `@fortawesome/*` `DECLARED_INDEPENDENT` entry added in Task 0.4a from
      `scripts/check-dependabot-groups.mjs` (see design.md D7's correction — the checker does not
      mechanically flag a stale `DECLARED_INDEPENDENT` entry, so this is enforced by task discipline).
- [x] 10.2 `grep -r "@fortawesome" frontend/src` returns zero matches; confirm no re-export/alias/
      dynamic-import survives by cross-checking `npm run build` output for any `fontawesome` string.

## 11. Accessibility verification (AC3 — prove red before green)

- [x] 11.1 **Corrected pointer (design-gate round 1 REFUTE, CR6):** HEL-520's `e2e/` guards
      (`e2e/focus-presence-guard.spec.ts`, `e2e/hel520-focus-presence-guard.regression.spec.ts`) cover
      focus-ring *visibility*, not accessible-name coverage — do not claim to reuse them for this AC.
      Icon-only controls that already go through `shared/ui/IconButton` are covered at the
      TypeScript-compile level (`aria-label` is a required, non-optional prop — see
      `IconButton.test.tsx`'s own comment on this) and need no new runtime guard once their icon prop
      is swapped. For any file in this change's scope where a hand-rolled icon-only control does
      *not* go through `IconButton` (audit while doing the per-file swap — DESIGN.md documents this
      as a narrow, justified escape hatch, not the common case), add a small Jest render test
      (co-located with that component, following `IconButton.test.tsx`'s
      `screen.getByRole("button", { name: ... })` pattern) asserting it has an accessible name.
      Similarly, for a decorative icon adjacent to text, assert `aria-hidden="true"` is present.
      **Concrete starting population (design-gate round 4, non-blocking note):** a scan for raw
      `<button>` elements containing `FontAwesomeIcon`/its lucide replacement with no
      `aria-label`/`title` found ~11 candidates, including `shared/ui/DataGrid.tsx:940`,
      `shared/ui/SortableTh.tsx:34`, `features/settings/ui/PreferencesEditor.tsx:225,322` — start the
      audit from this list rather than discovering it ad hoc; most likely already have adjacent text
      making them non-issues, but confirm each rather than assuming.
- [x] 11.2 Before finalizing, temporarily reintroduce one known-bad fixture (an icon-only control
      missing `aria-label`, or a decorative icon missing `aria-hidden`) into a new test written for
      11.1 and confirm the test fails — then remove the injected defect and confirm it passes. Record
      this red/green proof in the commit or PR description; do not ship a guard that was only ever
      exercised against already-compliant code.

## 12. Gates

- [x] 12.1 `npm run build`, `npm run lint`, `npm run typecheck`, `npm test` all pass with zero new
      warnings.
