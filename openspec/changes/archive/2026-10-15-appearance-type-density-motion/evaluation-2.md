## Evaluation Report — Cycle 2 (evaluation-2.md)

**Reviewed HEAD:** `ecfe7542156fc00c384c51f89b6d6083bc213d09`.
- Cycle 2 adds one commit, ecfe75421, on top of the cycle-1 head 540bda525.
- The review base was resolved live: `resolve-review-base.sh` with main/origin gave `7fd2f4f29`.
- The cycle-2 diff (`540bda525..HEAD`) touches three files:
  - `frontend/src/features/panels/ui/grid/panelGridConfig.ts`: one comment line.
  - `frontend/src/theme/theme.css`: one comment line.
  - `frontend/src/theme/reducedMotionScopeGuard.css.test.ts`: the guard test.
- No runtime code and no backend files changed.

**Evidence location.** Durable evidence lives under `/home/matt/Development/helio/.concertino/runs/HEL-1572/evidence/.concertino/scratch/HEL-1572/eval2/` (written `EV2/` below). My probes live outside the worktree, in `/home/matt/Development/helio/.concertino/scratch/HEL-1572/eval2/`.

**Correction to cycle 1.** In cycle 1 I left `.cjs` probe scripts in the worktree's gitignored `e2e-evidence/`. ESLint picked them up, which broke `npm run lint` for the executor. The orchestrator has since moved that directory out. Nothing from this cycle is in the worktree except this report.

### Phase 1: Spec Review — PASS

- **Cycle-1 CR1 is fixed.**
  - `theme.css:103` and `panelGridConfig.ts:14` now name `theme/appearanceTokens.css.test.ts`. That is the guard that pins `--density-grid-gap` to `GRID_GUTTER_PX` and `COMPACT_GRID_GUTTER_PX`, at lines 36-41 of that file.
  - A grep for `densitySync` over `frontend/src`, `DESIGN.md` and the change dir finds nothing, excluding the jest cache and evaluation-1.md.
- Cycle-1 CR2 is fixed; see Phase 2.
- **Everything else from cycle 1 still holds.** The cycle-2 change cannot affect any acceptance criterion, owner ruling or constraint, because it touches no runtime code. That covers ACs 1-5, owner rulings Q1-Q3, skeptic notes 1-6, constraints C1-C6, the HEL-813 Case B finding (pre-existing on main) and the isolated-DB check.
- C3 (full jest + full Playwright on the final head) was re-run on this head; see Phase 2.

### Phase 2: Code Review — PASS

**What the new guard does.** `missingOffTwins(source)` works per selector.
1. It collects every selector beginning `:root[data-motion="off"]` from the file's rules, with whitespace normalised.
2. It walks each `@media (prefers-reduced-motion: reduce)` block.
3. For each selector scoped `:root:not([data-motion]) X`, it reports the selector unless `:root[data-motion="off"] X` exists.
4. The real per-file assertion now runs `expect(missingOffTwins(source)).toEqual([])` on comment-stripped source. The old `toContain(':root[data-motion="off"]')` check is gone.
5. The new mutation test feeds it a fixture where `.a` has an Off twin and `.b` does not.
   - It expects `[":root:not([data-motion]) .b"]`, then `[]` once `.b` is twinned.
   - The old check would have passed that fixture, because the file contains an Off rule.

**Independent proof that the new guard goes red when a twin is missing.** I wrote my own sweep against the real CSS: `EV2/twinMutation.test.ts`, run via `EV2/jest.eval.cjs` with the frontend's own jest config. Output is in `EV2/twinMutation.log`.
- **Baseline.** All 7 real files that contain a reduced-motion block (landing excluded) return `[]`.
- **Mutation.** For every scoped selector in every real file, I disabled only its Off twin by renaming it to `offMUTATED`. That gave 14 mutations across:
  - `StreamingText.css` (1)
  - `RefinementChatDrawer.css` (2)
  - `BottomNav.css` (1)
  - `MobileNavSheet.css` (3)
  - `Skeleton.css` (1)
  - `toast.css` (2)
  - `theme.css` (4: the token block `:root`, `*`, `*::before`, `*::after`)
- **Result.** All 14 mutations went red, and each reported exactly the one mutated selector.
- **The old check would have missed most of them.** In 11 of the 14 mutated files another Off rule remained, so the old `toContain` assertion would have stayed green. The new guard closes a real gap.
- **Run counts.** 12 tests passed: my 2 plus the guard file's own 10.

**Gates (fresh, in this worktree).**

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 (this also confirms the lint breakage was my stray files, not branch code) |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm --prefix frontend run build` | exit 0 |
| `HELIO_JEST_MAX_WORKERS=2 nice -n 19 npm test` | root: 55 suites / 485 tests. Frontend: 628 suites / 7462 tests. All passed (`EV2/jest-summary.txt`) |
| Full Playwright suite | 340 passed (16.6m), `EV2/e2e-full.log` |

- **jest scope:** `--listTests` resolves the guard at `/home/matt/Development/helio/.claude/worktrees/feature/appearance-type-density-motion/HEL-1572/frontend/src/theme/reducedMotionScopeGuard.css.test.ts`.
- **Playwright run conditions:**
  - Command: `flock -w 3600 …/e2e.lock`, 2 workers, `nice -n 19`, DEV_PORT=7004.
  - Servers were started via `start-servers.sh`, and `assert-phase.sh servers` passed.
  - Coverage includes all 14 HEL-1572 tests, the HEL-813 floor spec under sans and mono, and the HEL-866 contrast guard in both themes.
  - Load: 10.06 at launch while the run was queued on the lock; 11.64 at about [128/340]; 3.54 at the end. There were no failures, so no rerun was needed.
- **Backend:** unchanged in this cycle, so `sbt testFull` was not re-run. Cycle 1's run on 540bda525 passed: 8150 succeeded, 0 failed.

**Issues:** none.

### Phase 3: UI Review — PASS

- The cycle-2 diff is two comment lines in UI files plus a jest test, so there is no rendered change.
- The full Playwright suite (above) passed on this head, including the HEL-1572 appearance, no-flash, density, motion, tap-target, clipping and tabular specs.
- Cycle 1's manual per-frame no-flash probe and the 72-record visual/clip matrix still apply unchanged.

**Issues:** none.

### Overall: PASS

### Non-blocking Suggestions (carried from cycle 1, still optional)

- **Duplicated keyboard handling.** `AppearanceSection.tsx` `TypeStyleCards.onKeyDown` duplicates `SegmentedRadioGroup.onKeyDown`. A shared roving-radio hook would remove the copy.
- **Verbose radio names.** The type-style radio accessible names read "Markets & Business 140 Sans + mono". Consider `aria-label={card.label}`.
- **Board differences (design judgment, for the skeptic).** The accent swatches sit in 2×4 rather than the board's single row of 8, and the card titles wrap at 1280.
- **Guard false negatives.** `missingOffTwins` matches the twin anywhere in the file, including inside another media block. A twin nested in an unrelated `@media` would satisfy it. No real file does this today.
