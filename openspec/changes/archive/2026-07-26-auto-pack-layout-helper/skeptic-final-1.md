## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ticket/proposal/design/tasks/specs read in full** (`ticket.md`, `proposal.md`, `design.md`,
  `tasks.md`, `specs/dashboard-auto-layout/spec.md`, `specs/mcp-panel-composition-tools/spec.md`).
- **Ground-truth diff**: `git diff main...HEAD --stat` — 23 files, exactly the scope claimed
  (`PanelPacker.scala`, `AutoLayoutService.scala`, `AutoLayoutRoutes.scala`, `DashboardProtocol.scala`,
  `ApiRoutes.scala`, `api/package.scala`, `helioApi.ts`, `write.ts`, schemas, specs, openspec artifacts).
  `git status` clean, working tree matches HEAD (confirms the earlier stash incident left no residue).

- **AC1 (pack into non-overlapping positions, order preserved, 12-col default)**: read
  `PanelPacker.pack` (`backend/.../services/layout/PanelPacker.scala:98-123`) — flows `Vector[PackInput]`
  left-to-right, wraps on `x + w > cols`, `DefaultCols = 12` in `AutoLayoutService.scala:37`. Verified
  against `~/Development/helio-news/news/run.py:220-240` (`_pack`) — logic ported line-for-line
  (shelf accumulation, `x`/`y`/`shelfH` tracking, `fillShelf` called on wrap and at the end).

- **AC2 (ragged-edge shelf-fill, proportional, sparse left alone)**: `fillShelf`
  (`PanelPacker.scala:73-91`) matches `_fill_shelf` (`run.py:197-217`) exactly: proportional widen,
  drift settled on the widest item, re-flow `x`. Threshold check `used >= cols || used < fillThreshold(cols)`
  is a no-op guard identical in spirit to `run.py:205`. The `fillThreshold` scaling
  (`round(cols*7/12)`, reduces to exactly `7` at `cols=12`) is an explicit, documented judgment call
  (code comment `PanelPacker.scala:42-49`) required because `cols` is configurable here but fixed in the
  Python original — reasonable, not silent.

- **AC3 (per-kind clamping, default (1,2,24))**: `Bounds` map (`PanelPacker.scala:33-40`) diffed
  side-by-side against `_BOUNDS` (`run.py:52-59`) — all six kinds (chart/metric/collection/image/table/
  markdown) match verbatim; `DefaultBounds = ClampBounds(1,2,24)` matches `_BOUNDS.get(kind,(1,2,24))`.
  Kind keys use `PanelKind.*` constants (`Panel.scala:146-155`), not magic strings.

- **AC4 (omitted panels keep position, unknown panelId → 400 no persistence)**: read
  `AutoLayoutService.applyAutoLayout` (`AutoLayoutService.scala:54-98`) — `requestedIds.find(id =>
  !kindByPanelId.contains(id))` short-circuits with `ServiceError.BadRequest` before any
  `dashboardRepo.update` call; `kept = existing.layout.lg.filterNot(...)` preserves omitted panels'
  positions verbatim. Confirmed by test: `AutoLayoutRouteSpec.scala:69-79` (400 + `storedLg` still
  empty after) and `:81-101` (kept panel's `x/y/w/h` unchanged, packed panel appended).

- **AC5 (ScalaTest coverage incl. genuine overlap property)**: read `PanelPackerSpec.scala` in full.
  Confirmed hand-written cases for wrap (`:41-56`), shelf-fill widen + sparse no-op (`:73-88`), clamp
  correction both directions + default bounds (`:90-109`), single-panel (`:34-39`), empty (`:30-32`).
  **Property test is real** (`:118-145`): `seeds = 1 to 200`, each seed drives a `Random`-seeded loop
  generating 1-15 panels with random kind and `w`/`h` deliberately ranged to `-2..13` (exercises
  clamping including negative/zero), asserting `noPairwiseOverlaps` and full size retention — a genuine
  generator loop over many random inputs, not hand-written cases relabeled.

- **AC6 (MCP tool)**: `helio-mcp/src/helioApi.ts:739-758` (`autoLayoutDashboard`) and
  `helio-mcp/src/tools/write.ts:779-810` (`auto_layout_dashboard` tool, zod schema, description
  documenting the `_pack`/`_fill_shelf`/`_clamp` replacement) both present and wired.

- **D1 (one placement, all four breakpoints identical) actually implemented**: `AutoLayoutService.scala:86`
  — `DashboardLayout(lg = items, md = items, sm = items, xs = items)`, same `items` value object for all
  four, not just claimed. Cross-checked frontend breakpoint truth: `frontend/src/features/dashboards/
  state/dashboardLayout.ts:10-15` confirms `lg=12/md=10/sm=6/xs=2` (matches design.md's Context claim)
  and confirmed the precedent cited (`DashboardContentsService.remapLayout`,
  `backend/.../services/DashboardContentsService.scala:102-107`) does the exact same
  `DashboardLayout(lg=items, md=items, sm=items, xs=items)` pattern.

- **Scope discipline**: `git diff main...HEAD --name-only` — no file touches panel-id-key
  reconciliation (HEL-368), external-run hooks (HEL-369), or pie/scatter aggregation (HEL-624)
  territory. No frontend files touched at all (confirmed by the diff stat and independently by
  `grep -rn "auto-layout\|autoLayout" frontend/src` returning zero matches).

- **Fresh gate re-runs (not trusted from evaluator's report)**:
  - `sbt testOnly com.helio.services.layout.PanelPackerSpec com.helio.api.AutoLayoutRouteSpec` →
    20/20 passed.
  - `sbt test` (full backend suite) → **2154/2154 passed**, 127 suites, 0 failures.
  - `npm run lint` (root, zero-warnings ESLint) → clean.
  - `npm run format:check` → clean.
  - `npm test` (root jest + frontend jest) → 137 suites / 1423 tests passed.
  - `npm run check:openspec` → only the expected "complete (13/13) but not archived" note (per
    orchestrator's instructions, archiving happens later — not a defect).
  - `npm run check:schemas` → in sync, 29 checked across 26 protocol files, 0 drift.
  - `npm run check:scala-quality` → clean (0 violations in new files; 70 pre-existing soft
    line-budget warnings on files this diff didn't touch).
  - `helio-mcp`: `npm run typecheck` and `npm run build` → both clean.
  - `git status` → clean, working tree matches HEAD (no residue from the earlier stash incident;
    did not run `git stash` myself per the hard constraint).

- **No UI to judge**: this is a backend + MCP-only change (confirmed by the diff file list and the
  zero-match frontend grep above) — DESIGN.md / visual-parity review is N/A, consistent with the
  evaluator's own Phase 3 N/A determination, which I independently reproduced rather than trusted.

### Verdict: CONFIRM

### Non-blocking notes
- `helio-mcp/src/tools/write.ts`'s `items` zod schema uses `.min(1)` while the backend genuinely
  accepts and tests an empty-items request (`AutoLayoutRouteSpec`: "returns an empty result unchanged
  for empty items"). Harmless in practice (no real agent call has zero items) — worth a one-line note
  if a future ticket wants the MCP surface to fully mirror the backend's accepted range.
