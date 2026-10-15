## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed head: `e04ddb34811adc5b831818db4d0756ea065c2e8e`. Base: `cd64409ad`, resolved live. Cycle-2 delta reviewed: `94521a80f..e04ddb348`.

Durable evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1605/evidence/openspec/changes/stabilize-row-delete-confirm/eval-evidence-c2/`. It holds content dumps only, so no claim here depends on mtimes.

### Phase 1: Spec Review — PASS

- **Cycle-1 CR1 is fixed.** At 768x900 on /sources, I14 now holds:
  - both presses land on B's Delete, with dTop 0, in light and dark;
  - `.app-content` scrolls 55→6, where cycle 1 left it unmoved at 55.
- **Cycle-1 CR3 is done.** Task 2.9 is ticked. The evidence comes from the evaluation-1 live matrix plus this cycle's re-run.
- **Spec delta.** The "Switching the confirm to another row (page can compensate)" scenario now holds at every probed width.
- **Constraints.**
  - C1, C3, C4, C6 and C7 are honoured.
  - C2 is met: this evaluation ran the matrix, both themes at 768 and a spot-check of the other widths.
- **evaluation-1.md committed into the change dir.** Harmless. It is a planning/evidence artifact and gets archived with the change.

### Phase 2: Code Review — PASS

Fresh gates, run in `/home/matt/Development/helio/.claude/worktrees/bug/overview-row-delete-confirm/HEL-1605`:

| Gate | Result |
|---|---|
| lint, format:check, typecheck, check:e2e-types, frontend build | all exit 0 |
| `npm test` (3 workers), root | 51 suites / 469 tests passed |
| `npm test` (3 workers), frontend | 611 suites / 7264 tests passed (+1 vs cycle 1) |
| `--json` run on this worktree's paths | rowDeleteFocus.test.ts 19, useNow 4, ConfirmInline 7, formatRelativeTime 3, all passed |
| E2E `DEV_PORT=7037`, `--workers=2 --repeat-each=2`, `e2e/hel1574-shell-rail.spec.ts` + `e2e/hel1605-row-delete-confirm.spec.ts` | **50 passed**, exit 0; includes the new `768px: I14 (1px-overflowing table scroller)` cell twice; teardown deleted 50 users |

Code review findings:
- **`rowDeleteFocus.ts` `scrollerChain` / `applyPin`.** The design is sound:
  - it records every `overflow-y: auto|scroll` ancestor plus the document scroller;
  - it hands on what each one actually absorbed, measured as the change in `scrollTop`, so clamping does the work;
  - it stops at less than 0.5px remaining.
- **Horizontal-only table scrollers** (e.g. /pipelines) clamp at 0 and pass the delta on. That is correct.
- **CR2 is fixed.** The no-op `requestAnimationFrame` and its comment are gone.
- **The `cancelReveal` alias was dropped.** The suggestion is taken: `clearTimer` is registered directly, and the add and remove listener options match (capture).
- **Unit tests** use scrollTop-clamping test scrollers. They cover:
  - the 1px-overflow inner scroller with an outer scroller that has room (outer 48→6);
  - a split delta.
- **The comment explains *why*** overflow is no longer tested: the measured 998/997 case. This complies with CONTRIBUTING.

### Phase 3: UI Review — PASS

Servers: reused, and healthy. `assert-phase.sh servers` printed PASS. The processes on ports 7037 and 9944 have their cwd in this worktree's `frontend/` and `backend/`.

**Live matrix re-run** (`probe.cjs`, unchanged from cycle 1; fresh rows, browser clock aged 8s per double-click; both pages):
- Configs: 768 light, 768 dark, 375 light, 375 dark, 820/list 400 light, 1280 dark.
- Every I1, I2, I4, I5, I6, I7, I8, I9, I10, I11, I13, I14, I16, I17, I20 and I21 cell matches cycle 1.
- Top delta is 0 for every double-click cell (I2, I5, I8, I14, I17), on both pages, at every probed width.
- The one exception is below.

**768 /sources I8 (both themes).**
- The page is at scrollTop 0, so it cannot compensate. This is the documented D2 limit, the I19-class case.
- Press 2 lands on B's "Confirm delete" button.
- The second-press guard (D2b) holds: the only DELETE requests in the run are the intentional ones (sources 2, from the I9 confirm and the refused 409; pipelines 1, from I11).
- Exactly one confirm stays open, and the URL is unchanged.

**Console.** Only the expected 409 (refused delete) and the pre-existing 404 on the pipeline detail page after the I10 navigation.

**Mutation guards.** I ran in-browser mutations of `rowDeleteFocus.ts` via `page.route` on the Vite module; no worktree file was touched. Results are in `pin-mutations.txt`, 2 runs each.

| Cell | Unmutated head | Cycle-1 behaviour (`firstOnly`, pin only on the nearest auto ancestor) | M2 (no-op pin) |
|---|---|---|---|
| I14 at 768 | green, light and dark | red: dTop -42, press 2 off B | red: dTop -42 |
| I8 at 375 | green | — | red |
| I14 at 375 | green | — | green |

- So the new 768 cell is a real guard, which agrees with the executor's swap-in claim.
- I8 remains the M2 guard.
- I14 at 375 stays green under M2 because scroll anchoring absorbs the shift. That matches red-guard-evidence.md's classification: I14 at 375 is red-on-base, not an M2 guard.
- M0, M1 and M5 were not re-run by the executor. The cycle-2 delta touches none of their code: `useNow` and the table call sites (M1), the `ConfirmInline` `ignoreRepeatClicks` guard (M5), and the row-click `detail > 1` guard (M0) are byte-identical to `94521a80f`. Their guard cells are also unchanged; only the I8/I14 loop was parametrised.
- Cycle 1 already confirmed M1 independently (`eval-evidence-c1/m1-in-browser-mutation.txt`). I judge those guards to still hold.

**Executor notes, verified.**
- **Relaxed precondition `scrollTop >= aHeight`.** True, but `aHeight` is the confirm *group* height (25px). The shift that has to be compensated is the confirm *row* height (42px measured).
  - The precondition is therefore weaker than its comment says. It cannot make the cell pass vacuously, though: a non-compensable geometry would turn the < 2px assertion red, not green.
  - In the 768 cell, scrollTop is 48 ≥ 42, so the cell genuinely is the compensable case. Non-blocking.
- **"A's confirm not above the viewport in the 768 cell."** Confirmed: the `groupBottom < 0` check is restricted to 375. The 768 cell is I14's switch geometry without the anchoring half, and the test title says so ("page scrolled by about A's confirm height").

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `e2e/hel1605-row-delete-confirm.spec.ts:173`: compare `scrollTop` against A's confirm **row** height (`aGroup.locator("xpath=ancestor::tr")`). That makes the precondition match its comment ("needs scrollTop >= that height").
- Carry-over from cycle 1: file the "New pipeline" toolbar press-2 follow-up for the D2-limit region.
- Carry-over from cycle 1: after a pointer double-click, focus sits on the row's Delete rather than on the confirm group. This is the same as base and is an a11y follow-up candidate.

Throwaway data:
- The 22 probe users from this cycle were deleted by exact id via `buildUserDeleteSql` + `db.cjs psql`. A re-count over those ids returned 0.
- The e2e teardown deleted its own 50 users.
- The dev account was not touched.
- Servers are left running.
