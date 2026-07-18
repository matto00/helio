## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- Scope correctly follows the escalation-resolved proposal, not the filed ticket ACs: AC1/AC2
  explicitly and correctly skipped per human direction, documented in proposal.md/files-modified.md.
- All four `type-registry-provenance` spec requirements implemented and observed working:
  subtitle on match, no-subtitle on no-match, status-gated `fetchPipelines` for both desktop
  sidebar and phone sheet, other-sections-unaffected (verified via regression tests + manual
  check of Sources/Dashboards/Pipelines sections rendering unchanged).
  - No subtitle-in-filter regression (verified via test + design decision 6).
- All 22 task items in tasks.md are marked done and match the diff (selector, wiring, styling,
  4 test files).
- No scope creep: diff touches only the 7 files-modified.md-listed source/CSS/test files plus
  planning artifacts. No backend/schema files touched (`git diff main...HEAD --stat` confirms
  frontend + openspec/changes only).
- No regressions to existing behavior: full frontend test suite (1136 tests, 106 suites) passes;
  targeted regression tests for other sidebar sections pass.
- No API-contract changes — correctly out of scope, none made.
- Planning artifacts (proposal/design/tasks/spec) accurately reflect the final implementation;
  files-modified.md is accurate.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **CONTRIBUTING.md compliance**: no inline FQNs introduced (frontend-only diff, rule is
  Scala-focused and N/A here); imports are top-of-file. `npm run check:scala-quality` run
  independently — passes clean (43 pre-existing informational warnings, none touch modified files).
  `npm run check:schemas` passes (schemas untouched, as expected). File-size soft budgets: new/
  touched files are 179–377 lines, under the 400-line "propose a split" trigger — no violation.
  (Non-blocking note below re: `App.tsx`.)
- **DESIGN.md [mechanical] compliance**: subtitle styling uses `--text-xs`, `--app-text-muted`,
  `--space-1`, `--control-md` tokens exclusively (`DashboardList.css:398-430`,
  `MobileNavSheet.css:123-149`) — no literal px font-sizes or hex/rgb colors. `SidebarItemList`
  (a canonical chrome primitive per DESIGN.md §6) is reused/extended rather than duplicated.
- **DRY**: `renderItemText` helper (`SidebarItemList.tsx:265-280`) is shared between the button
  and NavLink row variants instead of duplicating the subtitle-rendering JSX — good, avoids the
  divergence risk called out in design.md's own risk list.
- **Readable/Modular**: naming (`selectPipelineNameByOutputTypeId`, `pipelineNameByTypeId`,
  `registryItems`) is clear; no magic values; logic is self-evident and matches design.md's
  documented decisions closely (traceable 1:1 to Decisions 1–6).
- **Type safety**: no `any`; `Map<string, string>` typed selector; `SidebarItem`/
  `MobileNavSheetItem` gain a properly optional `subtitle?: string`.
- **Error handling / security**: N/A — pure derived-data rendering, no new I/O or user input paths.
- **Tests meaningful**: selector tests cover present/absent/empty `outputDataTypeId`; component
  tests cover subtitle-present, subtitle-absent (regression guard for other sections), and
  filter-ignores-subtitle; integration test covers cold-fetch-once and no-refetch-when-loaded.
  These would catch a real regression in any of the four spec requirements.
- **No dead code**: no leftover TODO/FIXME, no unused imports.
- **No over-engineering**: single memoized selector, no premature abstraction (e.g., no
  `renderSubtitle` render-prop, matching design.md's explicit rejection of that alternative).
- **Behavior-preserving**: `SidebarItemList`/`MobileNavSheet` changes are additive-only
  (`subtitle` is optional, default path unchanged) — confirmed both by reading the diff and by
  the "other sections unaffected" regression tests passing.
- Independently re-ran the full gate set (fresh evidence, not trusting the executor's report):
  `npm run lint` (0 warnings), `npm run format:check` (clean), `npm test` (1136/1136 passed),
  `npm run build` (succeeds), `npm run check:schemas` (in sync), `npm run check:scala-quality`
  (clean, pre-existing warnings only). `npm run check:openspec` reproduces the exact failure the
  executor cited as justification for `git commit -n` (change complete-but-unarchived) — the
  bypass claim is verified, not just asserted, and no other real gate was skipped.

### Phase 3: UI Review — PASS
Issues: none blocking.

Verified against the worktree's own servers (DEV_PORT=5443, BACKEND_PORT=8350), logged in as
matt@helio.dev.

- **Happy path**: Desktop sidebar (1440px) at `/registry` shows `Pipeline: <name>` subtitles for
  DataTypes matched to a loaded pipeline's `outputDataTypeId` (e.g. "HEL254WideType" →
  "Pipeline: HEL-254 Wide Table Pipelir…", ellipsis-truncated), and renders name-only (no
  subtitle) for unmatched entries (e.g. "EvalChunkType", "Evaluator Curl Upload"), exactly per
  spec's two scenarios.
- **Phone section sheet** (390×844): opened via the header's "Switch type registry" control —
  the sheet lists the same items with the same subtitles, confirming desktop/phone parity.
  Measured row heights via `getBoundingClientRect()`: all sampled rows (with and without a
  subtitle) are exactly 44px — the ≥44px tap-target requirement is met.
- **Other sections unaffected**: visually confirmed Sources/Pipelines/Dashboards sections (not
  screenshotted individually, but covered by the passing regression test suite) plus the direct
  visual absence of any stray subtitle markup on non-registry rows in the loaded sidebar.
- **No console errors**: 0 errors across desktop, phone-sheet, and light-theme checks (4 warnings
  present, but they originate from the pre-existing `selectPipelineOutputDataTypes` selector in
  `dataTypesSlice.ts`, untouched by this diff — confirmed via `git diff main...HEAD` showing no
  changes to that file; not a regression introduced by this change).
- **Breakpoints**: 1440 and 1100 render the desktop sidebar with subtitles correctly; 768 and 390
  correctly show the mobile shell (bottom nav, no persistent sidebar) with the section sheet
  providing the same list — consistent with the ticket's documented "sidebar is desktop-only
  below 768px" prior finding.
- **Light/dark parity**: toggled to light theme at 1440px — subtitle color/contrast reads
  correctly in both themes (muted-text token resolves appropriately in each theme block).
- **Accessible names / keyboard**: subtitle text is additional content inside the existing row
  button/NavLink, not a separately-focusable element — no new nested-interactive-element hazard
  introduced (matches the proposal's stated non-goal of not linking the subtitle).

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `frontend/src/app/App.tsx` is now 498 lines, above the CONTRIBUTING.md ~400-line threshold
  that calls for proposing a split in the PR description. This file was already over 400 lines
  before this change (this diff added 32 lines to it) and file-size warnings are informational
  only per the Pre-Commit Policy section, so this isn't a blocking issue for this ticket — but
  worth flagging as a candidate for a future decomposition pass (e.g. extracting the
  `mobileSheetItems` construction into a hook), since this change made it slightly worse rather
  than better.
- The four pre-existing `selectPipelineOutputDataTypes` "returned a different result" console
  warnings (unrelated to this diff) are still present on every registry-section visit; not this
  ticket's responsibility to fix, but a good target for a small follow-up cleanup ticket if none
  already tracks it.
