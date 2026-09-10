## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Worktree verified: `pwd -P` = `.../feature/column-pinning-table-panels/HEL-465`,
branch `feature/column-pinning-table-panels/HEL-465`, HEAD `21c0059e` on
`f35a9d57`/`7bbc49d1`. `main` = `7b872db9` in both this worktree and the primary
checkout (identical `rev-parse`) — still the exact branch base, so no rebase drift
and no HEL-520 commits in play. Working tree clean (`git status --porcelain` empty).

Servers: `start-servers.sh` reported both already healthy and reused; I verified the
listeners are OUR worktree's processes (`ss -ltnp` → java pid 3805268 with
`/proc/…/cwd` = this worktree's `backend`, node pid 3805499 → this worktree's
`frontend`), and that Vite is serving the POST-fix CSS (`curl
http://localhost:5897/src/shared/ui/DataGrid.css` contains the new
`border-right: 1px solid color-mix(...)` on `.ui-data-grid__pinned-cell--last`, not
the old `box-shadow`). `assert-phase.sh servers` → `PASS`.

Screenshots referenced below are in
`/home/matt/Development/helio/.playwright-mcp/hel465-r2/`.

### What I verified (with evidence)

**Gates (all re-run by me, fresh, this round):**
- `npm run lint` → exit 0 (`eslint . --max-warnings=0`, no output).
- `npm run typecheck` → exit 0.
- `npm run format:check` → "All matched files use Prettier code style!".
- `npm test` → 299 suites / 3173 tests passed (exit 0).
- `frontend && npm run build` → exit 0 (PWA precache generated).

**Diff scope since round 1 — clean.** `21c0059e` touches exactly:
`TableRenderer.tsx`, `TableRenderer.test.tsx`, `DataGrid.css`,
`elevationTokenGuard.css.test.ts`, plus change-dir docs (design.md, tasks.md,
files-modified.md, evaluation-2.md, skeptic-final-1.md). No scope creep, no
unrelated refactor, no HEL-520 artifacts.

**CR2 (unsolicited `pinnedColumns` PATCH on mount) — FIXED. Verified two ways.**
- Cold page load (`browser_navigate` to `/`, panel mounted, 82-col table
  rendered): the full network log filtered to `/api/outputs` shows requests
  463–468, all `GET` (rows / assertion-status / output) — **no PATCH**. Round 1's
  equivalent load produced a PATCH at request #469.
- SPA navigate-away-and-back (sidebar → `/pipelines` → `/`), with a fetch **and**
  XHR interceptor installed beforehand recording every non-GET: `window.__patches`
  = `[]` after a 2.5s settle, with the table re-rendered (`201`
  `.ui-data-grid__pinned-cell--last` cells present). Round 1's identical sequence
  produced an unsolicited `{"config":{"pinnedColumns":[...]}}` PATCH.
- The same interceptor still records the *legitimate* write: a real click on
  "Pin column date" produced **exactly one** `PATCH /api/outputs/hel904-orphan-output-05d5…`
  with body `{"config":{"pinnedColumns":["category","company","date"]}}`.

**AC1 (freeze + horizontal scroll) — MET.** `.ui-data-grid` `scrollWidth` 12000 /
`clientWidth` 581. At `scrollLeft = 600`: pinned `th` "category" at viewport
x=297 (== grid left edge) and "company" at x=457, both `position: sticky`,
`left` 0/160, `z-index` 3; unpinned "date" sits at x=17 — i.e. scrolled *under*
the pinned region — and "game_id"/"last_modified" at 177/337.

**AC2 (cumulative offsets) — MET.** After pinning a third column live, header
`left` values are 0px / 160px / 320px and `--last` moves to "date"; the
filter-row `<th>`s carry the same 0/160/320 with `top: 40.5px`, `z-index: 3`
(both sticky axes, corner cells at the higher tier).

**AC3 (persistence) — MET.** A full page reload restored the pinned set from the
Output config (2 pinned columns rendered as `--last` on 201 rows before I
re-pinned a third); SPA navigate-away-and-back likewise restores. The user-driven
pin toggle persists via a single correct PATCH (above).

**AC5 / Decision 1 (leading contiguous run) — MET.** Live `aria-label`s:
"Unpin column category" (`aria-pressed=true`), "Unpin column company"
(`aria-pressed=true`), "Pin column date" (the next position, index == pinned
count), then "Pin through column game_id", "Pin through column last_modified" —
matching design.md Decision 1's semantics.

**AC6 (no regression) — MET as far as I could exercise.** Filter disclosure
expands and the per-column filter row aligns with the pinned offsets (above);
sort chevrons still present in pinned headers; resize handles unchanged;
`0` console errors across the whole session (`browser_console_messages` level
error → 0 of 3 messages).

**AC4 (frozen/scrolling boundary visually distinct, light + dark) — STILL NOT MET.**
See Change Request 1. Reproduced with four independent readings plus a positive
control and a working-alternative probe.

### Verdict: REFUTE

### Change Requests

1. **AC4 still fails: the `border-right` separator paints only when the table is
   NOT horizontally scrolled — i.e. it is invisible in exactly the state the
   separator exists for.** The declaration is fine; the *painting model* is not.
   Under `border-collapse: collapse` a cell border is painted by the **table**, at
   the cell's **static** (unscrolled) position — it does not travel with a
   `position: sticky` cell. So once the grid is scrolled, the border is drawn far
   to the left of the pinned column's on-screen position, underneath the pinned
   cells' own opaque backgrounds, and nothing is visible at the boundary. This is
   the same class of defect as round 1 (a declaration that resolves in
   `getComputedStyle` but paints nothing where it is needed), one mechanism over.

   Evidence, all at 1600x1000, dpr 1, grid at viewport x=297..878, last pinned
   cell's right edge at x=617:
   - **Shipped border, dark, `scrollLeft=0`** (`hel465-r2-dark-sl0.png`): a 1px
     line at x=617 — `(100,98,95)` against header bg `(22,21,20)` at y=180/200 and
     against body bg `(26,24,22)` at y=225. Present.
   - **Shipped border, dark, `scrollLeft=600`** (`hel465-r2-dark2.png`): scanning
     the ENTIRE grid width (x=297..878) at header y=185 and y=205 finds a single
     non-background pixel, and it is the grid's right edge at x=878 — no separator
     anywhere. x=612..621 at y=180/200/225 is uniform background.
   - **Shipped border, light theme, both offsets** (`hel465-r2-light-sl0.png`,
     `hel465-r2-light-sl600.png`): at `scrollLeft=0`, x=617 = `(28,25,23)` against
     `(239,236,230)` header — present; at `scrollLeft=600`, x=612..621 is uniform
     `(239,236,230)` (header) / `(26,24,22)` (body) at y=180/200/225 — absent.
     Same failure in both themes.
   - **Amplified probe (rules out "too subtle to sample").** Injected stylesheet
     `.ui-data-grid__pinned-cell--last{border-right:4px solid red !important}`
     (computed value confirmed `4px solid rgb(255,0,0)` on the element, right edge
     at x=617). At `scrollLeft=600` (`hel465-r2-probe3.png`) a full-viewport scan
     for red finds **0 pixels anywhere on the page**. Removing only the scroll
     (`scrollLeft=0`, `hel465-r2-probe4.png`) makes the same rule paint **270 red
     pixels at x=615..617**. Scroll offset alone flips it.
   - **Positive control (rules out "borders never paint in this table").** The
     identical declaration on a NON-pinned body `<td>`
     (`border-right: 4px solid lime`) paints normally at `scrollLeft=600`:
     152 lime pixels at x≈815 (`hel465-r2-probe2.png`).

   Required: make the boundary visible **while the table is horizontally
   scrolled**, in both themes, using an effect that is painted by the pinned cell
   itself rather than by the collapsed table border.

   **Probe-confirmed route (I verified this one works in the live app — do not
   take it on faith either, but it is not speculative):** an absolutely-positioned
   pseudo-element inside the last pinned cell. Injected
   ```css
   .ui-data-grid__pinned-cell--last::after {
     content: ""; position: absolute; top: 0; bottom: 0; right: 0;
     width: 1px; background: <token>; pointer-events: none;
   }
   ```
   on the live page at `scrollLeft=600` painted a full-height line at x=616,
   spanning y=174..253 (header + filter row + body rows) —
   `hel465-r2-probe-pseudo.png`, 78 matching pixels, single column x=616.
   Note this contradicts skeptic-final-1's parenthetical that a `::after` "will
   NOT work, as pinned cells are `overflow: hidden`": the pseudo sits at
   `right: 0` **inside** the cell's own box, so the cell's own `overflow: hidden`
   never clips it. The pinned cells are already `position: sticky`, so they are
   valid containing blocks with no extra positioning change needed. (The other
   route, `border-collapse: separate; border-spacing: 0`, remains available but
   carries the larger blast radius the executor already argued against — and note
   it would need re-verification of every other border in the table.)

   Whatever route is taken, re-verify with **rendered-pixel sampling across the
   boundary at a real non-zero `scrollLeft`, in BOTH themes, at the header row,
   the expanded filter row, and body rows.** A check at `scrollLeft = 0` is not
   evidence for this defect — that is precisely the reading that made the current
   fix look correct.

2. **Correct the now-falsified claims left in the tree by this fix.** These are
   in-code/doc assertions that ground truth contradicts, the same category the
   round-1 CR2 comment fell into:
   - `frontend/src/shared/ui/DataGrid.css`, the comment block above
     `.ui-data-grid__pinned-cell--last`, states "A plain `border-right` renders
     correctly under `collapse` … Verified with real pixel sampling across the
     boundary in both themes". Both sentences are false as shipped: it renders
     only at `scrollLeft: 0`, and no pixel sampling at a scrolled offset can have
     been done (the executor's own commit message says it had no browser tool).
     Rewrite to describe whatever mechanism actually ships, and state the
     collapsed-border-paints-at-static-position fact so the next reader does not
     re-derive it a third time.
   - `design.md` Decision 8 and `tasks.md` 2.6 carry the same claim and need the
     same correction.
   - `frontend/src/theme/elevationTokenGuard.css.test.ts`: the `box-shadow`
     exception pin was removed. If the replacement is a pseudo-element with a
     `background` (not a shadow), no pin is needed — confirm the guard suite
     still passes and does not need a new entry for the chosen mechanism.

### Non-blocking notes

- The CR2 fix itself is sound in shape: `lastPersistedPinnedKeyRef` is seeded from
  the same `columnOrder`/`pinnedColumns` props the effect re-derives from, so a
  repeated mount effect is a no-op by construction rather than by a flag, and the
  toggle path keeps the ref in sync so a reorder landing inside the debounce
  window compares against the value about to be written. I found no path where it
  suppresses a write that should happen: the only writes it can swallow are ones
  whose derived key list is byte-identical to what was last sent.
- Carried forward from round 1, still true and still non-blocking: three pinned
  columns consume 480px of a 581px panel, and every one of the 82 headers carries
  a permanently visible pin icon.
- My screenshots were written to the repo root by the browser tool and I moved
  them into `/home/matt/Development/helio/.playwright-mcp/hel465-r2/` (untracked,
  outside the worktree). I did not delete them.
