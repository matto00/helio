## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review of `09648389` (on `bce96c9a`), branch `feature/virtualize-table-rows/HEL-458`.
Note on base: `main..HEAD` also contains `dae1117e` (HEL-465) and `88c0b26b` (HEL-1064), which are
base commits, not this change. This ticket's real diff is `dae1117e..HEAD`: `DataGrid.tsx`,
`DataGrid.css`, `DataGrid.test.tsx`, `useVirtualRows.ts` + the change directory. Verified by
`git diff dae1117e..HEAD --stat` — no scope creep into any other source file.

### What I verified (with evidence)

**Gates re-run by me in the worktree (not trusted from the evaluator):**
- `npm run lint` — PASS (zero warnings, `--max-warnings=0`).
- `npx tsc --noEmit -p frontend/tsconfig.json` — PASS (no output).
- `npm run format:check` — PASS.
- `npx jest` (full frontend) — PASS, 299 suites / 3193 tests. Targeted
  `DataGrid|useVirtualRows|TableRenderer` — 3 suites / 185 tests, PASS.
- No `backend/**` change → `sbt test` N/A.

**Code read in full** (`useVirtualRows.ts`, the `DataGrid.tsx` windowing block, the two new CSS
rules), not summarised from files-modified.md / evaluation-*.md.

**Live app** (`start-servers.sh` → reused healthy servers; `assert-phase.sh servers` → `PASS
servers`), dashboard `SKF2-82col`, panel "Projections 2026 table" (200 rows, 75 columns,
`aria-rowcount=201`). Console errors/warnings across everything below: **0**.

- **AC1 — bounded, stable DOM node count.** My own measurement at scroll fractions
  0 / .25 / .5 / .75 / 1: mounted data rows 86 / 86 / 86 / 86 / 75 (75 only because the list ends),
  `scrollHeight` constant at 7034px at every position (= 200×35 + 34px header), `aria-rowindex`
  advancing window-independently (2→87, 25→110, 59→144, 93→178, 127→201), gap below the last
  mounted row ≤ 0 at every position (no blank strip).
- Geometry cross-check at scrollTop 2372: spacers 1995px + 1995px + 86×35 + header = 7034 =
  `table.getBoundingClientRect().height` = `scrollHeight`. D6's spacer-geometry decision holds in a
  real browser — no scrollbar drift as the window slides.
- **The evaluation-1 CR1 regression, re-probed independently by me.** I grew/shrank the scroll
  container with **no scroll event at all**: 200px → 26 mounted (`ceil(200/35)+20 = 26`),
  1600px → 66 (`ceil(1600/35)+20 = 66`), restored 2291px → 86 (expected 86), gap ≤ 0 throughout.
  **This is direct evidence that the `ResizeObserver` is really constructed AND really attached to
  `.ui-data-grid`** — which is exactly the hole the Jest guard cannot see (see Non-blocking #1).
- **AC2 — pinning under windowing:** verified in code (`isPinned`/`pinnedOffsets`/`--last` are
  applied inside the windowed `visibleRows.map`, unchanged from the pre-windowing body) and guarded
  at a deep scroll position by `DataGrid.test.tsx`'s new pinned-columns case. Sort/filter are
  caller-side (`DataGrid` never orders or filters `rows` itself — `rows` arrives already
  sorted/filtered), so windowing composes with them by construction; live sort/filter re-window was
  re-measured by the evaluator and I saw the filter row render correctly while windowed and scrolled.
- **Positional-CSS audit (the sharpest windowing hazard I looked for myself):** `DataGrid.css` has
  exactly one positional selector over body rows, `tbody tr:last-child td` — which is precisely
  what D6 neutralises via `ui-data-grid__row--no-border` plus omitting a zero-height trailing
  spacer. There is **no** `nth-child` zebra striping anywhere in the file, so no other
  windowed-vs-unwindowed divergence exists in CSS.
- **AC3 — small-table bypass:** `variant === "full" && rows.length > VIRTUALIZATION_ROW_THRESHOLD`
  (150); tests cover exactly-at-threshold (all rows mounted, no spacers) and threshold+1 (windowed).
- **AC4 — no horizontal/column-collapse regression:** spacer `<td>`s are `colSpan`-full ordinary
  flow rows; column widths come from the unchanged `<thead>` under `table-layout: fixed`. Live: 75
  columns, no collapse, header/body pinned offsets identical (`0px` / `160px`).
- **AC5 — coverage + a11y:** Jest covers the windowing math, the threshold boundary in both
  directions, spacer sizing, `aria-rowcount`/window-independent `aria-rowindex`, spacer
  `aria-hidden`, resize re-measurement, and pinning-under-windowing. Keyboard scroll re-checked
  live: focusing the scroll region and pressing **PageDown** moved scrollTop 2372→4376 and the
  window followed correctly (mounted 85, rows 117→201, no gap). Focusable controls all remain in
  `<thead>`, untouched by `<tbody>` windowing; body cells contain no focusable content.
- **Light/dark parity:** re-rendered the panel with `helio-theme=light` (real reload, not an
  attribute flip) and at dark. Row rhythm, hairline borders, header treatment and the spacer
  boundary render identically in both; the new CSS only zeroes inherited geometry
  (padding/border/max-width) and introduces no colour, spacing or type value, so there is no token
  surface to diverge. No visual artifact at the spacer/row seam at any scroll position.
- One apparent blank strip in an element-targeted screenshot did **not** reproduce: a full-viewport
  screenshot at the same scroll position and direct `getBoundingClientRect()` geometry both show
  rows filling the container. It was a Playwright element-capture artifact, not a defect —
  re-measured before concluding.

### Verdict: CONFIRM

Nothing I could refute. Every AC traces to code plus a fresh measurement I took myself, the
cycle-1 regression is independently confirmed fixed at the mechanism level (observer attachment,
not just callback plumbing), the one positional-CSS hazard windowing could have introduced is
handled, and all gates are green on a clean tree.

### Non-blocking notes

1. `DataGrid.test.tsx` (CR1 guard) — `FakeResizeObserver.observe()` is a no-op and the test invokes
   the captured callback directly, so a regression that constructs the observer but never attaches
   it stays green. I confirmed real attachment live (see above), so nothing ships broken; recording
   the `observe()` argument and asserting it is the `.ui-data-grid` element is cheap hardening for
   whoever next touches this file.
2. Spec scenario "Row height changes with density under virtualization" has no discriminating test:
   `stubRowHeight` returns the same 30px for all three densities, so the `it.each` density cases
   would pass even if density were ignored, and live evidence is single-density (`TableRenderer`
   never passes `density` today, design.md's own note). The implementation is
   measurement-based with `resolvedDensity` in the effect's deps, so it is correct by construction
   — but a test stubbing a different height per density and asserting the spacer height differs
   would make that scenario failable.
3. `aria-rowcount`/`aria-rowindex` ignore the second `<thead>` row. Confirmed live with the
   per-column filter row expanded: `thead` has 2 rows, the filter row carries no `aria-rowindex`,
   and `aria-rowcount` is 201 for what is then a 202-row table. Nothing regressed (there was no
   `aria-rowcount`/`aria-rowindex` at all before this change) and it matches design D5 as written,
   but ARIA expects every row to carry an index once any does. Worth a small follow-up.
4. AC1's literal "several thousand rows" remains Jest-only (5,000-row fixtures); live evidence in
   all three cycles is the 200-row table, the largest in the dev environment. tasks.md 3.3 already
   discloses this explicitly rather than overclaiming — correct behaviour, noted not penalised.
   The windowing math is row-count-independent, so I did not treat it as blocking.
5. `openspec/changes/virtualize-table-rows/evaluation-2.md` is currently **untracked**. It must be
   committed with the delivery artifacts before archive/PR, or the evidence trail this verdict
   cites will not exist on the branch.
