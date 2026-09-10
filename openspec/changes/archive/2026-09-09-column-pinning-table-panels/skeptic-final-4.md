## Skeptic Report — final gate (round 4, skeptic-final-4.md)

Cold review. Every conclusion below comes from the running app, the actual diff,
or gate output I ran and read myself. Prior reports were read as claims only.

### Ground truth / environment

- `pwd -P` and `git branch --show-current` agree with the brief. `HEAD =
  02c7e0dc`, on top of `7ffe424b`/`45b2dd08`/`b982c45c`/`3da1da54`/`e141d855`.
  Rebase base `7a14601f` (HEL-520) is on `main`.
- **Environmental trap, recorded because it invalidated my first three probes:**
  `start-servers.sh` reported "already healthy … reusing", and the reused vite
  process (pid 3805499, cwd correctly under this worktree, port-bound via `ss`)
  was serving a **pre-rebase DataGrid module with zero pinning code in it** —
  `curl http://localhost:5897/src/shared/ui/DataGrid.tsx | grep -o 'pin[A-Za-z-]*'`
  returned only `ping`/`pingURL`, and the rendered header cells contained no pin
  toggle and no resize handle at all. The served CSS was current; only the TSX
  module graph was stale. Killed vite, removed `frontend/node_modules/.vite`,
  restarted on the same port — the module then served correctly and 75 pin
  toggles rendered. **Any live evidence gathered on a reused dev server after a
  rebase is suspect until the served module is checked.**
- `assert-phase.sh servers` → `PASS servers`.

### Gates (re-run by me post-rebase, not taken from evaluation-*.md)

- `npm run typecheck` — clean.
- `npm run lint` (`--max-warnings=0`) — clean.
- `npm run format:check` — "All matched files use Prettier code style!".
- `npx jest` — **299 suites / 3177 tests passing**, 28.3s.

### 1. Round-3 CR1 (pin toggle clipped out of the cell) — GENUINELY FIXED

Reproduced my own round-3 method on the real 82-column table (`SKF2-82col`,
"Projections 2026 table", 160px default widths), scanning the whole table by
stepping `scrollLeft` in 400px increments and testing only header cells fully
inside the scroll container's visible rect (my first pass wrongly counted cells
hidden behind the pinned overlay and off-container cells as failures — re-run
with the overlay accounted for, per "reproduce before you REFUTE"):

- **73 header cells checked. `outsideCell` = 0** — the button's box is inside
  its own `<th>` on every single column.
- **8 of those columns genuinely ellipsize** (label text right edge past the
  cell's right edge, measured with a `Range` over the label text node, not by a
  `scrollWidth` heuristic). On **all 8**, `document.elementFromPoint` at the
  button's centre resolves **into the button itself** (`BTN`), not a neighbour.
  Examples: `player.fantasy_positions`, `player.injury_body_part`,
  `player.injury_start_date`, `player.team_changed_at`, `stats.adp_dynasty_2qb`,
  `stats.adp_dynasty_half_ppr`, `stats.adp_dynasty_ppr`,
  `stats.bonus_rush_td_qb`.
- **0 hit-test failures** on non-truncating columns either.
- Clicking pin toggles works end to end: I pinned and unpinned through the real
  control repeatedly, and the leading-run constraint held (clicking column 2's
  toggle pinned `col_27` + `col_6`).

The 38%-unclickable defect is gone. The executor's `position: absolute` +
`right: var(--space-6)` reuse of the `.ui-data-grid__resize-handle` precedent is
the correct mechanism and it works.

### 2. Focus ring on a formerly-clipped column — VISIBLE at desktop, in both themes

- Dark, `player.injury_body_part` (a truncating column): keyboard-focus state
  confirmed (`:focus-visible` matched), `outline: rgb(168,129,6) solid 2px`,
  `outline-offset: 2px`. Ring extent 175–207 inside a `<th>` of 174–208 — fits
  with ~1px to spare. **Screenshot inspected** (`hel465-focus-dark.png`): a
  complete, unbroken amber ring around the pin toggle.
- Light, same column, theme toggled through the real Settings control so derived
  tokens recompute (`data-theme=light`): same outline value, **screenshot
  inspected** (`hel465-focus-light.png`) — complete ring.

### 3. The executor's HEL-520 `outline-offset: -2px` claim — HALF RIGHT

Verified against HEL-520's actual diff (`git diff 7a14601f~1 7a14601f`), not its
prose. HEL-520 changed only `e2e/**`, `PipelineDetailHeader.css`,
`Modal.test.tsx`, `tokenAuditSweep.css.test.ts` — **zero file overlap** with this
ticket.

- **Correct for the desktop case.** At normal density the `<th>` is 34–35px and
  the 24px control's ring needs 32px — it fits, measured and seen. No carve-out
  needed. The executor's reasoning holds here.
- **Wrong for the coarse-pointer / narrow case** — see finding 5 below, where the
  defect is *exactly* HEL-520's shape (a ring clipped by a too-short
  `overflow: hidden` ancestor) and the `-2px` carve-out *is* the applicable
  pattern. The claim was asserted for the whole control, and it is not true for
  the whole control.

### 4. Rebase / HEL-520 interaction — no regression found

- No file overlap (above). `IconButton.tsx`'s change is a purely additive
  `aria-pressed` passthrough; `PanelContent.tsx` is one prop forward.
- Diff vs `main` is frontend-only and tightly scoped to this ticket (9 code
  files, the rest openspec artifacts). No scope creep found.
- AC4 separator **re-verified post-rebase**: light theme, 3 pinned columns,
  `scrollLeft = 1500` on the 82-column table — screenshot
  (`hel465-sep-light2.png`) shows the 1px separator at the pinned boundary
  spanning header and body rows while the scrolling region shows different
  columns behind it. AC1/AC2 hold: inline `left` = `0px/160px/320px`, on-screen
  x = 297/457/617, contiguous, at non-zero scroll.
- Console on the current navigation: 3 errors, all
  `PATCH /api/outputs/hel904-orphan-output-… 403` — see finding 6; none from
  this ticket's code, none from rendering.

### Verdict: REFUTE

Round-3's CR1 is genuinely fixed, and I confirm that. But the fix introduced two
new, independently reproduced, user-facing defects — one cosmetic-but-prominent,
one an accessibility/touch-target regression on the mobile surface. Both were
created by this round's change and neither is a repeat of an earlier complaint.

I am recording these precisely because there is no round 5 and the orchestrator
has to weigh shipping with a known gap. **Both fixes are CSS-only, in one file,
with no logic change** — see the severity note at the end.

### Change Requests

1. **BLOCKING (mobile/touch) — the ticket's own 44px tap-target rule now
   produces a control clipped 5px top and bottom, and a broken focus ring.**
   `DataGrid.css` coarse-pointer/narrow media query (`min-height: 44px;
   min-width: 44px` on `.ui-data-grid__pin-toggle-btn`) combined with this
   round's `position: absolute` on the same control.

   Probe-confirmed live at a 420px viewport (the `(max-width: 430px)` arm of the
   same media query that serves `(pointer: coarse)` — i.e. the shipped mobile
   PWA surface):
   - Button box `top 240 → bottom 284` (44px) inside a `<th>` of `245 → 280`
     (35px) with `overflow: hidden`. `clippedTop: true, clippedBottom: true`.
   - **Effective tap target is 44×35, not 44×44** — below the very floor this
     rule was added (evaluation-1.md CR1) to satisfy.
   - Keyboard focus ring (`:focus-visible` confirmed true, ring extent 236→288
     against a 245→280 cell): **only 66% of the ring's height survives; the top
     and bottom segments are clipped away entirely.** Screenshot
     `hel465-narrow-focus2.png` shows the result — two disconnected vertical
     amber bars, not a ring.
   - **Proven to be a regression from this round, not pre-existing.**
     In-browser probe (no source edit): forcing `position: static` back onto the
     control — the pre-fix inline-flow shape — grows the header row to **61px**
     and the 44px control is **not clipped** (`clipped: false`). With the shipped
     `position: absolute` the row is **35px** and it **is** clipped. Taking the
     control out of flow removed the row's reason to grow.

   This is precisely the defect class HEL-520 fixed in `PipelineDetailHeader.css`
   (a ring clipped by a too-short `overflow: hidden` ancestor) — DESIGN.md §8's
   documented `outline-offset: -2px` carve-out for flush children applies here,
   contrary to the commit message's blanket claim. The carve-out alone fixes the
   *ring*; it does **not** fix the 44×35 tap target — that needs either dropping
   `min-height` for this control (keeping `min-width`, since the horizontal axis
   has room), or letting the cell grow on the touch branch.

   Verify a fix by measurement, not by declaration: at a ≤430px viewport, assert
   the button's box is fully within its `<th>`'s box, and that the computed ring
   extent (`rect ± outline-offset ± outline-width`) is too — then look at the
   screenshot in both themes.

2. **BLOCKING (visual, desktop) — the header label now renders *underneath* the
   pin icon on truncating columns; the reserved-space half of round-3's CR1 was
   not implemented.** `DataGrid.css` `.ui-data-grid__table thead th
   .ui-data-grid__pin-toggle-btn` — `position: absolute` was added, but no
   matching `padding-right` was reserved on the `<th>`.

   Round-3's CR1 asked for both: *"`position: absolute` near the right edge …
   **with matching `padding-right` reserved on the `<th>` so the header label
   ellipsizes before it rather than under it**"*. Only the first half landed, and
   the consequence is the exact one that clause was written to prevent.

   Measured on the 82-column table at 1900px viewport:
   - **8 of 73 columns truncate; on all 8 the label text's right edge extends
     past the pin button's left edge** — the glyph is painted on top of the text.
   - With 3 columns pinned (the feature's own normal state, which narrows the
     scrolling region), **28 of 75 header cells** have label text running under
     the icon.
   - There is no ellipsis to soften it: the label lives inside
     `.sortable-th__btn`, so the `<th>`'s `text-overflow: ellipsis` never
     applies to it and the text simply hard-clips at the cell edge — under the
     icon on the way.
   - Screenshots inspected, both themes: `hel465-grid-dark.png` reads
     `player.fantasy_positio▪n`, `player.first_nam▪⇕`, `player.injury_body_▪par`;
     `hel465-sep-light2.png` reads `player.last_nam▪`. The pin glyph and the sort
     chevron both collide with the label text.

   One declaration fixes it (reserve the control's own width plus the resize
   handle's clearance as `padding-right` on the full-variant `<th>`, so the label
   box ends before the control begins). Verify by re-measuring `labelUnderPinIcon
   = 0` across the table with columns pinned, and by looking at the header in
   both themes.

### Non-blocking notes

1. **AC3 (persistence) is NOT live-verifiable in this environment, and round 3's
   live evidence for it was a precondition-guaranteed pass.** The dev user
   `matt@helio.dev` **owns zero Outputs** (`GET /api/outputs` → `count: 0` —
   every table Output in the shared dev DB is HEL-904 residue owned by another
   principal), so **every** pin write returns `403`: I observed
   `PATCH /api/outputs/hel904-orphan-output-… → 403` ×3 and
   `PATCH /api/outputs/hel904-output-c702aa41-… → 403` ×1, on two different
   dashboards. The pin set that "survived a reload" in round 3 is pre-existing
   config already stored on a foreign-owned Output — it would have survived
   whether or not this ticket's persist path works. My own unpins likewise
   reverted on reload.
   This is **environmental, not a ticket defect**, and the silent degrade is a
   deliberate, documented design (`persistColumnSort`'s doc comment, HEL-448 D7 —
   `persistPinnedColumns` follows the identical minimal-patch + swallow shape,
   and its comment correctly explains why clearing must write `[]` rather than
   omit the key against the backend's shallow `mergeConfig`). So AC3 traces to
   code + unit tests + an established idiom, but **it has never actually been
   observed round-tripping against the server**, in any round. Worth stating
   plainly rather than carrying a third round of unearned live evidence.
2. Round-3's CR2 (the coarse-pointer `min-width: 44px` silently widening three
   HEL-451 sibling controls) is still unaddressed — the shared selector list is
   unchanged. It was non-blocking then and remains so, but note that CR1 above
   now makes this same rule load-bearing, so whoever touches it should settle
   both at once.
3. `tasks.md` 4.1–4.4 and 5.3–5.5 remain unchecked.

### Severity summary for the ship/halt decision

- Everything the ticket is *for* works: pinning, cumulative offsets, the
  frozen/scrolling separator in both themes, and — as of this round — a pin
  toggle that is visible and clickable on every column including truncating
  ones. AC1, AC2, AC4, AC5, AC6 trace to real evidence; AC3 traces to code only
  (note 1).
- CR2 is cosmetic but conspicuous, hitting ~11% of columns bare and ~37% once
  columns are pinned, on exactly the wide tables this feature targets. An
  experienced eye rejects overlapping glyph-on-text.
- CR1 is the more serious: it degrades a touch target below the documented floor
  and breaks a focus indicator on the mobile PWA surface — in a repo that has
  just shipped HEL-533/HEL-1046/HEL-1050/HEL-520 specifically on focus-indicator
  visibility. It is also invisible to every local gate (jsdom has no layout) and
  would only be caught, if at all, by HEL-520's new e2e focus-presence guard —
  which does not run in the local gate suite.
- Both are single-file CSS changes with no logic and no test-shape change.
