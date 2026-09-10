## Skeptic Report — final gate (round 5, skeptic-final-5.md)

Cold review, SCOPED per the round-5 brief: verify exactly the two fixes in
`ddcdb6f1`, plus what they could plausibly break. Every number below is from the
running app at `http://localhost:5897` or a gate I ran myself.

### Ground truth / environment

- `pwd -P` under the worktree, `git branch --show-current` =
  `feature/column-pinning-table-panels/HEL-465`, `HEAD = ddcdb6f1` on top of
  `02c7e0dc`. Agrees with the brief.
- `start-servers.sh` → `READY` (reused). **Staleness trap from round 4 checked
  before trusting anything:** the served modules are current —
  `curl .../src/shared/ui/DataGrid.tsx | grep -c pin-reserve` → 2, and the served
  `DataGrid.css` contains both `--pin-reserve` and `min-height: 48px`.
- Surface: dashboard `SKF2-82col`, 82-column table, 75 header cells, 75 pin
  toggles, **3 columns already pinned** (`category`/`company`/`date`, inline
  `left` = `0px/160px/320px`) — i.e. exactly the 28/75 scenario the brief asked
  for, not the bare table.

### Gates (re-run by me)

- `npm run typecheck` — clean.
- `npm run lint` (`--max-warnings=0`) — clean.
- `npm run format:check` — "All matched files use Prettier code style!".
- `npx jest` — 299 suites / **3180 tests** passing, 29.1s (3 more than round 4:
  the executor's new static-source tests).
- Console at the reviewed navigation: **0 errors**.

The gates being green is not evidence for either fix. All three new tests assert
that a CSS *declaration exists*; neither declaration has any effect on the
rendered surface (below). This is a textbook declaration-present / effect-absent
green.

### 1. CR1 (header label paints under the pin icon) — **NOT FIXED. The fix is inert.**

The `padding-right` reservation is applied and computed correctly
(`.ui-data-grid__th--pin-reserve` present on the `<th>`, computed
`padding-right: 60px` = `--space-3` 12px + `--space-9` 48px). It changes nothing.

Full-table scan, viewport 1900×1000, stepping `scrollLeft` 0→12000 in 400px
increments, measuring each header label's text node with a `Range` (not a
`scrollWidth` heuristic) against the pin button's left edge, excluding
partially-offscreen cells:

- **75 header cells checked → 28 have label text painting past the pin button's
  left edge.** 8 of those genuinely truncate at the cell edge.
- **This is bit-for-bit round 4's number (28/75, 8 truncating).** The count did
  not move at all.

A/B toggle probe (live, no source edit), at `scrollLeft = 1200`:

| | cells under icon |
|---|---|
| shipped CSS (`padding-right: calc(var(--space-3) + var(--space-9))`) | 4 / 7 |
| overridden back to `padding-right: var(--space-3)` (pre-fix value) | 4 / 7 |

Identical. **The fix is not failable by removing it** — the strongest possible
evidence it is a no-op.

**Root cause of the no-op** (measured, not inferred): `overflow: hidden` clips at
the element's **padding box**, not its content box. Padding therefore reserves
*layout* space but no *clip* boundary. The label lives in `.sortable-th__btn`,
which computes `overflow: visible; white-space: nowrap; text-overflow: clip`, so
its text simply overflows the content box and paints straight across the reserved
60px padding band — under the icon, exactly as before. Example
(`player.injury_body_part`): text right edge 703.3, button left edge 649.0, cell
right edge 697.0 — the text overruns its own content box by ~66px.

The commit comment's stated mechanism — *"`padding-right` shrinks the `<th>`'s
available content width so the header content's own clip boundary … sits BEFORE
the icon's position"* — is false for this markup, and that is why the fix does
nothing.

**Seen, both themes**, screenshots inspected:
- Light (`hel465-r5-header-light.png`, `hel465-r5-sep-light.png`):
  `player.injury_sta▪_date`, `ry_no▪s`, `player.last_name▪`.
- Dark (`hel465-r5-dark.png`): `player.last_name▪`, `njury_stat▪s` — the pin
  glyph sits on top of both the label text and the sort chevron.

### 2. CR2 (44px control clipped at ≤430px / coarse pointer) — **NOT FIXED. The fix is inert.**

Measured at a real 420px viewport (`matchMedia('(max-width: 430px)')` → `true`;
this is the arm of the media query the brief named — the desktop surface was not
used for this fix):

- `<th>` computed `min-height: 48px` — the declaration **is** matching.
- `<th>` **rendered height: 34.5px**. Unchanged.
- Button 44×44 at `top 187.2 → bottom 231.2` inside a `<th>` of
  `192.2 → 226.7`, `overflow: hidden`: `clippedTop: true, clippedBottom: true`.
- **Effective tap target 44×34.5, not 44×44** — still below the floor the rule
  exists to satisfy.
- Focus ring: `:focus-visible` true, `outline: rgb(168,129,6) solid 2px`,
  `outline-offset: 2px` → ring extent `183.2 → 235.2` against a cell of
  `192.2 → 226.7`: **9.0px clipped off the top, 8.5px off the bottom.**
  Screenshot `hel465-r5-narrow-focus.png` inspected: **two disconnected vertical
  amber bars, not a ring** — identical to round 4's `hel465-narrow-focus2.png`.

**Root cause of the no-op:** `min-height` **does not apply to `display:
table-cell`** (CSS 2.1 §17.5.3 / §10.7); the browser ignores it on a `<th>`.
Probe-confirmed live, reproduced with restore:

| CSS on `.ui-data-grid__table thead th` | rendered `<th>` height | control clipped |
|---|---|---|
| shipped `min-height: 48px` | 34.5px | **yes** |
| probe `height: 48px` | 48.0px | **no** |
| probe removed (back to shipped) | 34.5px | **yes** |

So the intended fix is one keyword away: `height: 48px` (which on a table cell
acts as a *minimum*) does exactly what the executor wanted; `min-height` is
silently discarded.

### 3. Regression check on what the two fixes could plausibly break — CLEAN

- **AC4 separator — still working under real scroll, both themes.** At
  `scrollLeft = 1500` on the 82-column table: `--pinned-cell--last::after` is
  `position: absolute`, `width: 1px`, light
  `rgb(0.129 0.114 0.098 / .35)`, dark `rgb(0.949 0.937 0.914 / .35)`.
  Screenshots `hel465-r5-sep-light.png` / `hel465-r5-dark.png` inspected: the
  1px rule sits at the pinned boundary spanning header and body while different
  columns scroll behind it. AC1/AC2 also still hold (`left` = `0/160/320px`,
  on-screen x = 297/457/617, contiguous, at non-zero scroll).
- **Round-3 hit-testing — no regression from the added `padding-right`.**
  Re-ran my own `elementFromPoint` scan across the whole table:
  **47 distinct visible columns, 0 hit-test failures** — every pin toggle's
  centre resolves into the button itself.
  *Measurement note, recorded because it nearly produced a false REFUTE:* my
  first pass reported 74/214 "failures". That was my own artifact — I counted
  cells occluded by the sticky pinned overlay (round 4 documented the same trap).
  Re-run excluding buttons whose box falls behind the overlay's right edge, and
  deduplicated per column, the count is 0. Only the reproduced, corrected number
  is reported above.

### Verdict: REFUTE

Both round-4 change requests remain open, at **identical measured severity**
(28/75 header cells overlapped; 44×34.5 tap target with a broken focus ring at
≤430px/coarse pointer). Neither shipped declaration has any effect on the surface
it targets — each was verified inert by direct A/B toggle in the running browser,
and each no-op has an identified, measured cause. Nothing else regressed: AC1,
AC2, AC4 and the round-3 hit-testing result are all still confirmed good, and the
gates are green.

Per the pre-authorization there is no round 6. Recording precisely what remains
wrong, and — since both causes are now known — exactly what would fix them, so
the follow-up ticket does not have to re-derive any of it.

### Change Requests (for the follow-up ticket; not for another round)

1. **`DataGrid.css` — the header label still paints under the pin icon on 28 of
   75 header cells with 3 columns pinned (8 of them truncating), both themes.**
   `.ui-data-grid__th--pin-reserve`'s `padding-right` is inert because
   `overflow: hidden` clips at the padding box, so padding creates no clip
   boundary, and `.sortable-th__btn` is `overflow: visible; white-space: nowrap`
   so its text overruns freely (measured: `player.injury_body_part` text right
   703.3 vs button left 649.0 vs cell right 697.0).
   The reservation must constrain the **label element**, not the cell's padding —
   e.g. give `.sortable-th__btn` (or a wrapper) an explicit
   `max-width: calc(100% - var(--space-9))` plus `overflow: hidden;
   text-overflow: ellipsis; min-width: 0`, so the label ellipsizes before the
   icon. Keeping the `<th>` `padding-right` is harmless but is not the fix.
   Verify by re-measuring `labelUnderPinIcon = 0` across the table **with columns
   pinned**, and by looking at the header in both themes.

2. **`DataGrid.css` — at ≤430px/coarse pointer the pin toggle is still clipped
   (tap target 44×34.5, focus ring split into two bars).** The
   `min-height: 48px` added to `.ui-data-grid__table thead th` is ignored:
   `min-height` does not apply to `display: table-cell`.
   Change it to **`height: 48px`** inside the same media query — probe-confirmed
   live in this round: the row becomes 48px and `clipped: false`, with the 44px
   control untouched. (DESIGN.md §8's `outline-offset: -2px` carve-out is *not*
   needed once the row grows; it would only paper over the ring while leaving the
   tap target short.)
   Verify by measurement at a real ≤430px viewport: button box fully inside its
   `<th>`, computed ring extent (`rect ± offset ± width`) inside it too, then
   inspect the screenshot in both themes.

### Non-blocking notes

1. **The three tests added in `ddcdb6f1` are green while both fixes are inert.**
   They assert declaration text in `DataGrid.css`, which is true and useless
   here. The executor labelled them honestly as not-proof, and that label turned
   out to be exactly right — but a follow-up should replace them with something
   that can actually fail when the effect is absent (a Playwright/e2e geometry
   assertion), or drop them; as written they are green-for-broken.
2. **AC3 (persistence) is still not live-verifiable here**, unchanged from round
   4 — the dev user owns zero Outputs and every pin write 403s. Not investigated
   further this round, per the brief.
3. Round-4 note 2 (the coarse-pointer `min-width: 44px` also widening three
   HEL-451 sibling controls) and note 3 (`tasks.md` 4.1–4.4 / 5.3–5.5 unchecked)
   are both still as reported.
