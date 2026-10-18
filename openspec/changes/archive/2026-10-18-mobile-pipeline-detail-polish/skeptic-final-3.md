## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Reviewed HEAD: `9148122e62ddebf3fb3d8971e08a27cfe408f7fd`. The live base from `resolve-review-base.sh` is `ecb8bb8a7c1d44adb13c28f7a600219ee7930589` (origin/main, HEL-1646).

The round-3 delta (`83e44e515..HEAD`) has two parts:
- A clean merge of origin/main (3c3f4c038).
- 9148122e6, which changes:
  - `PipelineSpineHeader.css`: `.spine-header__meta` goes from `flex: 0 10 auto` to `1 10 auto`, and `.spine-header__meta-text` gains `contain: inline-size; flex: 1 1 15ch`;
  - `PipelineMobile.css`: the phone meta goes from `flex: 0 1 auto` to `1 1 auto`;
  - comment fixes in `SpineRunStatus.tsx`;
  - two new cases in `e2e/hel1668-header-meta.spec.ts`, at 1280 and 1440.

Evidence root: `/home/matt/Development/helio/.concertino/scratch/HEL-1668/skeptic-final-3/` (`e2e.log`, `jest.log`, `live-1280-dark.png`, `live-768-light.png`). Persisted screenshots:
- `/home/matt/Development/helio/.concertino/runs/HEL-1668/evidence/e2e-evidence/HEL-1668/skeptic3-meta-gap-1280-dark.png`
- `.../skeptic3-meta-gap-1280-light.png`
- `.../skeptic3-meta-gap-1440-light.png`
- `.../skeptic3-meta-1000-14-dark.png`
- `.../skeptic3-meta-375-14-dark.png`
- `.../skeptic3-meta-375-12345678-light.png`

### What I verified (with evidence)

**Environment**
- `assert-cwd.sh` returned READY.
- `start-servers.sh` returned READY, and `assert-phase.sh servers` returned PASS on ports 7100 and 10007.

**Gates I re-ran myself**
- **Playwright** (2 workers, `nice -n 19`, `--trace retain-on-failure`): **73/73 passed**, EXIT 0, with no flaky or skipped tests. The run covered:
  - `hel1668-header-meta`, `hel1668-phone-sheet`, `hel1668-schema-panel-copy` and `hel1668-editor-phone-refresh`;
  - `hel1608-spine-count-overlap`;
  - `hel1582-mobile-pipeline`;
  - `hel1646-skeleton-refresh-slot`.
- **Jest** (2 workers, `nice -n 19`): 11 suites, **213/213 passed**. The suites were tokenAuditSweep, pipelineHoverGating, spineCopy, PipelineDetailPage.spine, resolveStepParam, OutputSchemaDisclosure, PipelineMobileLayout*, Toast.modal and PipelineSpine*.
- **Prettier** `--check` on the round-3 files: clean. **Typecheck** (`tsc --noEmit`): EXIT 0.

**Round-2 CR1 (a hidden count reserving width): fixed.**
- **Red first.** `red/meta-gap-83e44e515.txt` shows the new 1280 case failing on 83e44e515 with `nameTruncated:true`, `timeRight:826`, `boxRight:927`. On the same commit, 1440 passed with the count visible. So the guard can fail, and it is not vacuous.
- **Green now** (`e2e.log`, GAP lines). At 1280 in both themes: `countVisible:false`, `nameTruncated:false`, and the full name "hel1668-long-pipeline-name" is shown. At 1440 in both themes the count is visible and the name is whole.
- **Live sweep of the running app** with my own pipeline (29-character name, a real 14-row run, context list open, light theme unless noted):

| Width | Name | Meta / box | Time | Count | Header |
|---|---|---|---|---|---|
| 1440 | 235 px, at its 28ch max-width cap | box 752→1084 | 882→983 | visible, whole, inside the box | 44 px tall, no overflow |
| 1280 (light and dark) | at the 235 px cap | meta 171 px | 752→839/853 | absent: "14 rows written ·" needs about 130 px, about 85 px is left | no overflow |
| 1100 | flex-shrunk to 228 px | meta at its 15ch floor (108 px), time ends 8 px before box edge | — | — | no dead space |
| 1000 | flex-shrunk to 128 px | meta at its 15ch floor (108 px) | — | — | no dead space |
| 900 and 769 | — | hidden by the `@container (max-width: 600px)` rule, same as origin at ecb8bb8a7:255 | — | — | — |

  At 1100 and 1000 the header is genuinely full, so the shrinking name is not caused by reserved meta width.

  Phone header:
  - At 768 and 375 the run line has no overflow (`scrollWidth == clientWidth`). The count is whole, and the time sits inside the box.
  - "Add schedule" on its own row is by design: `.mobile-header__runline` is `flex: 1 0 100%`, so this is not a regression.
- **`contain: inline-size`: no new clipping or overflow.**
  - Header and document `scrollWidth - clientWidth` is 0 at every width above.
  - Header height stays 44 px on desktop, so there is no second row.
  - The time is fully inside its box in every reading, and the count is either whole and inside or absent. This is also covered by `hel1668-header-meta` at 1000, 1024 and 375 with 14 and 12,345,678 rows, both themes.
  - The grown meta keeps its content left-aligned (`row-reverse` + `justify-content: flex-end`), so its free space sits before the trailing controls, exactly where `margin-left: auto` put it before. No gap opens between the name and the status.
- **Visual check.** I looked at `skeptic3-meta-gap-1280-dark`, `-1280-light`, `-1440-light`, `-1000-14-dark`, `-375-14-dark`, `-375-12345678-light`, `live-1280-dark` and `live-768-light`. The header reads clean in both themes: the status chip, the time, and the count only where it fits. There are no fragments, and no blank space beside a cut name.
- **Round-2 comment fixes: done.**
  - `SpineRunStatus.tsx:76/78` now says "drops out whole" / "shown whole or not at all".
  - The `.spine-header__meta` comment no longer claims the count ellipsizes.

**HEL-1646 intact after the merge**
- `git diff --stat ecb8bb8a7 HEAD` over HEL-1646's files is empty, i.e. byte-identical to origin. Those files are:
  - `frontend/src/app/dashboardMeta`, `features/dashboards`, `features/panels`;
  - `backend`, `schemas`, `helio-mcp`, `App.tsx`;
  - `e2e/hel1646-skeleton-refresh-slot.spec.ts`.
- All 11 `hel1646-skeleton-refresh-slot` cases passed in my run: 375 and 430 in light and dark, in-app switches, and deleting the last panel.

**Full-change review (items 1-7, AC matrix, item 4 desktop, HEL-1608, C1/C2)**
- The branch diff against the live base touches only pipeline-feature files, the shared toast/modal files, and the token-audit test. HEL-1620's files (`App.tsx`, `hel1579-*`, `apiRequestCounter.ts`) are not in it, so there is no overlap.
- Items 1-7 at 375, 390 and 768, all green in my run:
  - item 1 (deep link, and narrowing opens no sheet);
  - item 2 (toast above the sheet, announced after its region sat empty — C1);
  - item 3 (Escape closes one layer at a time);
  - item 4 (phone panel ends above the bottom nav);
  - item 5 (no sticky hover on tap, plus the compact touch-tablet case at 1024);
  - item 6 (copy, and an 8-digit count never clips the time, at 375/390/768/1000/1280);
  - item 7 (an editor's phone refresh, at 375 and 768).
- The specs cycle both themes.
- Item 4 on desktop at 1000 and 1280: the panel picks above/below by its real content height, and stays capped and inside the viewport. Green.
- HEL-1608: `hel1608-spine-count-overlap` is green, and the compact block was not touched in round 3. C2's hover cascade order is covered by the `pipelineHoverGating` jest suite (green).
- Red-first records for items 1-7 were verified in rounds 1-2. The round-3 code delta is the meta-flex hunk only, and does not touch those paths.

**Gate-defect check (CON-160).** No report I drilled into discloses unsound mtimes, and none of my conclusions rest on mtime ordering. Every claim is backed by measured geometry, test output or a byte-level diff.

**Cleanup.**
- I deleted probe pipeline `b4593420-7312-42a8-afa3-2bf9302050ac` and source `2421d23b-3c2c-479c-a95c-8f4d0e5ec0d6` through the API (204 and 204).
- I deleted user `39b5284a-3300-40cc-81c4-bf33c34d0b16` by exact id (`DELETE 1`).
- The e2e run's global teardown deleted its own 75 recorded throwaway users.
- The dev servers on 7100/10007 are left running for the orchestrator. Stop them with `stop-servers.sh`.

### Verdict: CONFIRM

### Non-blocking notes
- `PipelineSpineHeader.css`'s `.spine-header__meta` comment has one line of about 160 characters; reflow it.
- The file-top comment (line 2) still says "Below ~1100px the meta text truncates with an ellipsis". That wording predates this change and no longer describes the behaviour.
- At 1000/1100 the name shrinks to fit the 15ch time floor (128 px at 1000). This is the accepted round-2 trade-off: the time is never cut. A future pass could hide the time below a container width instead.
- The round-1/2 notes still stand:
  - D5 leaves shared sheet controls ungated, so list it in the PR body or file a follow-up;
  - `files-modified.md` still has the stale "CONFLICT RISK" bullet;
  - `useNow` runs twice per source card.
- The console's `/schedule` 404 is HEL-1670's scope.
