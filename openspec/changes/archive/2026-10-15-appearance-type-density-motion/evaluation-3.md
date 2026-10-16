## Evaluation Report — Cycle 3 (evaluation-3.md)

**What I reviewed.** HEAD is `39a600806c528076bf09d518d6b8578234fb340f`: the HEL-1576 merge (38de7610a) on top of the squash e6f2d3dfe and the archive commit 25409bcbf.
- The review base, resolved live with `resolve-review-base.sh`, is `38de7610a`. origin/main is an ancestor of HEAD.
- The worktree was clean before and after.

**Evidence location.** Durable copies are under `/home/matt/Development/helio/.concertino/runs/HEL-1572/evidence/.concertino/scratch/HEL-1572/eval3/` (written `EV3/` below). The probes ran from `/home/matt/Development/helio/.concertino/scratch/HEL-1572/eval3/`, never from inside the worktree.

**Squash and archive integrity.**
- `git diff 97b9fa449 e6f2d3dfe` touches only change-dir docs: `evaluation-1/2.md`, `files-modified.md` and `skeptic-final-1/2.md`. No code differs.
- 25409bcbf is pure renames into `archive/2026-10-15-…` plus the canonical spec sync.
- The skeptic fix ecfe75421 → 97b9fa449 does two things:
  - AccentPicker becomes `repeat(8, 28px)` above 768px, and `repeat(4, 28px)` inside `@media (max-width: 768px)`. The CSS test pins both.
  - The Theme-row swatch tokens change.

### Phase 1: Spec Review — FAIL

**The merge dropped no HEL-1576 behaviour.** I checked this file by file against the two parents.
- **HEL-1576-only files.** All 72 files HEL-1576 changed and this branch did not are byte-identical at HEAD and 38de7610a (`git diff --quiet` on each).
- **This branch's-only files.** All are identical to 25409bcbf, except `theme.css`. Its only change is `--density-grid-gap: 18px` → `var(--space-3)`, which is the intended re-baseline.
- **Untouched files.** No file outside either branch's set differs.
- **The five files both branches touched** keep both sides:
  - `DesktopPanelGrid.tsx` keeps HEL-1576's `dragConfig`/`resizeConfig` `enabled: isEditingLayout`, plus `gridMetrics(useDensity())`.
  - `panelGridConfig.ts` keeps one `GRID_GUTTER_PX = 12` and its `--space-3` / `panelGridConfig.test.ts` doc. It adds `COMPACT_GRID_GUTTER_PX = 8` and `gridMetrics`.
  - The two CSS-count guards read 144: HEL-1576's comment for 141→142 plus ours for 142→144.
  - `DESIGN.md` keeps HEL-1576's text and adds the Density table at 12px / `--space-3`.
- **Remaining consumers.** A grep finds no `panelGridConfig.margin`/`rowHeight` consumer outside `gridMetrics`. Tidy and edit mode take metrics from the same RGL props.

**The density re-baseline is correct**, and matches owner ruling Q1 and C5.
- Comfortable is `var(--space-3)`, which equals `GRID_GUTTER_PX = 12`.
- Compact is 8px, with `rowHeight` 52 + (12 − 8) = 56, so the row step is 64 in both densities.
- `appearanceTokens.css.test.ts` passed in the full jest run, as did HEL-1576's own `panelGridConfig.test.ts`.

**Issue (spec divergence): the canonical specs and DESIGN.md now contradict each other on the desktop gutter.**
- `openspec/specs/appearance-preferences/spec.md` (Density requirement) makes the desktop panel-grid gutter the Compact token (8px) for a Compact user.
- But HEL-1576's canonical `openspec/specs/panel-content-sizing/spec.md` says, unqualified:
  - `:76`: "The panel grid SHALL use `rowHeight: 52`, `margin: [12, 12]`".
  - `:82-84`, Scenario "Gutter follows the token": "the gap between them is the `--space-3` value (12px)".
  - `:15`: the 308px default-panel scenario.
- `DESIGN.md:1049-1051` (§9) also says, without qualification: "Dashboard grid gutter. `--space-3` (12px), horizontal and vertical … **[mechanical]**".
- Under Compact the shipped code renders `margin [8, 8]` and `rowHeight 56`, so those statements are false for a Compact user. The archive has no `panel-content-sizing` delta that reconciles them.
- **This was a gap in my own earlier cycles.** The same conflict existed against the old 18px text since cycle 1, and I did not flag it then.

**Everything else from cycles 1 and 2 still holds.** ACs 1-5, owner rulings Q1-Q3, constraints C1-C6 and the Off-twin guard are all unchanged by this merge.

### Phase 2: Code Review — PASS

**Gates, run fresh in this worktree.**

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm --prefix frontend run build` | exit 0 |
| `HELIO_JEST_MAX_WORKERS=2 nice -n 19 npm test` | root 55 suites / 485 tests; frontend 637 suites / 7580 tests; all passed (`EV3/jest-summary.txt`) |
| Full Playwright (`flock … e2e.lock`, 2 workers, `nice -n 19`, DEV_PORT=7004) | 340 passed in 16.2m (`EV3/e2e-full.log`) |

- The jest counts match the executor's report.
- The full Playwright run covers HEL-1576's specs and all HEL-1572 specs (Mono parametrization, HEL-866 contrast guard in both themes).
- Load was 2.67 at launch and 4.15 at the end, so no rerun was needed.
- `sbt testFull` was not re-run: `git diff 540bda525 HEAD -- backend schemas` is empty, and the cycle-1 run passed with 8150 succeeded and 0 failed.

The merge resolution is clean: there is no duplicated declaration, no dead import, and comments name the real guards. Issues: none.

### Phase 3: UI Review — PASS

Servers were started with `start-servers.sh`, and `assert-phase.sh servers` printed `PASS`. The probes are `EV3/metarow*.cjs`, with results in `EV3/out*/metarow*.json`.

**Density on a real dashboard at 1280** (4 panels, h = 5/4/6/5). Boxes sorted by position:

| Density | tops | heights | horizontal gap |
| --- | --- | --- | --- |
| Comfortable | 72, 72, 328, 392 | 308, 244, 308, 372 | 798 − 786 = **12** |
| Compact | 72, 72, 328, 392 | 312, 248, 312, 376 | 796 − 788 = **8** |

- Panel tops are identical across densities, and every Compact panel is exactly 4px taller.
- Screenshots: `EV3/out/density-comfortable-1280.png`, `EV3/out/density-compact-1280.png`.

**HEL-1576 meta row under Mono + Compact.**
- Coverage:
  - Mono in both themes and a Sans baseline.
  - View mode at 1440/1280/1180/1100/1024/980/900/820.
  - Edit mode at every width where the Edit layout control is in the row (1440 to 1120).
- Results, in every record:
  - 0 controls overflowing the row.
  - Row `scrollWidth − clientWidth` = 0.
  - Document horizontal overflow = 0.
  - 0 clipped button labels.
  - 0 console errors.
  - Tier switching is identical to Sans at every width.
- Mono costs about 20-26px of action width, for example 437 vs 411 in view mode and 680 vs 661 at 1440 in edit mode. At 1280 in edit mode the row is 976px, actions take 397 and the left side keeps 523, so the space is ample.
- Screenshots: `EV3/out2/meta-mono-light-1440-edit.png` (Undo / Redo / Tidy layout / Done (neutral pressed) / Share / Add panel, all legible), `EV3/out2/meta-mono-dark-1280-edit.png`, `EV3/out2/meta-mono-light-820-view.png`.
- At 768 and 375 the dashboard uses the phone chrome (no meta row) in both themes. Document overflow is 0, and the stack renders (`EV3/out3/meta-mono-dark-375-view.png`). The mobile title ellipsizes ("Quarterly re…"), which is pre-existing command-bar behaviour.

Issues: none.

### Overall: FAIL

### Change Requests

1. **Reconcile the desktop gutter statements with density.** This is documentation only; no code changes.
   - (a) In `openspec/specs/panel-content-sizing/spec.md`, qualify the "Grid layout sizing baseline" requirement (`:76`) and its scenarios (`:15`, `:78-84`) as the Comfortable (default) density. Add that under Compact density (`appearance-preferences`) the grid uses `margin: [8, 8]` and `rowHeight: 56`: the same 64px row step, panel tops unchanged, each panel 4px taller.
   - (b) Add a matching `## MODIFIED Requirements` delta, `specs/panel-content-sizing/spec.md`, to `openspec/changes/archive/2026-10-15-appearance-type-density-motion/`, so the archive records the change.
   - (c) In `DESIGN.md:1049-1051` (§9 "Dashboard grid gutter"), make the bullet say `--space-3` (12px) at the default Comfortable density and 8px under Compact. Point it to the Spacing → Density table, and name both guards (`panelGridConfig.test.ts` and `theme/appearanceTokens.css.test.ts`).
   - (d) Run `npm run format:check`; the OpenSpec hygiene check also runs in the pre-commit hook.

### Non-blocking Suggestions

- The archived `tasks.md` "Execution notes" (`:85-86`) still say Comfortable is 18px and Compact `rowHeight` 62 because HEL-1576 had not merged. Add a one-line note that the merge 39a600806 re-baselined Comfortable to 12px and Compact to 56.
- These carry over from earlier cycles:
  - Share one roving-radio keyboard handler between `TypeStyleCards` and `SegmentedRadioGroup`.
  - Shorten the type-card accessible names.
  - `missingOffTwins` accepts a twin nested in an unrelated `@media` block.

### Critical Path

This is the final cycle (3 of 3, `EXECUTION_CYCLES = 3`). The only thing between this head and a PASS is CR1:
- It is a documentation-only reconciliation of three statements: two canonical-spec passages and one DESIGN.md bullet. They still say the desktop grid gutter is always 12px, while the shipped Compact density renders 8px.
- There is no code, test, gate or UI defect. Every gate is green on 39a600806: lint, format, typecheck, build, jest 7580/7580, Playwright 340/340.

**Recommendation for the human:** let the executor apply CR1 as a docs-only commit. A re-run of `format:check` plus the OpenSpec hygiene hook is sufficient evidence, because no runtime file changes. Alternatively, accept the merge as-is and file a follow-up to reconcile the specs. Either way the contradiction must not be left unrecorded: `panel-content-sizing`'s "Gutter follows the token" scenario is a **SHALL** that Compact users violate by design.
