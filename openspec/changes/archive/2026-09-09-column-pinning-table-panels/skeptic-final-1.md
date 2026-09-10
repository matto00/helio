## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Worktree verified: `pwd -P` = `.../feature/column-pinning-table-panels/HEL-465`,
branch `feature/column-pinning-table-panels/HEL-465`, HEAD `f35a9d57` on `7bbc49d1`.
Dev server on 5897 confirmed to be OUR worktree's process (`ss -ltnp` → node pid
3805499, `/proc/3805499/cwd` → this worktree's `frontend`); backend java pid 3805268
on 8804. `assert-phase.sh servers` → `PASS`.

### What I verified (with evidence)

**Gates (all re-run by me, fresh):**
- `npm run lint` → exit 0 (`eslint . --max-warnings=0`, no output).
- `npm run typecheck` → exit 0.
- `npm run format:check` → "All matched files use Prettier code style!".
- `npm test` → helio-mcp 25 suites / 248 tests passed; frontend 299 suites /
  3172 tests passed.
- `frontend && npm run build` → succeeded (PWA precache generated). (Root has no
  `build` script — run from `frontend/`.)

**AC1 (freeze + horizontal scroll) — MET.** Live: scroll container
`.ui-data-grid` (`scrollWidth` 12000 / `clientWidth` 581). Setting
`scrollLeft = 600` left pinned `th[0]` at viewport x=297 (unchanged) while
unpinned `th[3]` moved 777 → 177, i.e. scrolled *under* the pinned region.

**AC2 (cumulative offsets, custom widths) — MET.** Three pinned columns resolved
`left` 0/160/320 with `position: sticky`. I drove a real resize drag on the first
pinned column (+80px): mid-drag and post-mouseup, column 1 = 240px wide and column
2's sticky `left` updated to 240px in lockstep. No gap, no overlap.

**AC3 (persistence across reload) — MET.** Full page reload: pins restored
(`category`/`company`/`date` pinned, `left` 0/160/320). SPA navigation away and
back also restores. A user-driven unpin of `date` produced exactly one
`PATCH /api/outputs/...` with body
`{"config":{"pinnedColumns":["category","company"]}}` (captured via an installed
fetch/XHR interceptor), and the `--last` separator class moved to `company`.

**AC4 (frozen/scrolling boundary visually distinct, light + dark) — NOT MET.**
See Change Request 1. Reproduced three independent ways.

**AC5/Decision 1 (leading contiguous run) — MET and coherent.** `aria-label`s
observed live: index 3 (== `numPinned`) reads "Pin column game_id"; index 4 reads
"Pin through column last_modified". Unpinning `date` (last pinned) dropped exactly
that one; the shipped `handlePinToggle` (`index < pinnedCount ? index : index + 1`)
matches design.md Decision 1.

**AC6 (no regression) — MET as far as I could exercise.** Sort on a *pinned*
column: `aria-sort=descending`, one `columnSort` PATCH, pins and offsets intact.
Filter row expanded: pinned filter-row `<th>`s carry `left` 0/160/320, `z-index: 3`,
`top: 40.5px` (both sticky axes). Resize verified above. Console errors: 0.

**Layering (Decision 5) — MET.** `document.elementFromPoint` swept every 5px from
x=380 to x=475 across the last pinned header cell: every hit resolves to that
pinned `<th>` (`z-index: 3`); the first foreign element appears at x=480, exactly
the boundary. No bleed-through.

**IconButton `aria-pressed` — safe.** The prop is an optional passthrough; when
undefined React omits the attribute, so existing consumers are byte-identical.
Live measurement of the pin control: `.ui-icon-btn--xs` 24x24 rendered, distinct
`title` ("Pin"/"Unpin") vs. `aria-label` ("Pin column X"), pressed state colored
`rgb(124,95,4)` = `--app-accent-text` (the WCAG-obligated token, not raw
`--app-accent`). Coarse-pointer media query raises it to 44x44
(`min-width`/`min-height` beat `--xs`'s fixed 24px). CR1 from evaluation-1 is
genuinely fixed.

**StrictMode / double-PATCH (evaluation-1 CR2) — the fix is INCOMPLETE.**
See Change Request 2. Measured, not inferred.

**HEL-520 collision — none.** `git log main` in this worktree shows `main` at
`7b872db9`, the exact branch base; no HEL-520 commits touch `DataGrid.tsx`,
`DataGrid.css` or `IconButton.tsx`. The diff contains no HEL-520 artifacts.

### Verdict: REFUTE

### Change Requests

1. **AC4 fails: the pinned/scrolling separator does not render at all — in either
   theme.** `.ui-data-grid__pinned-cell--last`'s
   `box-shadow: 4px 0 6px -4px color-mix(...)` (`DataGrid.css`) *resolves* in
   `getComputedStyle` but paints **zero pixels**, because
   `.ui-data-grid__table` is `border-collapse: collapse`, under which Chrome does
   not paint `box-shadow` on table cells.
   Evidence (three independent readings, stable):
   - Full-viewport screenshot at `scrollLeft=600`
     (`.playwright-mcp/hel465-skeptic-light-scrolled.png`): pixel row y=232,
     x=770..789 across the boundary is a uniform `(253,252,250)` — no gradient.
   - Element screenshot at `scrollLeft=400`
     (`.playwright-mcp/hel465-skeptic-grid-light2.png`): x=474..489 uniform at
     y=10 (header, `(239,236,230)`) and y=45..70 (body, `(253,252,250)`).
   - Dark theme (`.playwright-mcp/hel465-skeptic-dark.png`): same boundary,
     y=55 steps only from header bg to cell bg — no shadow.
   - **Probe (A/B root cause):** setting `borderCollapse: 'separate'` +
     `borderSpacing: 0` on the live table and re-screenshotting
     (`.playwright-mcp/hel465-probe-separate.png`) makes the shadow appear
     immediately — header y=10 x=480..486 = `(208,204,198) → (215,213,206) →
     (224,221,214) → …`, body y=50 = `(221,219,216) → (229,228,225) → …`. The
     declaration is correct; the table's `border-collapse` mode suppresses it.

   Required: make the boundary actually visible in rendered pixels, in both
   themes. `border-collapse: separate; border-spacing: 0` is the probe-confirmed
   route but changes how the table's existing borders resolve — verify no border
   regression if you take it. A `border-right` (which *does* render under
   `collapse`) on the `--last` pinned cells is the smaller-blast-radius
   alternative; note a `::after` pseudo-element will NOT work, as pinned cells are
   `overflow: hidden`. Whatever you pick, re-verify with **pixel sampling across
   the boundary in light AND dark** (a resolved `getComputedStyle` value is not
   evidence — that is exactly what passed this at cycle 1: evaluation-1.md's AC4
   bullet cites the computed `srgb(...)` values and "screenshots taken", never a
   rendered-pixel check). Also update `elevationTokenGuard.css.test.ts`'s pin if
   the declaration changes.

2. **CR2's StrictMode fix is incomplete: an unsolicited `pinnedColumns` PATCH
   still fires on every mount, with zero user interaction.** The reorder effect's
   first-render guard is `pinMountedRef`, and a ref is *not* reset by StrictMode's
   double-invocation of mount effects — the second run sails past the guard and
   calls the un-debounced `persistPinnedColumns`.
   Evidence: with a fetch/XHR interceptor installed, navigating away to another
   dashboard and back (no user pin interaction at any point) yielded
   `[{url: "/api/outputs/hel904-orphan-output-05d5…", body:
   "{\"config\":{\"pinnedColumns\":[\"category\",\"company\",\"date\"]}}"}]`. The
   same PATCH appears in the network log on a cold page load
   (request #469, `[PATCH] … => [200]`). A subsequent plain re-render (Filters
   toggle) produced **no** further PATCH, which rules out an unstable
   `columnOrder` identity and pins the cause on the StrictMode mount double-invoke.
   This also falsifies the in-code claim at `TableRenderer.tsx` (the CR2 comment)
   that `persistPinnedColumns` "is never called from inside a function React could
   invoke more than once" — an effect body is exactly such a function.
   Impact is dev-only (production has no StrictMode double-invoke) and the written
   value is identical to the stored one, so this is the *lesser* of the two
   findings — but it is the same defect class the evaluator blocked on in cycle 1,
   the fix's own comment asserts something ground truth contradicts, and it burns a
   write on every panel mount in dev. Fix the guard so it survives a double mount
   (e.g. seed a ref with the *value* the effect last persisted and no-op when
   unchanged, rather than a boolean "have I mounted"), and correct the comment.

### Non-blocking notes

- With three pinned columns in a 581px-wide panel, the pinned region consumes 480px
  and leaves ~100px of scrolling area. That is a consequence of the user's own
  choice, not a defect, and Decision 1 makes it self-inflicted-and-reversible — but
  a future ticket capping the pinned run at some fraction of the container width
  would be kind.
- Every one of the 82 column headers now carries a permanently visible pin icon in
  addition to the sort chevron. It reads busier than the filter affordance (which
  is disclosure-gated). Acceptable per Decision 3 and the design gate; worth
  revisiting if header density becomes a complaint.
