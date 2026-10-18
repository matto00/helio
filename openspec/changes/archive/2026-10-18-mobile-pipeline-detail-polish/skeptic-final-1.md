## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `90d13bc9afe0ce9e69c1e50fde001e27cd201595`. Live base from `resolve-review-base.sh`: `49021293b96c55fc9d80a6ed79b5b55d925fb6b7` (origin/main, HEL-1669). Diff: `git diff 49021293b...HEAD`, 53 files.

Evidence root (durable): `/home/matt/Development/helio/.concertino/runs/HEL-1668/evidence/.concertino/scratch/HEL-1668/skeptic-final-1/`

### What I verified (with evidence)

**Environment**
- `assert-cwd.sh`: READY. `start-servers.sh` reused servers; `assert-phase.sh servers` PASS. I confirmed the listeners on 7100 and 10007 run from this worktree's `frontend/` and `backend/` (checked `/proc/<pid>/cwd`).

**Gates I re-ran**
- Targeted jest, 2 workers, `nice -n 19`: 19 suites, 270/270 passed. Covered: resolveStepParam, PipelineMobileLayout.deepLink, OutputSchemaDisclosure, pipelineHoverGating, spineCopy, Toast*, PipelineDetailPage.spine, tokenAuditSweep, usePortalPopover, ActionsMenu, SourceSampleLabel.
- Targeted Playwright, 2 workers, `nice -n 19`, `--trace retain-on-failure`, against DEV_PORT 7100: **30/30 passed**, EXIT 0 (`e2e.log` in the evidence root). Covered:
  - every `hel1668-*` test: items 1, 2, 3 and 5 at 375, 390 and 768; item 4 desktop at 1280 and 1000, and phone at 375 and 768; the compact touch tablet at 1024; item 6 at 375, 390, 768, 1000 and 1280; item 7 at 375 and 768; each in both themes;
  - `hel1608-spine-count-overlap` (the only hel1608 spec);
  - the two moved hel1582 hover tests.
- For full lint, typecheck and the full jest suite I rely on the output the evaluator pasted in evaluation-2.md, which is unambiguous.

**Red-first records** (`.concertino/scratch/HEL-1668/red/`, read in full)
- d1: 7 jest tests red, plus a missing module.
- d2: 6 jest tests red, and the single-rAF mutation red (gap 1 < 2).
- d3/d4: 2 jest tests red.
- d5: guard red with 53 offenders; e2e red at 375, 390 and 768.
- d6: 4 jest tests red.
- d7: mutation-proven guard (404 against 200).
- `e2e-on-origin-main.txt`: 24 of the hel1668 e2e tests fail on origin/main.
- Caveat on item 6: on origin/main the copy e2e fails first on the "Static" count. Its time-clip assertion was therefore never shown red on its own. This does not change the verdict.

**Acceptance criteria, traced to code**
1. **Deep link: met.**
   - `useStepDeepLink.ts` is a page-level one-shot.
   - `PipelineMobileLayout.tsx` opens the sheet from it during render, and a replace-sync effect derives `?step=` from the open step, gated on `consumed`.
   - `resolveStepParam.ts` is shared with `useStepSelection`.
   - In my browser at 1280, desktop selected step 2 from `?step=`.
2. **Toast above the sheet: met.**
   - `useTopModalDialog.ts` picks the most recently opened modal, and `Toast.tsx` portals into it.
   - **C1 holds:** `announced()` returns false for every toast until the second rAF sets `ready`. That covers race-window toasts and newly pushed ones alike. Older toasts are in `skip` and are never re-inserted.
   - The e2e proves the frame gap is at least 2, and the single-rAF mutation fails it.
3. **Escape: met.** `usePortalPopover.ts` calls `event.preventDefault()` only, with no `stopPropagation`. The e2e covers the schema panel and the step menu inside the sheet.
4. **Placement: met.**
   - `outputSchemaPanelPlacement.ts` reads the CSS custom properties; no px constants remain.
   - It places by `scrollHeight` bounded by the cap and clears the bottom nav outside a dialog.
   - Desktop is checked at 1280 and 1000; the "above" test was red on origin.
5. **Sticky hover: met for the pipeline page's own stylesheets.**
   - **C2 holds.** I read every hunk:
     - `.spine-row:hover` (:189), `.spine-row:hover{transparent}` (:344) and `.spine-row--selected:hover` (:356) keep their relative order inside separate `@media (hover: hover)` blocks;
     - the `.spine-row--selected` rest fill stays ungated between them;
     - the split `.mobile-pill--primary` and `.spine-header__btn--primary` rules keep rest before hover-base before hover-strong.
   - The compact HEL-1608 block is untouched, and the touch-tablet e2e matches origin's recorded tones.
6. **Copy: "Static" once and "from <step>" are met.** The last-run time is never clipped at 375, 390, 768, 1000 and 1280. **However, the desktop shape of this fix is defective. See CR1.**
7. **Coverage: met.** `hel1668-editor-phone-refresh.spec.ts` sends one `pipelineId`-scoped request and gets a 200. The guard was shown failable by mutation.

**HEL-1608 is intact.** The compact block and `@container spine-column` are unchanged, the hel1608 spec is green, and the spec delta only ADDs requirements.

**Judgment call (a), the moved hover tests: acceptable.**
- `git diff -w` shows only three changes: the context swap (`isMobile: false, hasTouch: false`, 375x812), the `try/finally`, and one reformat. Every assertion is byte-identical.
- The file's top-level `test.use` is `isMobile: true, hasTouch: true` (`hel1582-mobile-pipeline.spec.ts:38-41`). Under D5 a hover fill cannot apply there, so moving the tests to a hover-capable context is required, not a weakening.
- They can still fail. A lost or mis-ordered gated light pill rule makes `dryVsRest` 1.0.
- The touch side is covered by the hel1668 item 5 e2e. It asserts `matchMedia("(hover: hover)")` is false and that the fill after a real tap equals the rest fill, at 375, 390 and 768 in both themes. It was red on origin (d5-e2e-origin-main.txt).

**Judgment call (b), the header meta at 685px with `min-width: 15ch`: the hide threshold is sound, but the band just above it is not (CR1).**

**UI and design judgment** (running app, light and dark, plus the e2e screenshots from my own run)
- Phone pages look good in both themes at 375, 390 and 768:
  - the deep-linked sheet;
  - the toast inside the sheet, which hit-tests on top and does not overlap the sheet's controls;
  - the schema panel above the nav;
  - "12,345,678 rows writ… 3 minutes ago" at 375, where the number stays whole.
- The phone source card's extra label margin (expander tiling) reads slightly airy but is justified.
- Desktop 1280 looks good: "12,345,678 rows … 3 minutes ago", Static once, "from Compute column".

**Gate-defect check (CON-160).** No report I drilled into discloses unsound evidence mtimes, and none of my conclusions rest on mtime ordering.

**Cleanup.** I deleted my probe user `f420aef1-b515-4507-b241-40bd2d121e58` by exact id (`DELETE 1`). Before that I deleted its pipeline `884aeea2-…` and source `7b6f0c32-…` through the API (204 and 204).

### Verdict: REFUTE

### Change Requests

1. **The desktop last-run row count renders as a misleading 1-2 character fragment at about 990-1100px windows.**
   - Where: `frontend/src/features/pipelines/ui/spine/PipelineSpineHeader.css:128-161` and `SpineRunStatus.tsx:78-86`.
   - Cause: `.spine-header__meta-count` is `min-width: 0` and shrinks to almost nothing, while `.spine-header__meta-time` is `flex: none`.
   - Just above the 685px container threshold (with the context list open) the count therefore shows as:
     - **"1… 1 minute ago"** at a real 990x800 viewport with a 14-row run (`desk-990-light.png`);
     - **"1… 7 seconds ago"** at 1000x800 (`desk-1000-light-count8.png`, `zoom-desk-1000-light-count8.png`);
     - **"1 3 minutes ago"** with no visible ellipsis in this lane's own e2e screenshot at 1000x800 light with 12,345,678 rows (`e2e-copy-1000x800-light.png`, `zoom-1000-light.png`). That reads as "13 minutes ago", which is wrong information in the page header.
   - I measured the count span's width through the band by emulating the page container width in the running app:
     - 7px at 990;
     - 15px at 1000;
     - 39px at 1024;
     - 65px at 1050.

     The 990 and 1000 figures match the real-viewport resizes above.
   - On origin the same widths showed "14 rows written…": a whole number with the time lost (`crop-desk-1000-dark-origin-emulated.png` against `crop-desk-1000-dark.png`). So the change trades a lost time for a corrupted figure at 1000px, one of the two desktop widths the ticket names.
   - It also contradicts the lane's own spec scenario, "the header's last-run line is hidden rather than shown as a clipped fragment" (`specs/pipeline-detail-mobile-layout/spec.md`). It contradicts DESIGN.md's sibling header pattern too: facts collapse in steps ("below about 520px the facts collapse to the panel count"); they are never cut mid-figure.
   - **Required change:** never truncate inside the number.
     - Split the figure from its words: e.g. `.spine-header__meta-num` (`flex: none`) and `.spine-header__meta-words` (" rows written ·", shrinks and ellipsizes).
     - Then hide the whole count part when even the whole figure plus the time cannot fit. A container band from 686px up to where the figure fits would do it; or hide `.spine-header__meta-count` below a measured width, consistent with the existing 685px rule.
     - Apply the same rule on the phone header, where the number happens to stay whole at 375 today.
   - **Required test:** extend the item 6 copy e2e at 1000x800 and at a band width (e.g. 1024x800), both themes, 14 and 12,345,678 rows. Assert that any visible count text is either absent or contains the whole formatted figure (`toLocaleString`). Show the assertion red on the current HEAD before the fix.

### Non-blocking notes
- D5 leaves shared controls in the sheet ungated: IconButton (close, refresh), ActionsMenu items, `.ui-modal-btn` and Select. The design calls this a follow-up, but no follow-up ticket is cited in `files-modified.md` or the "UI decisions" list. File it, or list it in the PR body, so item 5 is not read as fully closed.
- `files-modified.md:15` still carries the outdated "ONLY the phone hover… test / CONFLICT RISK" bullet (the evaluator noted this too).
- Two consecutive `@media (hover: hover)` blocks for `.mobile-pill--primary:hover` and `.spine-header__btn--primary:hover` could each be one rule. The order is correct as is.
- `SpineSourceCard` now calls `useSourceSampleLabel` alongside `SourceSampleLabel`'s own call: two `useNow(30s)` timers per card. Harmless, but the label text could be passed down instead.
