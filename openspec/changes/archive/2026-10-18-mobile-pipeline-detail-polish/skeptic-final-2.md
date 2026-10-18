## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: `83e44e515df33e6dfc6173d864e6d66a171d5383`. Live base from `resolve-review-base.sh`: `49021293b96c55fc9d80a6ed79b5b55d925fb6b7` (origin/main). Diff: `git diff 49021293b...HEAD`, 56 files. The round-2 delta (`90d13bc9a..HEAD`) changes one code file, `PipelineSpineHeader.css` (+17/-5), adds `e2e/hel1668-header-meta.spec.ts`, and updates artifacts.

Evidence root: `/home/matt/Development/helio/.concertino/scratch/HEL-1668/skeptic-final-2/` (`e2e.log`). The load-bearing screenshots are persisted under `/home/matt/Development/helio/.concertino/runs/HEL-1668/evidence/`:
- `skeptic2-desk-1000-dark.png`
- `skeptic2-desk-1280-dark.png`
- `skeptic2-desk-1280-light.png`
- `skeptic2-desk-1440-light.png`

### What I verified (with evidence)

**Environment**
- `assert-cwd.sh` returned READY.
- `start-servers.sh` reported READY, and `assert-phase.sh servers` returned PASS on ports 7100 and 10007.

**Gates I re-ran myself**
- **Playwright**, 2 workers, `nice -n 19`, `--trace retain-on-failure`, DEV_PORT=7100: **60/60 passed**, EXIT 0. Covered:
  - `hel1668-header-meta`, `hel1668-phone-sheet`, `hel1668-schema-panel-copy` and `hel1668-editor-phone-refresh`;
  - `hel1608-spine-count-overlap`;
  - all of `hel1582-mobile-pipeline` (it includes the two moved hover tests).

  This covers items 1-7 at 375, 390 and 768 in both themes, plus item 4 on desktop at 1000 and 1280.
- **Jest**, 2 workers, `nice -n 19`: 5 suites, 133/133 passed. The suites were tokenAuditSweep, pipelineHoverGating, spineCopy and PipelineDetailPage.spine, which are the ones that read this CSS.
- **Red-first record** (`/home/matt/Development/helio/.concertino/scratch/HEL-1668/red/meta-cr1-HEAD.txt`, read): on 90d13bc9a the new spec failed 5 of 6 cases with "nor ellipsized" (the 375/14-row case passed), so the guard is red-capable.
- Everything else from round 1 still holds: the round-2 code delta is that one CSS hunk. That covers the AC trace for items 1-7, C1 (toast announcement after two empty frames), C2 (hover cascade order) and HEL-1608 (compact block untouched, hel1608 green).

**CR1 from round 1: fixed.** No fragment survives.
- The `META` lines in `e2e.log` show that at 1000 and 1024 the count is either absent (`visible:false`) or whole.
- At 375 with 14 rows it is whole and inside the box.
- At 375 with 12,345,678 rows it is absent.
- The time is fully inside in every case and both themes.
- In the running app at 1000x800 dark (`skeptic2-desk-1000-dark.png`) the header reads "Succeeded · 11 seconds ago", which is clean.

**Accessibility of the wrap-clip technique: intact.**
- DOM order stays count, then time; only the visual flex order changes (`order: -1` + `row-reverse`), so reading order is unchanged.
- The clipped count is clipped by `overflow: hidden` rather than `display: none`, so it stays in the accessibility tree.
- `title` still carries the full "14 rows written · 11 seconds ago" (read from the live DOM).
- `aria-label="Last run metadata"` is unchanged from origin.

**Trade-off judgment (count hidden at 1000/1024): acceptable in itself.**
- Item 6 of the ticket is precisely that the time must not vanish.
- DESIGN.md's sibling-header pattern collapses facts whole, in steps.
- The figure stays available in `title`, the Runs tab, the source card ("Static · 14 rows") and the per-step counts.
- Showing "14 rows written…" without the time, as origin did, is the defect the ticket names. Hiding the count whole is the right side of that trade.

**But the technique has a side effect that is a visible regression (CR1 below).** I swept the running app with a real 14-row run and the context list open:

| Viewport | `.spine-header__meta-text` width | Count shown? |
|---|---|---|
| 1000 | 108 px | no |
| 1100 | 135 px | no |
| 1280 | 201 px | no |
| 1440 | 230 px | yes, "14 rows written · 1 minute ago" |

- At 1280 the meta box is 201 px wide but shows only the 101 px time. That leaves **113 px of empty space inside the meta, while the page title is truncated** ("skeptic-pipe-runs-tre…"). See `skeptic2-desk-1280-dark.png` and `skeptic2-desk-1280-light.png`.
- Cause: the flex item is sized from its max-content, which includes the wrapped-away count, so the hidden count still claims layout width.
- Proof by toggling: injecting `.spine-header__meta-count{display:none}` at 1280 shrinks the meta to 108 px and the name stops truncating (209 px, `scrollWidth == clientWidth`).
- Round 1 (90d13bc9a) had the same geometry, measured with an injected round-1 rule set: name 205 px, meta 201 px. There, the space was at least filled by text. Now the hidden count truncates the page's primary identity and leaves a visible gap beside it, at 1280, the main desktop width the ticket names. An experienced eye rejects a cut title sitting next to blank space.

**Gate-defect check (CON-160).** No report I drilled into discloses unsound mtimes, and none of my conclusions rest on mtime ordering.

**Cleanup.**
- I deleted my probe pipeline `f1f76ed2-c9e5-46f4-935e-48f3d7327946` and source `0b176770-ff3f-4a97-aff1-60e6d204bda2` through the API (204 and 204).
- I deleted user `925dc837-627e-4b97-b77f-5552ea0e3199` by exact id (`DELETE 1`).

### Verdict: REFUTE

### Change Requests

1. **The hidden row count still reserves its width, which truncates the pipeline name next to empty space.**
   - Where: `frontend/src/features/pipelines/ui/spine/PipelineSpineHeader.css:128-166` (`.spine-header__meta` `flex: 0 10 auto` / `min-width: 15ch`, and the new `.spine-header__meta-text` wrap-clip).
   - What happens at 1280x800 with the context list open: `.spine-header__meta` is 201 px, the visible time is 101 px, and 113 px is dead. Meanwhile `.spine-header__name` is flex-shrunk to 207 px and ellipsized, below its own 235 px max-width.
   - Required: when the count is not shown, the meta must give its width back to the header, so the name gets it before any blank space appears. Keep the round-2 invariants:
     - the count is whole or absent;
     - the time is always whole;
     - the count shows when the line genuinely fits (1440 does today).

     Possible routes, the executor's choice:
     - size the meta from the time alone and let it grow into free space, so the count appears only when the space is really free;
     - or replace wrap-clip with container-query hide steps, as DESIGN.md's sibling header does.
   - Required test: extend `e2e/hel1668-header-meta.spec.ts` at 1280x800, with the context list open, both themes, and a pipeline name long enough to be width-bound. Assert:
     - when the count is not visible, the meta's right edge is within 1ch of the time's right edge (no reserved gap);
     - and the name is not ellipsized while that holds, or is at its max-width.

     Also keep at least one case that asserts the count **is** visible when room exists (e.g. 1440). Otherwise the spec passes vacuously if the count is always hidden. Show the new assertion red on 83e44e515 first.
   - Also fix the comments the round-2 CSS made false:
     - `SpineRunStatus.tsx:76` ("The text ellipsizes…") and `:78` ("The row count ellipsizes first");
     - `PipelineSpineHeader.css` `.spine-header__meta` comment ("The row count ellipsizes (below)").

     None of them ellipsize any more.

### Non-blocking notes
- The round-1 non-blocking notes still stand:
  - D5 leaves shared sheet controls ungated, so file a follow-up or list it in the PR body;
  - the stale "CONFLICT RISK" bullet is still in `files-modified.md`;
  - two adjacent `@media (hover: hover)` blocks for each primary button could be merged;
  - `useNow` runs twice per source card.
- Origin's 404 on `/schedule` showed up in the console during my probe. It is HEL-1670's scope, not this lane's.
