## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed head: `d91082585d3c455f4666ca42db6b0994a3a98e5c`. This report covers the changes since `3b884545b` (one commit).
Evidence is persisted under `/home/matt/Development/helio/.concertino/runs/HEL-1656/evidence/.concertino/scratch/HEL-1656/eval/c3/`, referred to as `EV/` below.

### Gates (fresh, final head)
| Gate | Result | Evidence |
|---|---|---|
| lint / format:check / typecheck | exit 0 / 0 / 0 | `EV/lint.log`, `EV/format.log`, `EV/tc.log` |
| `HELIO_JEST_MAX_WORKERS=2 npm test` (root 524; frontend 9215 tests) | exit 0 | `EV/jest.log` |
| `npm --prefix frontend run build` | exit 0 | `EV/build.log` |
| Playwright: hel1656 + hel1583/1584/1646/1668 (2 workers, fresh servers) | 142/142 passed | `EV/pw.log` |

### Phase 1: Spec Review — PASS
The evaluation-2 change requests are both resolved.

1. **Clip scoped to Full motion.** `data-pull-active` is now set only when `follows()` is true (`usePullToRefresh.ts:195`), so the snap pill is never clipped.
   - The jest tests assert the attribute in both modes.
   - The Off test carries a recorded mutation note.
2. **New `expectPillClear` e2e.** It checks four things while the pull is held and again while busy, under Off and Subtle:
   - the computed `clip-path` is `none`;
   - the pill has no intersection with the first title's text Range;
   - the pill has no intersection with any `.dashboard-chip` (the selector is real: `DashboardChipRow.tsx:125`);
   - the pill has a non-trivial size.

The AC1–AC8 standing from cycles 1 and 2 is unchanged.

**Would the new assertion be red on `3b884545b`? Yes, for two independent reasons.**
- **The clip check fails.** At `3b884545b`, `outer.setAttribute(PULL_ACTIVE_ATTRIBUTE, "")` runs on every engagement. That makes `.mobile-panel-pull[data-pull-active] { clip-path: inset(0 -100vmax -100vmax -100vmax) }` apply while the pull is held, so `getComputedStyle(...).clipPath` is an `inset(...)` value, not `"none"`. `expect(r.clip).toBe("none")` fails on the first held call.
- **The chip check also fails.** In cycle 2 I measured the pill at y 135–163 against chips at y 109–141, so `overlapsChip` would be true there as well.

### Phase 2: Code Review — PASS
- `padding: 2px var(--space-3)` uses a literal 2px. DESIGN.md §Spacing allows literal "small optical tweaks ≤ 4px", so this is within the rule.
- `font-size: var(--text-xs)` uses a token.
- No new hover styles or literal durations.
- The upward-drag e2e now starts on the first card, not at a fixed y coordinate. This is reasonable and was green in the 142/142 run.

### Phase 3: UI Review — PASS
Measurements are in `EV/pweval.log`. Conditions: touch emulation, at 375 and 430, in light and dark, under Off, plus Subtle at 375 light.

| Element | Vertical span (y) | Notes |
|---|---|---|
| Chips | 109–141 | |
| Snap pill | 147–169 | |
| First card | starts at 155 | |
| Title | starts at 173 | |

- The pill clears the chips by 6px and the title by 4px, and is centred horizontally.
- Wrapper `clip-path` is `none`, and the stack transform is `none`.
- Text is readable in the held and busy screenshots: `EV/shots/held-375-light-off.png`, `held-430-dark-off.png`, `busy-430-dark-off.png`, `busy-375-light-off.png`.
- Whether the visual treatment is right is a judgment call left to the skeptic.
- Full motion, desktop 1280 and the refresh fan-out are unchanged since cycle 1, and were covered again by the green e2e run.

hel1584 `morphs the series` passed in this run. It is not attributable to this change; see evaluation-1/2.

### Overall: PASS

### Non-blocking Suggestions
- The pill clears the title by about 4px. A future change to card header padding could close that gap, but `expectPillClear` would catch it.
- From cycle 1, still open: spin off the pre-existing issue where the phone-stack chart sometimes stays collapsed after first load under Full motion. It reproduced on the base commit.
