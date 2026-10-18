## Evaluation Report — Cycle 2 (evaluation-2.md)

**Reviewed:**
- HEAD: `ba60f9d81d8c4e3c322afc4f8ae738728b0626c2`
- Live-resolved base: `d8387507734f8e74bbf62df8880923791ec7c08d`
- Change since cycle 1: commit ba60f9d81, which turns the compact `.spine-row__select` into a grid and adds `e2e/hel1608-spine-count-overlap.spec.ts` plus `red-proof-2.txt`.

**Evidence** (persisted under `/home/matt/Development/helio/.concertino/runs/HEL-1608/evidence/.concertino/scratch/HEL-1608/`):
- `eval2-probe.cjs`, `eval2-probe-summary.json`
- `eval2-mutate.cjs`, `eval2-mutate.txt`
- `eval2-{light,dark}-769-longcount.png`
- `eval2-{light,dark}-769-hover-lane.png`
- `eval2-{light,dark}-769-kbfocus-lane.png`
- `eval2-{light,dark}-390.png`, `eval2-{light,dark}-900.png`
- `eval2-e2e.log`, `eval2-gates.log`

The other cycle-2 screenshots (`eval2-{dark,light}-{769,1024,1100,1280}.png`, kbmenu-open) are in `/home/matt/Development/helio/.concertino/scratch/HEL-1608/`. All claims rest on measured px, computed styles or screenshot content; none rely on mtime ordering.

### Phase 1: Spec Review — PASS
- **Cycle-1 CR1 (count overprints summary):** resolved. In compact rows the select is now a 4-column grid: number, then summary as `minmax(0,1fr)`, then markers (`auto`), then count (`auto`). The title spans columns 2–4 and `.spine-row__text` is `display: contents`. The design D2(c) wording ("count on the summary line at its own width") is reflected in the CSS comment and in files-modified.md.
- **Cycle-1 CR2 (`4ch` padding):** resolved. The padding was removed and the only spacing values are `--space-2` and `0`.
- **AC1–AC3:** still met (see Phase 3). The hel1579 spec is unchanged this cycle, so C3 holds.
- **C1/C2:** honored. The phone layout is unchanged because the compact rules exist only under the `spine-column` container, which the desktop layout alone creates. All hel1582-* specs are green.

### Phase 2: Code Review — PASS
**Gates** (fresh, run in WORKTREE_PATH, nice 19):
- Lint, format:check and typecheck: exit 0.
- `npm test` with 2 jest workers: root 61/61 suites (524 tests) and frontend 723/723 suites (9049 tests). Exit 0.
- `npm --prefix frontend run build`: exit 0.
- e2e: ran under flock with 2 workers, `--trace retain-on-failure`, DEV_PORT=7040.
  - Specs: the new hel1608 spec, the whole hel1579 spec, and all four hel1582-* specs.
  - Result: 37 passed and 2 skipped. The skips are the pre-existing HEL-1582 slow-lane-only maximal sweeps. The HEL-1620 flake did not occur.
  - The new spec took 3.9s.

**Red proof for the new spec:** `red-proof-2.txt` shows a 42px overlap at 769 for "Sort rows" with count "12,345". I verified it independently with `eval2-mutate.txt`, which applies the spec's exact metric in-page with the count forced to "12,345":
- **Shipped CSS:** passes at 769, 849, 929, 1009 and 1100 on all 4 rows. The gap between count and summary is -16px (-30px on the row that has a warning marker).
- **Cycle-1 compact rules restored** (absolute count plus `4ch` padding): fails on every compact row at 769–1009 with 42px overlap (20px on the row with the marker). That matches red-proof-2.
- **Mutant** (count moved into the summary's grid cell): fails at 769–1009 with 42px overlap. The check therefore catches a real regression of the grid, and the fix is what makes it pass.

**Can the new spec pass vacuously?** No:
- Every row's count must be at least 5 characters, and the spec requires at least 3 rows (2 trunk rows plus 1 lane row).
- The seed is a 12,345-row CSV, and the spec waits until a "12,345" count is visible.
- The overlap uses the summary's full box. That is stricter than a glyph-level check: the cycle-1 CSS would have failed even with a 3-character count, because the count sat inside the summary's padding.
- Compact mode is active at the widths the spec sweeps. My probe found compact rows at 769–1009 with the list at 248 (152 compact samples) and at 400 (172).

**Seeding and isolation:** the spec registers its own throwaway user through `registerAndLogin`, and the run log shows `[HEL-1301 e2e] deleted 37 recorded throwaway user(s)`. Its data is therefore isolated and cleaned up with the user.

**Runtime:**
- The spec takes about 4s locally (3.7s in the red run).
- `node scripts/e2e-shard.mjs plan 4` puts it on leg 2 at a defaulted weight of 35s. That leg totals about 1192s, inside the 25-minute e2e job timeout, and the partition is exact.

**Code quality:** the CSS follows the spacing tokens and introduces no new colours. The grid placement is explicit and the comment states the contract. No dead code.

### Phase 3: UI Review — PASS
- **Title readability under the new grid** (my probe using the sweep's own measurement at 769–1100 in 8px steps):
  - 0 failures across default/dark, default/light, max/dark and max/light, with 43 lane-row samples in each combination.
  - The document never scrolls.
  - At 1280 the spine is 332px with the list at 248 and 280px with the list at 400, and all four titles are readable.
- **Red re-check:**
  - Restoring the HEL-1579 track still fails 132 samples per combination, 40 of them on lane rows.
  - Making the hidden ⋮ clickable (`pointer-events: auto` mutant) fails 152–172 samples per combination. The occlusion probe still works under the grid.
- **Long count** ("12,345" injected, both themes): no collision. The summary truncates with an ellipsis before the count ("dura… 12,345"), as seen in `eval2-light-769-longcount.png`. With the real 3-character counts the summary keeps more text ("duratio… 500").
- **⋮ reveal at 769 (compact), both themes:**
  - Idle and selected-without-focus: opacity 0, pointer-events none.
  - Hover: opacity 1, pointer-events auto, and the menu sits on the row's hover tone (light: `eval2-light-769-hover-lane.png`).
  - Keyboard: Tab from the row's select button reaches "Step actions for Compute column", which shows a visible focus ring after the transition (`eval2-{dark,light}-769-kbfocus-lane.png`). Enter opens the menu.
- **Other widths:** 900, 1024 and 1100 in light and dark have no clipping, and the non-compact rows at 1100 are unchanged.
- **Phone:** at 390 (light and dark) the step list, chevrons, counts and floating run pills render as HEL-1582 left them.
- **Console:** the only errors are `404 GET /api/pipelines/:id/schedule` responses for a pipeline with no schedule. These come from existing code and are not related to this change.

### Overall: PASS

### Non-blocking Suggestions
- When markers is `:empty` it is `display: none`, but its `auto` grid column still carries a `column-gap`. The summary therefore loses about 8px it could use. A two-template variant, or `.spine-row__select:has(.spine-row__markers:empty)` dropping that column, would give that space back.
- The new spec does not assert that compact mode is actually engaged at 769 (for example via the menu's computed `position: absolute`). The hel1579 sweep would catch a broken container query on titles, but an explicit check would make this spec self-contained.
- With a 6-character count at 769, the summary is cut to about 4 characters. This is the intended trade-off (no collision) and is a judgment call for the skeptic, not a mechanical defect.

### Housekeeping
- The dev account's (`matt@helio.dev`) context-list width was PATCHed back to 248, which `eval2-probe.json` `prefsRestored` confirms. The probes left two pipelines on that account, `hel1608-eval-pipe` and `hel1608-eval2-pipe`, together with their sources.
