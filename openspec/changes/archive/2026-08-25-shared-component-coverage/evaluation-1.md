## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- All three in-scope AC items (PanelCard.tsx, PipelineDetailFooter.tsx, TypeDetailPanel.tsx rename inputs migrated
  to shared `TextField`) addressed explicitly. `DashboardList.tsx` deliberately excluded per the design.md
  reconciliation with HEL-708 — confirmed untouched (`git diff main...HEAD --name-only | grep DashboardList` →
  empty).
- No AC reinterpreted: "zero visual diff" framing from design.md's Decisions section was implemented literally
  (compound-selector CSS transcribed verbatim, not re-derived — verified byte-for-byte against the diff, see
  Phase 2).
- tasks.md: all checkboxes (1.1-1.5, 2.1, 3.1-3.4) are genuinely satisfied by the diff — 1.1/1.2/1.3's CSS blocks
  match design.md's Decisions section exactly; 1.4a (no half-migrated base/hover/focus splits) verified true for
  all three files; 1.4/1.5 (button recipes, empty/loading/error states) correctly left untouched — no violations
  existed in these three files to begin with; 2.1's guard test matches specs/raw-element-guard/spec.md's two
  scenarios exactly (queries by accessible name, asserts `ui-input` class, does not assert absence of
  TypeDetailPanel's legitimate checkbox inputs).
- No scope creep: diff touches exactly the 3 TSX files + their 3 CSS files + the new guard test +
  tokenAuditSweep.css.test.ts baseline updates + planning artifacts. No unrelated refactors.
- No regressions to existing behavior: full `npm test` suite (2833 tests) and e2e HEL-813 suite (12/12) both green
  fresh this cycle (see Phase 2/3).
- No API/schema contracts touched (pure frontend UI migration) — N/A.
- Planning artifacts (design.md/tasks.md/spec.md) accurately reflect the final implemented behavior — confirmed
  by direct diff-vs-design.md comparison.

### Phase 2: Code Review — PASS
Issues: none.

Gates re-run fresh in `WORKTREE_PATH` (no `CLEAN_WORKTREE` set, this is not `slow` speed):
- `npm run lint` — clean, zero warnings.
- `npm run format:check` — clean.
- `npm run typecheck` — clean.
- `npm test` — 257 suites / 2833 tests passed.
- `npx jest --testPathPatterns="tokenAuditSweep|rawElementGuardHel440"` — 2 suites / 79 tests passed (targeted
  re-check of the two guard files called out in the task).

CONTRIBUTING.md / DESIGN.md compliance:
- Compound-selector CSS overrides in `PanelGrid.css`, `PipelineDetailPage.css`, `TypeDetailPanel.css` transcribed
  verbatim from design.md's Decisions section — diffed line-by-line, no deviation found (property values, order,
  and selector compounds all match).
- `TextField` import paths use relative imports consistent with each file's existing import style (no new
  fully-qualified-name inlining).
- Token usage: all new/changed CSS declarations use existing `--app-*`/`--space-*`/`--text-*`/`--weight-*` tokens
  already present in the pre-migration rules; no new literal magic values introduced (the two hardcoded
  `0.125rem 0.375rem` / `2px 6px` padding values are unchanged carry-overs from the pre-existing rules, not new).
- `tokenAuditSweep.css.test.ts` baseline diff: all changed entries are pure line-number shifts consistent with the
  actual line deltas added by the compound-selector blocks (TypeDetailPanel.css: 181→186, a +5 shift matching the
  5 net lines added to that rule block; PipelineDetailPage.css: a consistent +12 shift applied to every entry at
  or after line 579, matching the net +12 lines added by that migration's CSS block). No entry was deleted,
  added-then-hidden, or had its file/property changed — this is a legitimate baseline shift, not a weakened
  assertion.
- DRY / no duplication: the CSS override approach is explicitly the design's chosen trade-off (compound-selector
  wins over `.ui-input`, not full consolidation) — reasoned and recorded in design.md, not an oversight.
- Type safety: `TextField` is a typed `forwardRef` wrapper; all three call sites pass typed props matching its
  `InputHTMLAttributes` surface; no `any` introduced.
- Tests meaningful: the new `rawElementGuardHel440.test.tsx` exercises all three real components (not mocks of
  the migration itself), queries by accessible name per spec, and asserts the `ui-input` class — a regression
  back to a bare `<input>` would fail this test.
- No dead code / no TODO-FIXME left behind in the diff.
- No over-engineering: the design's explicit decision not to add a new `TextField` "inline" variant (documented
  rationale in design.md) was followed — no speculative new prop/variant introduced.
- Behavior-preserving: `value`/`onChange`/`aria-label`/`autoFocus` props pass through unchanged at each of the
  three call sites (confirmed in diff) — a pure primitive swap, not a behavior change.

### Phase 3: UI Review — PASS
Issues: none.

Dev servers started via `scripts/concertino/start-servers.sh`/`assert-phase.sh` (both reported `READY`/`PASS`;
the `emit-event.sh` sub-call inside them errored as "No such file or directory" because this worktree's
`scripts/concertino/` predates several scripts main now has — non-blocking, cosmetic, doesn't affect the
health-check result itself).

Verified live via Playwright against the running dev server (port 5872) for all three migrated controls:

- **PanelCard** (`aria-label="Panel title"`, on the "Revenue by Region" dashboard's panel): computed style in
  rename mode — `padding: 2px 0px`, `border-bottom: 1px solid var(--app-accent)` (resolved to the accent orange),
  `background: transparent`, `font-size: 14px` (`--text-sm`), `display: inline-block` — matches design.md exactly.
  Screenshot at 1440px shows the same chrome-less underlined title look as pre-migration description (no boxed
  input, no focus halo visible in idle/no-focus state).
- **PipelineDetailFooter** (`aria-label="Pipeline name"`, on "HEL-758 Eval REST Pipeline"): computed style in
  rename mode — `padding: 2px 6px`, `border: 1px solid` accent-mid (resolved orange), `background` resolved to
  `--app-surface` dark value, `font-size: 14px`, intrinsic (non-100%) width — matches design.md's `width: auto`
  disposition exactly, confirmed no full-row stretch at 1440px or 430px.
  Screenshots at 1440px and 430px show a small boxed orange-bordered field sized to content, no layout breakage,
  no wrap regression in the flex footer row at either width.
- **TypeDetailPanel** (`aria-label="Data type name"`, on "HEL671b Window Output"): computed style — `padding:
  0.125rem 0.375rem`, `border: 1px solid transparent`, `background: transparent`, `font-size: 16px` (`--text-base`),
  `font-weight: 600`. `display: block` (not `inline-block`) is expected and not a defect: the element has
  `flex: 1` inside a flex container, and CSS's flex-item "blockification" rule converts any inline-level box to a
  block-level box once it becomes a flex item — this is standard browser behavior, not a regression, and
  design.md's own text anticipated this exact case ("`inline-block`... produces no visible difference for a lone
  text node" — confirmed true in the 430px screenshot, no visible chrome-less-title layout change).
  Screenshot at 430px shows the title rendering cleanly with no visible border/background, matching the
  "chrome-less" pre-migration appearance.
- No console errors attributable to the migration in any of the three flows (one unrelated pre-existing 404 on
  `/api/pipelines/:id/schedule`, present before and unrelated to this change — a demo-data gap, not caused by this
  diff).
- Breakpoints 1440/430/768 checked for the pipeline and data-type controls with no layout breakage; the panel
  card control checked at 1440 (desktop) with clean rendering.
- HEL-813 e2e guard (`e2e/hel813-mobile-touch-target-floor.spec.ts`) re-run fresh against the same dev server:
  12/12 passed at both 430px and 768px.

### Overall: PASS

### Non-blocking Suggestions
- None.
