## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `540bda5253ab5c8fc9bdcc9898b36c65b8d55cf6` (executor commits 4129a2111 + f45dc94c2, plus a clean merge of
origin/main 7fd2f4f29). The review base was resolved live with `resolve-review-base.sh` (main/origin) to `7fd2f4f29`.
The worktree had no uncommitted changes, before or after the review.

Durable evidence directory: `/home/matt/Development/helio/.concertino/runs/HEL-1572/evidence/e2e-evidence/hel1572-eval/`
(abbreviated `EV/` below). Every claim below rests on content: logs, per-frame probe output, JSON and diffs. None rests
on file mtimes or ordering.

### Phase 1: Spec Review — PASS

- **AC1 (type style re-renders live and persists across devices): met.**
  - e2e `hel1572…:108` passed in the full run.
  - I also drove it by hand in the MCP browser on :7004. Picking Mono set `data-type-style="mono"`, and `h1`, `body` and
    the segment buttons all computed to JetBrains Mono with no reload. The Sans preview card stayed Schibsted Grotesk.
- **AC2 (density switches the documented token sets): met.**
  - Comfortable: `--density-grid-gap` is 18px (`GRID_GUTTER_PX`; HEL-1576 is still unmerged on origin/main, whose
    `panelGridConfig.ts:34` reads `[18, 18]`) and rows use `--space-2`.
  - Compact: 8px gap, `rowHeight` derived as 62, rows use `--space-1`.
  - Applies to the panel grid, SortableTable consumers and ContextList. The SortableTable consumer list is re-derived by
    grep: Connectors, PipelineListTable and SourceListTable, which matches the executor's enumeration.
  - Owner ruling Q1 and C5 are honoured. DESIGN.md Spacing carries the table.
- **AC3 (Off disables token-driven motion; no preference + OS reduce gives Off): met.**
  - The global rule and all 6 component rules are scoped to `:root:not([data-motion])`, with `[data-motion="off"]`
    twins.
  - Off tokens are `0.01ms`, stagger `0ms`, never `0s` (C4).
  - e2e `:405` passed.
- **AC4 (schema, OpenAPI and backend persist the fields, with tests): met.**
  - Both JSON schemas are updated. `motion` is nullable only in the request schema.
  - Backend: `PreferencesPatch`, a single-statement merge with `- 'motion'`, invalid stored values dropped on read.
  - Tests: 5 new `UserPreferencesRoutesSpec` cases, including cross-user isolation through the app role, plus
    AuthServiceSpec login/OAuth coverage.
- **AC5 (no flash, verified in a real browser): met.** I verified it myself (Phase 3).
- **Owner rulings Q1–Q3:** keys, attributes and tokens are named exactly as ruled. Mono covers the whole UI through the
  font tokens only. A grep of `frontend/src` found no ad-hoc `font-family`.
- **Skeptic design-5 non-blocking notes 1–6:** all folded in.
  1. A non-vacuity precondition (`e2e/support/typeStyle.ts` `assertTypeStyleActive`; seeded server-side, not via the
     cache).
  2. A 44×44 expander sized on both axes, with the hover scale moved to the inner `.accent-picker__dot`.
  3. A Range-based container sweep at 375/820/768/1280.
  4. Tabular check on `.run-history-modal__row-duration`, with the mutation.
  5. Both sync pairs (`appearanceTokens.css.test.ts:36-41`).
  6. No "tooltip" wording remains in the spec deltas.
- **CONSTRAINTS C1–C6:** honoured. C3 was re-run by me (Phase 2).
- **Scope:** no creep. HEL-1575 field names (`dashboardTabs`) are not touched.
- **Planning artifacts** match what was implemented.

**HEL-813 `.regression` twin, Case B: confirmed pre-existing on pristine origin/main.**
- How I checked: a throwaway detached worktree at `7fd2f4f29`, own servers on :7094/:9994,
  `HEL813_REGRESSION=1 … -c playwright.regression.config.ts`.
- On main: Case A passed. Case B failed with `mutated FAIL box={"width":341,"height":44} threw=false` and "assertFloor
  must fail on the width axis".
- On this branch under `HEL1572_TYPE_STYLE=mono`, the result is identical: Case A passed; Case B `box={"width":339,…}
  threw=false`.
- Cause: `.mobile-nav-sheet__item-row .mobile-nav-sheet__item { flex: 1 }` (added by HEL-590, e01aa6d49) defeats the
  injected `width: 20px`.
- This branch's `MobileNavSheet.css` diff touches only the reduced-motion blocks.
- The scratch worktree and its servers were removed. `git status` in both worktrees was clean after the
  self-reverting mutations.
- Evidence: `EV/hel813-regression-main.log`, `EV/hel813-regression-branch-mono.log`.

**Isolated DB (`backend/.env` → `helio_hel1572`): does not mask a migration problem.**
- `backend/.env` is gitignored (`.gitignore:28`), and `git status --short` shows no tracked change.
- This branch adds no migration: `git diff --name-only 7fd2f4f29...HEAD -- backend/src/main/resources` is empty.
- `flyway_schema_history` in both the shared `helio` DB and `helio_hel1572` is at V135, the latest file on disk, with 0
  failed rows.

### Phase 2: Code Review — FAIL

Gates were run fresh in this worktree.

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm --prefix frontend run build` | exit 0 |
| `HELIO_JEST_MAX_WORKERS=2 nice -n 19 npm test` | root 55 suites / 485 tests; frontend 628 suites / 7462 tests, all passed |
| `flock … sbt -J-Xmx3g testFull` | 8150 succeeded, 0 failed, 4 canceled; "All tests passed" |
| Full Playwright suite (`flock`, 2 workers, `nice -n 19`, DEV_PORT=7004) | 340 passed (16.1m) |
| HEL-866 contrast guard under `HEL1572_TYPE_STYLE=mono` | 18 passed, both themes |

Gate notes:
- **Build:** `dist/app.html` keeps the pre-paint script and the JetBrains Mono 700 weight in both links.
- **jest:** `--listTests` resolves to `/home/matt/Development/helio/.claude/worktrees/feature/appearance-type-density-motion/HEL-1572/frontend/…`.
- **sbt:** the log shows the build file under this worktree's `backend/`, and `UserPreferencesRoutesSpec` "accumulate
  appearance fields…" ran.
- **Full Playwright suite:** includes all 14 HEL-1572 tests, the HEL-813 floor spec in both sans and mono, and the
  HEL-866 contrast guard in both themes.
- **Load:** 1-minute load was 2.86 at the e2e start and 5.55 at the end; the peak during gates was 13.7 (jest), and no
  failures were seen. No rerun was needed.

Evidence: `EV/jest-summary.txt`, `EV/sbt-summary.txt`, `EV/e2e-full.log`, `EV/contrast-mono.log`,
`EV/e2e-load-start.txt`.

Issues:

1. **A contract comment names a guard file that does not exist.**
   - `frontend/src/theme/theme.css:103` says `(densitySync.test.ts) fails when they drift`.
   - `frontend/src/features/panels/ui/grid/panelGridConfig.ts:14` says ``(guarded by `densitySync.test.ts`)``.
   - No such file exists; `grep -rn densitySync frontend/src` hits only these two comments. The guard is
     `frontend/src/theme/appearanceTokens.css.test.ts`, and DESIGN.md "Density" names it correctly.
   - These are exactly the two lines HEL-1576's merge will conflict on (18 → 12). The comment is the instruction the
     person resolving that conflict follows, and it points nowhere.
   - CONTRIBUTING.md "Comments": a contract comment that has silently stopped being true.
2. **The reduced-motion guard's "Off twin" check is file-level, and its mutation test is tautological.**
   - In `frontend/src/theme/reducedMotionScopeGuard.css.test.ts:76`, `expect(source).toContain(':root[data-motion="off"]')`
     passes once a file has any Off rule. A block that scopes three selectors but only twins one stays green.
   - The test at `:87-90` ("fails (mutation) when a scoped block has no Off twin") never calls guard code. It asserts a
     string literal it just built does not contain a substring, so it can never fail.
   - Task 3.7 claims the guard is "mutation-checked"; for the twin half it is not.

Checked and clean:
- No `any` and no untyped escape hatches.
- No dead code, and no TODO/FIXME left behind.
- Tokens: `--space-*`, `--text-*`, `--weight-*`, `--control-md` and `--app-accent*` only. The type cards' inline
  `--font-heading` is the documented DESIGN.md §3 exception.
- Backend input validation: enum sets, 400 with no write, and the repository is keyed only on the session user.
- Error handling: `saveAppearancePreferences` swallows a failure deliberately, keeping local state, with the reason in
  a comment.
- Tests are meaningful: a real-RGL geometry test, the per-frame e2e no-flash test with two negative controls, a
  hit-extent bisection and a tabular-nums mutation.

### Phase 3: UI Review — PASS

Servers were started with `start-servers.sh … 7004 9911 HEL-1572` and `assert-phase.sh servers` printed `PASS servers`.

- **AC5 no-flash, checked per frame in a real browser** (my own probe, `EV/noflash.cjs`; output in `EV/noflash.log`).
  - The probe is a rAF loop installed with `addInitScript`. It records `data-type-style` and the first visible
    heading's computed family before every paint, for the saved style `serif` (then `mono`).
  - New device (cookie, empty localStorage), loading /settings: frames show `ts:null` → `ts:"sans"` with no heading
    yet → `"Settings | Fraunces"`. The ProtectedRoute spinner covers the server round-trip, and no heading frame is
    ever painted in the default face.
  - Cached reload, /settings and /home: `ts:"serif"` from the first frame (t≈13ms), with the first heading in Fraunces.
  - Stale cache on this device (`sans` cached, `serif` saved elsewhere): the first heading frame is already Fraunces.
  - Mono cached reload: `ts:"mono"` from the first frame, and the first heading is JetBrains Mono.
  - Plus the passing e2e pair `:155`/`:176` and its negative controls `:205`/`:225`.
- **Visual and clip matrix** (`EV/matrix.cjs`; `EV/matrix2/matrix.json`, 72 records).
  - Coverage: dark/light × sans/mono/serif × comfortable/compact × 1280/820/768/375, on /settings (comfortable) and
    /home. Requests were paced to stay under the per-user rate limit.
  - Results: every record has the attributes matching the saved prefs, and `body` is JetBrains Mono exactly when Mono
    is saved. There is 0px horizontal page overflow and 0 console errors other than the pre-auth 401s.
  - 0 clipped buttons, radios, tabs, th/td, labels, eyebrows, links, headings or context-list rows. The ellipsis-styled
    elements and the visually-hidden `app-content__sr-heading` are excluded.
  - I looked at the screenshots `EV/matrix2/settings-light-mono-comfortable-375.png`,
    `EV/matrix2/settings-dark-mono-comfortable-820.png`, `EV/matrix2/home-dark-mono-compact-1280.png`,
    `EV/matrix2/home-light-serif-comfortable-768.png` and `EV/appearance-dark-sans-1280.png` beside the board. Mono is
    legible in both themes and rows and controls align. Layout matches the board (left label column, three preview
    cards, segmented Density/Motion, dashed Theme "Later" row); differences are noted under Non-blocking.
- **Signed-out reset:** after the session was dropped, /login showed `data-type-style="sans"` and the
  `helio-appearance` cache was removed (`null`).
- **Keyboard:** Density segment `tabIndex` is `[0,-1]`. ArrowRight moved focus to Compact, checked it, and set
  `data-density="compact"`.
- **Touch, contrast and console:** HEL-813 floor spec (sans and mono, at 430/768) passed, the Appearance hit-extent
  tests at 375/768/1280 passed, the HEL-866 guard passed in sans and mono in both themes, and no console errors
  appeared in the tested flows.

Issues: none.

### Overall: FAIL

### Change Requests

1. In `frontend/src/theme/theme.css:103` and `frontend/src/features/panels/ui/grid/panelGridConfig.ts:14`, replace
   `densitySync.test.ts` with `theme/appearanceTokens.css.test.ts`, the guard that actually pins both pairs.
2. In `frontend/src/theme/reducedMotionScopeGuard.css.test.ts`, make the Off-twin check real and failable:
   - Extract an exported helper, e.g. `missingOffTwins(source: string): string[]`. For every selector
     `:root:not([data-motion]) X` inside a reduced-motion block, it returns X when the stripped source has no
     `:root[data-motion="off"] X` selector.
   - Use the helper in the per-file `it.each`, replacing `expect(source).toContain(':root[data-motion="off"]')` at
     `:76`.
   - Rewrite the mutation test at `:87-90` to call the helper on a fixture where one of two scoped selectors has a twin,
     and expect `[".y"]`, the untwinned one.

### Non-blocking Suggestions

- `AppearanceSection.tsx` `TypeStyleCards.onKeyDown` duplicates `SegmentedRadioGroup.onKeyDown`'s roving-radio arrow
  handling line for line. A small shared `useRovingRadio` hook in `shared/ui` would remove the copy.
- The type-style radios' accessible names read "Markets & Business 140 Sans + mono". Consider `aria-label={card.label}`,
  with the preview text kept `aria-hidden`.
- Design-judgment differences from the board are left to the skeptic:
  - The accent swatches stay in the pre-existing 4-column grid (2 rows), not the board's single row of 8.
  - The type cards wrap "Markets & Business" at 1280.
- Robustness: when `/api/auth/me` fails transiently at boot (status → `unauthenticated`), `useAppearanceState` resets
  the root to defaults and clears the cache. The next load then has no cache, and only the ProtectedRoute spinner keeps
  it from flashing. This matches the accent's sign-out handling and is out of this ticket's AC.
