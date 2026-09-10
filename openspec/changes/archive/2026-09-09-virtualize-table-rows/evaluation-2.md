## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `09648389` (change requests from evaluation-1.md) on top of `bce96c9a`.
Scope of this cycle: the three cycle-1 change requests plus a full gate re-run and a fresh live
pass against the FIXED commit (the cycle-1 live pass predated the CR1 fix and could not stand in
for it).

### Phase 1: Spec Review — PASS

- **CR1 — closed.** `useVirtualRows.ts:75-93`: a feature-detected `ResizeObserver` calls the
  existing `measure()` from the same effect that registers the `scroll` listener, disconnected in
  the same cleanup. Correct placement (one subscription lifecycle, one `enabled` gate, one
  cleanup) — no duplicated measurement path.
- **CR2 — closed.** `DataGrid.test.tsx:1729-1780`: 5,000 rows, `pinnedColumns={["id","value"]}`,
  scrolled to ~row 2500, asserting every mounted row's leading cells carry
  `ui-data-grid__pinned-cell` and `left` offsets identical to the header's `["0px","160px"]`.
- **CR3 — closed, and closed honestly.** tasks.md 3.3 cites evaluation-1.md Phase 3 for AC1/AC2/AC4
  and states outright that the largest live table available was 200 rows, with "Do not read this as
  'several thousand rows verified live.'" That is the correct disclosure, not an overclaim.
- Non-blocking items from cycle 1 also addressed: the two `set-state-in-effect` comments now
  explain why no directive sits there (including the probe result), and `overscan`'s default is
  documented as a conservative, tunable starting point rather than a measured value.
- No scope creep: `09648389` touches only `DataGrid.tsx`, `DataGrid.test.tsx`, `useVirtualRows.ts`
  and the change directory. All AC1-AC5 remain satisfied; spec deltas unchanged and still accurate.

### Phase 2: Code Review — PASS

Gates re-run fresh by me in `WORKTREE_PATH` at `09648389` (working tree clean):
- `npm run lint` — PASS (zero warnings)
- `npm run format:check` — PASS
- `npm test` — PASS (299 suites / 3193 tests)
- `npm --prefix frontend run build` — PASS
- No `backend/**` changes → `sbt test` not applicable.

Code quality: the observer is feature-detected (`typeof ResizeObserver !== "undefined"`) so the
jsdom gap is handled the same way `useScrollEdges` handles it; `observer?.disconnect()` in cleanup
means no leak across `enabled`/ref changes; no new types, no `any`, no dead code.

**Mutation-testing of the new CR1 guard (my own probe, both directions):**
- Removing the whole `ResizeObserver` block — i.e. reintroducing the exact cycle-1 defect — makes
  the new guard **RED** (`DataGrid.test.tsx:1739`). The guard does catch the regression it exists
  for.
- Removing only `observer.observe(el)` while keeping `new ResizeObserver(measure)` leaves the guard
  **GREEN**. The fake observer captures the callback in its constructor and the test invokes that
  callback directly, so nothing asserts the observer is actually attached to the scroll container.
  This is a narrower blind spot, not a failure of the primary guard → Non-blocking #1, not a
  change request.

### Phase 3: UI Review — PASS

Servers already healthy from cycle 1; page reloaded against the current worktree (Vite serving
`09648389`). Console errors and warnings across every flow tested: **0**.

**Cycle-1 blocking repro, re-run against the fixed commit — regression is gone.** Same interaction,
same panel, same dashboard: shrink the panel via its `react-resizable-handle`, then grow it in a
single drag with **no intervening scroll event**.

| state | grid `clientHeight` | mounted data rows | `ceil(h/35)+20` (expected) | blank gap below last row |
|---|---|---|---|---|
| after shrink | 191px | 26 | 26 | none (−753px, rows overflow) |
| after grow, no scroll | 2291px | 86 | 86 | none (−753px) |

The mounted window now tracks the new viewport exactly at both sizes. A second, independent drag
(1031px → 2361px) reproduced the same result (50 → 88 rows, expected 88). In cycle 1 this exact
interaction left the window at 36 rows and a measured **159px blank strip**; that no longer occurs.

Regression re-check of everything that passed in cycle 1, re-measured on the fixed commit:
- **AC1** — mounted data rows 86 / 86 / 86 / 75 at scroll fractions 0 / 0.33 / 0.66 / 1 (75 only
  because the end of the list was reached) out of 200 rows; `scrollHeight` constant at 7034px at
  every position; `aria-rowindex` advancing correctly and window-independently (2→87, 36→121,
  81→166, 127→201); `aria-rowcount` = 201.
- **AC2 (pinning under windowing)** — at `scrollLeft=3000, scrollTop=2000`, mounted rows' leading
  cells kept `ui-data-grid__pinned-cell` / `--last` with `left: 0px` / `160px`, rendering at
  x=297 / x=457, matching the header exactly.
- **AC4** — `scrollWidth` 12000 against the panel's viewport with 75 columns; no column collapse,
  no page-level horizontal overflow.
- HEL-1065's two known pin-toggle defects: unchanged, still out of scope, nothing new introduced.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

1. `frontend/src/shared/ui/DataGrid.test.tsx:1734-1750` — the CR1 guard is blind to a missing or
   misdirected `observer.observe(el)` (probed above: mutating only that line leaves it green).
   Cheap hardening for whoever next touches this file: have `FakeResizeObserver.observe` record its
   argument and assert it was called with the `.ui-data-grid` element. I confirmed the real
   attachment live in a browser this cycle, so this is a durability improvement for future
   regressions, not a correction of anything shipping now.
2. The "several thousand rows" figure in AC1 remains Jest-only (5,000-row fixtures); the live
   evidence in both cycles is a 200-row table, the largest available in the dev environment.
   tasks.md 3.3 already says exactly this. If a several-thousand-row live measurement is wanted
   before beta, it belongs in a follow-up with a seeded Output, not in this ticket.
