## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: 94b1288aa871960ba4d1afdfc4493226c7398e7d (base c42c7ddf3dfe87971f9ed209160cf81578a19e80, resolved
live).

### Phase 1: Spec Review — PASS
Issues: none.

Cycle-1 change requests, each checked:
1. **Real last item probed: done.**
   - The provenance cases now probe `a.provenance-popover__link`, the "Open pipeline" link and the content's
     `lastElementChild`.
   - `red-e2e-2.txt` shows all 6 cases red under the mutation (`bottomInset` ignored), on both (a) `clearOfNav` and
     (c) `navInStack`. That includes 390x844 in light and dark, the cases that were not red in cycle 1.
   - (b) `hitIsItem` stays green before the fix, because the popover paints over the nav, as D0 and design predicted.
   - The C1 checks are unweakened: `toMatchObject({clearOfNav: true, hitIsItem: true, navInStack: false})` is unchanged.
   - This agrees with my independent cycle-1 measurement: with the unfixed fit, the link's centre lands at about 797,
     against a nav top of 776.
2. **Setup guard: done.** The guard now asserts that the unfixed fit would put the last item's centre in the nav band
   (`unfixedItemCentre > navTop`). The centre's offset is measured in pass 1 with the panel scrolled to its end.
   - The gap fallback (use the measured gap if it is between 0 and 12, else 8) matches the 8px `TRIGGER_GAP` both
     popovers use.
3. **Safe-area and dialog branches: done, and they can now fail.**
   - The stub reports 34px for the hidden probe element only.
   - Three new tests cover: nav absent gives 34, a panel in an open dialog gives 34, and a visible nav gives 76.
   - `red-unit-safearea.txt` (`readSafeAreaBottom` returning 0) shows 2 tests red.
   - `red-unit-dialog.txt` (dialog rule dropped) shows 2 tests red.
   - The stub's match (`aria-hidden="true"` plus `position: fixed`) matches the probe element in `panelFit.ts`.
4. **Task 3.2 findings: recorded** in files-modified.md and probe.md.
   - UserMenu (`placement="nav"`) opens above its trigger, so it needs no change.
   - The HEL-1746 ask drawer is a `BottomSheet` over a `showModal` Modal, so the open-dialog rule applies.

All acceptance criteria are met:
- The red-before/green-after `elementsFromPoint` check holds at 390x844 and 390x400, in light and dark.
- The full HEL-1750, HEL-1756 and HEL-1759 spec files pass.

Every caller in design.md's tables is handled (unchanged since cycle 1). The C1 constraint is honoured.

### Phase 2: Code Review — PASS
Gates, re-run by me in WORKTREE_PATH. Logs are in `/home/matt/Development/helio/.concertino/scratch/HEL-1762/eval2-*.txt`.
- `npm run lint`: exit 0.
- `npm run format:check`: exit 0.
- `npm run typecheck`: exit 0.
- `npm test` (3 workers): exit 0. Root: 66 suites / 579 tests. Frontend: 820 suites / 9927 tests (3 new).
- `npm --prefix frontend run build`: exit 0.

Code delta this cycle: one comment in `panelFit.ts`, plus test and e2e changes. `jest.restoreAllMocks()` in `afterEach`
restores the prototype spy. Issues: none.

### Phase 3: UI Review — PASS
- The lane DB `helio_hel1762` had been dropped after cycle 1. I recreated it, and the backend migrated it (141 flyway
  rows).
- Servers were started with `start-servers.sh`.
- Full spec files, 2 workers, `nice -n 19`: `hel1750-actions-menu-viewport-fit`, `hel1756-popover-viewport-fit`,
  `hel1759-popover-keyboard-focus` and `hel1762-popover-clears-bottom-nav`. Result: **40 passed, 4 skipped** (the
  designed skips), exit 0. Log: `eval2-e2e.txt`.
- Teardown deleted the 40 recorded users, and 0 `@example.test` users remained.
- Servers were stopped with `stop-servers.sh`. The lane DB had no remaining connections and was then dropped, as the
  orchestrator asked.

### Overall: PASS

### Non-blocking Suggestions
- The executor's commit includes `evaluation-1.md` in the change dir. That is fine: it is the expected location.
