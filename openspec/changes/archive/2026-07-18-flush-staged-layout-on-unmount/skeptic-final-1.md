## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Planning artifacts read**: `ticket.md`, `design.md`, `tasks.md`, `files-modified.md`,
`specs/frontend-layout-persistence/spec.md`, `evaluation-1.md`.

**Diff scope** — `git diff main...HEAD --name-only`: exactly 4 frontend files
(`useLayoutSave.ts`, `usePanelUpdatesFlush.ts`, `DesktopPanelGrid.tsx`,
`PanelGrid.test.tsx`) plus openspec planning artifacts. No schema/API changes —
matches the ticket's frontend-only scope, no scope drift.

**Code read directly** (not trusted from claims):
- `useLayoutSave.ts` full diff: adds `persistLayoutRef` (updated every render via
  a no-dep effect) and a dedicated empty-dep `useEffect(() => () =>
  persistLayoutRef.current(), [])` unmount cleanup. Traced `persistLayout`'s
  equality (`areDashboardLayoutsEqual`) + in-flight guards — confirmed a flush
  with no staged change is a genuine no-op, and a flush with a staged change
  dispatches `updateDashboardLayout` exactly once.
- `DesktopPanelGrid.tsx` / `usePanelUpdatesFlush.ts` diffs: confirmed
  comment-only (no logic lines changed) via `git diff`.
- `PanelGrid.test.tsx` diff: confirmed **purely additive** — the diff shows only
  new lines appended after the existing final `describe` block closes (line 659
  onward); no existing line was touched. This directly confirms the HEL-301
  xs byte-identity + structural no-persist guards were **not modified**, not
  merely "claimed unmodified."

**Gates re-run fresh in the worktree** (not trusting the evaluator's paste):
- `npm run lint` → clean, zero warnings (fresh run, this session).
- `npm run format:check` → "All matched files use Prettier code style!" (fresh
  run, this session).
- `npx jest --testPathPatterns=PanelGrid.test` → 24/24 pass (fresh run).
- `npm test -- --ci` (full suite) → 106 suites / 1124 tests, all pass (fresh
  run, this session).
- `npm run check:openspec` → reproduced the reported pre-archive-only failure
  ("change ... is complete (10/10) but not archived") — confirms the
  `--no-verify` commit was for this documented, accepted hygiene-only reason
  and not a cover for a skipped code-quality gate. Lint/format/test (the actual
  code gates) all pass cleanly without any bypass.

**Live verification (Playwright, ports 5479/8386, logged in as
matt@helio.dev)** — I did not just trust the evaluator's live-verification
narrative; I independently reproduced all three ticket-critical scenarios from
scratch, in a fresh session:

1. **AC1 — shrink-mid-edit flush**: At 1440px, dragged a real panel via its
   `.panel-grid-card__handle` move handle (synthetic mouse events; confirmed
   the drag actually registered via the `react-draggable-dragging` transient
   class) to a genuinely free grid cell (`translate(234px,0)` →
   `translate(0px,0)` for the "col_16 by col_27" panel). Confirmed via network
   monitor: **zero** PATCH while staged. Resized the viewport to 375px
   (crossing 768px): **exactly one** `PATCH /api/dashboards/.../update` fired.
   Reloaded at 1440px and confirmed the panel's DOM transform was still
   `translate(0px,0px)` — the staged edit survived the shrink, persisted
   server-side, and was not lost. This is real end-to-end evidence, not just
   the Jest mock.
   - Note: my first several drag/resize attempts silently no-opped (identical
     before/after DOM transform) because `DesktopPanelGrid.tsx:41` sets
     `preventCollision: true` and my target rectangles collided with sibling
     panels. This is expected RGL behavior, not a bug — I diagnosed it (checked
     for the `resizing`/`react-draggable-dragging` transient classes to confirm
     drag-start fired correctly) and retargeted to a collision-free cell,
     after which the drag worked as expected. Flagging this so a future
     re-verification doesn't mistake collision-blocked no-ops for a broken fix.
2. **AC2 — browse-only crossing (HEL-301 guard, live)**: fresh page load, no
   staged change, resized 1440→375→1440 (full round trip across the boundary):
   **zero** PATCH requests observed at any point.
3. **Rapid repeated crossings**: staged a second layout change (drag back),
   then crossed 1440→375→1440→375 in quick succession: **exactly one** PATCH
   fired across the whole sequence — no duplicate, matching the in-flight +
   equality guards and Jest test 3.3.
4. **Console**: 0 errors throughout (2 pre-existing warnings, unrelated to
   this change).
5. **Repro-widening (HEL-304 column widths)**: read `usePanelUpdatesFlush.ts`
   — confirmed it is owned by `PanelGrid` (mounts at every width, not
   `DesktopPanelGrid`) and is untouched by this diff (comment-only), so column
   widths remain on the pre-existing width-independent flush path, unaffected.

**Screenshot/tmp hygiene**: the Playwright MCP session is pinned to the main
repo's cwd (not this worktree — a known parallel-session artifact), so two
screenshots landed transiently at the main repo root. I moved both
individually into `.playwright-mcp/` (gitignored) rather than leaving them at
the repo root or bulk-deleting; confirmed via `find` that no `.png` remains at
either the main repo root or this worktree's root. `git status` in the
worktree is clean (only the expected `workflow-state.md` / new
`evaluation-1.md`).

### Verdict: CONFIRM

All three acceptance criteria are traced to real, independently-reproduced
evidence (not just claims): the staged-layout-survives-shrink fix works
end-to-end in a live browser and via the Jest regression suite; the HEL-301
guard is provably unmodified (diff-verified) and still holds live under both a
single crossing and rapid repeated crossings; the HEL-304 column-widths path
is structurally unaffected. Gates (lint/format/test) are all fresh-green with
no bypass on the actual code-quality checks — the one `--no-verify` commit was
for the documented pre-archive-only `check:openspec` hygiene rule, which I
reproduced independently.

### Non-blocking notes

- `PanelGrid.test.tsx` test 3.3's assertion
  `expect(MockResponsive).not.toHaveBeenCalledTimes(0)` is a near-tautology
  (true as long as the grid ever rendered) and doesn't itself verify "no PATCH
  originates while the mobile stack is mounted" — the evaluator flagged this
  already and I agree it's cosmetic; the exact-once PATCH-count assertions
  later in the same test carry the real verification weight. Fine to leave or
  clean up in a follow-up, not blocking.
- For any future live re-verification of this fix: `DesktopPanelGrid.tsx` sets
  `preventCollision: true`, so a synthetic drag/resize into an occupied grid
  cell will silently no-op (no visual change, no staged change). Target a
  genuinely free cell (or use the Jest `onLayoutChange` harness, which
  bypasses RGL's collision physics entirely) to avoid mistaking a
  collision-blocked gesture for a regression.
