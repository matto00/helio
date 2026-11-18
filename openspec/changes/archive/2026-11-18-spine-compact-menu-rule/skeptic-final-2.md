## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `7a361a77e521167d28889132dfede1bfe1819ed4` against the live-resolved base `361c22f223ee27409b045860aab6ab889bbbb687`. The base came from `resolve-review-base.sh` (exit 0, `REVIEW_BASE_BRANCH=main`, `REVIEW_BASE_REMOTE=origin`). The cycle-2 delta (`c3a25b4a9..HEAD`) touches `PipelineSpine.css` (+10/-), `e2e/hel1608-spine-count-overlap.spec.ts` and one wording fix in the spec delta.

Evidence directory: `/home/matt/Development/helio/.concertino/runs/HEL-1671/evidence/.sk/`. Every file named below with the `skeptic-final2-` prefix is in that directory.

### What I verified (with evidence)
- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/spine-compact-menu-rule/HEL-1671`.
- **Servers:** started with `start-servers.sh` on 7103/10010 with `DATABASE_URL` set to the lane DB `helio_hel1671`, and `assert-phase.sh servers` printed `PASS servers`.
  - The backend really is on the lane DB: `pg_stat_user_tables` for `users` in `helio_hel1671` shows 198 inserts and 196 deletes.
  - Servers stopped with `stop-servers.sh` (`STOPPED ports=7103,10010`).
- **Full e2e, run by me:** `e2e/hel1608-spine-count-overlap.spec.ts` plus `e2e/hel1579-pipeline-spine-layout.spec.ts`, with `DEV_PORT=7103`, `--workers=2`, `nice -n 19`, project `dev`.
  - Result: **19 passed (2.0m), exit=0**. Log: `skeptic-final2-skeptic-final2-e2e.txt`.
  - This includes the HEL-1579 769–1100px sweep (header fits, no page scroll, both themes, list default and max) and the 820/900/1100px no-scroll tests.
- **Hover-gating guard and spine jest tests:** `npx jest --maxWorkers=3 src/features/pipelines/ui/pipelineHoverGating.css.test.ts src/features/pipelines/ui/spine`. Result: **8 suites, 60 tests passed**.
- **CR2 (round 1) is no longer vacuous.** Two things in the new block make it real:
  - It selects the row where `scrollWidth > clientWidth`.
  - It has a hard soft-assert that such a row exists at 769px list default.
  - The seed adds a "Compute column" trunk step.
  - `red-cycle2.txt` records the new assertions failing on c3a25b4a9's CSS at 769 default, 769 max and 900 max. Those are the box-intersection and `covered` checks.
  - In my green run, the "truncated title exists" assertion passed, so the check ran against a real truncated title. I did not re-run the mutation myself: the gate is read-only and the recorded red names the exact assertions.
- **CR1 (round 1), measured on my own seeded pipeline.**
  - Setup: 5 steps, including a depth-1 lane "Compute column" row; widths 769/900/1024/1100; light and dark; list default and max. Data: `skeptic-final2-results.json`.
  - In every compact case, the selected trigger's top equals the title box's bottom and does not intersect it. Examples:
    - 769, selected lane row: trigger y 751–779, title y 733–751.
    - 1024: trigger y 693–721, title y 675–693.
  - The trigger is 28px (`--control-sm`) and sits centred in line 2's 28px band, with `--space-1` below it. It is no longer wedged into the row's corner, which resolves round 1's consistency note.
  - Zoomed shots, both themes, including the trigger's hover fill: `skeptic-final2-zoom-light-769-trunk-selected-trighover.png` and `skeptic-final2-zoom-dark-769-trunk-selected.png`. The hover fill sits under line 1's ellipsis and does not touch it.
- **Item 1 (one ⋮ rule):** cards always show ⋮; the selected row's ⋮ has opacity 1 at every width; unselected rows are hidden until hover or focus. Seen live: `skeptic-final2-light-default-769.png`, `skeptic-final2-dark-max-1024.png`, and the results JSON (`opacity`).
- **Item 2 (marker gap):** the `:has(> .spine-row__markers:empty)` re-templating is unchanged since round 1, and its e2e is green.
- **Item 3 (compact mode is actually on):** live box widths:

  | Width, list default | Spine box | Mode |
  |---|---|---|
  | 769px | 147px | compact |
  | 900px | 207px | compact |
  | 1024px | 212px | compact |
  | 1100px | 238px | regular |

  The guard e2e is green.
- **Item 4:** decided in D4. Live at 1100px list default: "Compute column" is 85/110 on the trunk and 65/110 on the depth-1 lane. Both are above the ~60px floor.
- **Item 5:** the spec delta now says "at or below 600px", which matches `@container (max-width: 600px)`. That closes round 1's non-blocking note.
- **Side effect judged: every compact row grows from 50 to 58px.**
  - The height is built only from tokens (`minmax(var(--control-sm), auto)`, `padding-bottom: var(--space-1)`), and it is uniform, so selecting a row causes no height shift.
  - Neither DESIGN.md nor the spine specs set any spine-row height contract.
  - Title widths are unchanged by the row height. Compact titles are 99px on top-level rows and 79px on lane rows at a 147px box, both above the ~60px floor.
  - The page does not scroll: `scrollHeight` 900 equals `innerHeight` 900 in all 16 width/theme/list combinations, and the hel1579 sweep is green.
  - The cost is about 8px more spine-internal scroll per compact row. Visually the rhythm stays even: the title-to-summary spacing reads balanced in both themes. Acceptable.
- **Light/dark parity:** selected accent wash, hover rung and trigger rendering are equivalent in both themes in the zoomed shots.
- **DB hygiene:** my one throwaway user was deleted by exact id and email via `buildUserDeleteSql` (COMMIT). The remaining count for that email prefix is 0.

### Verdict: CONFIRM

### Non-blocking notes
- On a selected compact row at a 147px box, the summary is squeezed to about 6px (trunk; "k = n * 2" shows as "k" with no visible ellipsis) or to 0px (depth-1 lane). This follows from D2's trailing track and HEL-1608's "summary sheds first" decision, and the selected step's config is shown in the editor beside it. A follow-up could hide the summary outright when it is under 1ch, so a single glyph does not read as the whole summary.
- The unselected compact row's hover overlay (HEL-1608, unchanged) is vertically centred on the taller row and covers the right end of the count while hovered (`skeptic-final2-zoom-dark-769-unsel-hover.png`). This predates this change and is not a regression.
- The evaluator's round-1 notes are resolved: cycle 2 removed the unused `markersDisplay` field and simplified `hitInMenu`.
