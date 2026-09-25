## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

- All ticket ACs addressed: keyboard-accessible Fullscreen control (`IconButton` in `PanelCard.tsx:399-407`,
  `aria-label="Fullscreen {title}"`), maximized overlay via shared `Modal size="full"`, Esc/close/backdrop
  restore focus (live-verified, see Phase 3), reuses `PanelContent`/`ChartPanel` unmodified (no forked
  rendering), view-only (no edit/rename/data controls in the overlay — asserted in both
  `PanelFullscreenOverlay.test.tsx` and `PanelCard.test.tsx`'s HEL-584 block, and confirmed live).
- No AC silently reinterpreted. Ticket's "chart/metric/table/markdown/image" language was explicitly
  reconciled in design.md against the post-HEL-903 `PanelKind` union (`output`/`text`/`markdown`/`image`/
  `divider`/`form`) — Decision 3's eligibility list (`output`, `text`, `markdown`, `image`; excludes
  `divider`, `form`) is a documented, justified scope call, not a silent narrowing. `MobilePanelStack`
  exclusion (Decision 4) is likewise explicit and justified (documented read-only/no-header-actions
  surface) and confirmed live at the 768px breakpoint (Fullscreen and all other header actions are absent
  there — pre-existing surface, not a regression).
- Task list (`tasks.md`) is fully checked and each item's claimed evidence exists: 1.1/1.2 standalone render
  + Esc/close/backdrop tests (`PanelFullscreenOverlay.test.tsx`), 1.3 static CSS-source-parse test for the
  definite-height rule (`PanelFullscreenOverlay.css.test.ts`), 2.1 zero-`usePanelData`-calls grep assertion
  plus a live no-second-fetch test, 2.2 focus-restore test, 3.1 `autoResize` wiring assertion, 4.1-4.3
  render/interaction tests and lint/test gates.
- No scope creep: every changed file is directly load-bearing for this ticket (component + CSS + tests +
  `PanelCard` integration + `isFullscreenEligible` helper + two CSS-file-count guard bumps required by the
  new file's addition). No unrelated refactors.
- No regressions to existing behavior: full `npm test` suite (3747 tests, 342 suites) passes, including the
  one pre-existing `PanelCard.test.tsx` assertion the executor's own root-cause note flags as needing a
  scope fix (`frozen=true still short-circuits...`) — verified correctly narrowed to
  `.panel-grid-card__title` rather than a workaround.
- No API/schema changes needed or made (frontend-only, as design.md's Migration Plan states) — confirmed by
  the diff's file list (no `schemas/`, `openspec/specs/` outside this change's own new capability, or
  backend files touched).
- Planning artifacts (design.md, tasks.md, spec.md) accurately reflect the final implementation — verified
  by reading the diff against each Decision/task item above; no divergence found.
- `workflow-state.md` `CONSTRAINTS` (C1-C4) honored: C1 (sonnet-only — not independently verifiable by the
  evaluator, no contrary evidence), C2 (no migration added — confirmed, diff touches no
  `db/migration/` files), C3 (single commit `d0405f65`, specific files only — confirmed via `git show
  --stat`), C4 (red-first evidence present and specific: 7 failed/2 passed → 35 passed, in
  `files-modified.md`, consistent with the diff's scope).

### Phase 2: Code Review — PASS

Issues: none blocking.

**Gates (fresh run, this worktree, `d0405f65`):**
- `npm run lint` — clean, zero warnings.
- `npm run format:check` — clean.
- `npm test` — 342 suites / 3747 tests passed (full suite, not just the changed files — the root `npm test`
  script chains `helio-mcp` tests then delegates to `frontend`'s own Jest run, which ran the full suite
  despite the `--testPathPatterns` filter I passed not narrowing the frontend delegate).
- `npm --prefix frontend run build` — succeeds (pre-existing >500kB chunk warning, unrelated to this
  change).
- Confirmed the guard-count bump claim: `elevationTokenGuard.css.test.ts` / `motionTokenGuard.css.test.ts`
  117→118 is exactly `PanelFullscreenOverlay.css`'s addition, and the full suite passing confirms the new
  count is accurate (a wrong pin would have failed these tests).

**Design.md Decision 1a (the definite-height fix) — actually implemented, not just planned.** Read
`PanelFullscreenOverlay.css` directly: `.panel-fullscreen-overlay { height: min(90vh, 1000px); overflow:
hidden; }` matches the design doc's rule verbatim, applied via `Modal`'s `className` prop in
`PanelFullscreenOverlay.tsx`. `PanelFullscreenOverlay.css.test.ts` statically parses the CSS source (Jest's
`styleMock.js` mocks `.css` imports, so this is the only mechanical way to prove the rule exists — matches
this repo's established convention, e.g. `PanelDetailModal.css.test.ts`). Live-rendered confirmation in
Phase 3 below (the overlay visibly fills a real, non-collapsed box in both themes, not a shrunk sliver).

**Design.md Decision 2 (no second fetch) — mechanically verified three ways, not just asserted:**
1. Static grep-shaped test in `PanelFullscreenOverlay.test.tsx` asserting the source never matches
   `usePanelData\s*\(`.
2. Direct diff read of `PanelCard.tsx`: `PanelFullscreenOverlay` is fed `panelData.data`,
   `panelData.rawRows`, etc. — the exact same `usePanelData(panel)` result already held by `PanelCard`,
   never a second hook call.
3. A behavioral test (`PanelCard.test.tsx`) asserting `getOutputRowsMock` fires exactly once even after
   opening fullscreen for an output panel.

**Design.md Decision 3 (eligibility gating) — code matches the design doc exactly.**
`panelNarrowing.ts`'s new `isFullscreenEligible(panel)` is `!isDividerPanel(panel) && !isFormPanel(panel)`,
reused identically by both the button gate and the overlay-mount gate in `PanelCard.tsx` (a single source
of truth, not two independently-maintained conditions). Live-verified in Phase 3 (divider: absent, text/
markdown: present).

**CONTRIBUTING.md compliance:**
- Imports/qualifiers: clean, no inline FQNs, all imports at top of file.
- Comments: the executor's own doc comments in `PanelFullscreenOverlay.tsx` and the inline notes in
  `PanelCard.tsx` are hazard/contract/why-shaped (e.g. explaining *why* the overlay is always-mounted vs.
  conditionally, referencing the probe-confirmed root cause), not restatements — matches the standard's own
  worked example.
- File-size soft budget (non-blocking): `PanelCard.tsx` is now 505 lines (was 453 pre-change, already over
  the ~400-line "propose a split" threshold before this ticket touched it). The soft budget is explicitly
  informational for frontend files (the mechanical `check:scala-quality` script only enforces it for
  Scala); flagging as a non-blocking suggestion, not a Change Request, since this ticket's ~50-line addition
  didn't newly cross the threshold and a full extraction is arguably out of this ticket's scope.
- DRY: `isFullscreenEligible` is a single shared predicate reused by both the button and overlay-mount
  gates; no duplicated eligibility logic.
- Type safety: no `any`, `PanelFullscreenOverlayProps` reuses `Omit<PanelDataResult, "isRefreshing">`
  rather than inventing a parallel shape.
- Tests are meaningful: the interaction tests assert behavior (focus target, dialog content scoped via
  `within(dialog)`, fetch call counts) rather than implementation details, and the C4 red-first evidence in
  `files-modified.md` is specific (test counts, not just "tests pass").
- No dead code, no leftover TODO/FIXME in the diff.
- No over-engineering: the overlay is a thin wrapper reusing `Modal` + `PanelContent` verbatim, exactly as
  design.md's Decision 1 requires — no new focus-trap/backdrop/animation code was added (confirmed: the
  diff touches no `Modal.tsx` internals).

### Phase 3: UI Review — PASS

Servers confirmed serving THIS worktree (not a stale reuse): `readlink /proc/<pid>/cwd` for both the
frontend (port 6016) and backend (port 8923) listener PIDs resolved to
`.../worktrees/feature/panel-fullscreen-focus-mode/HEL-584/frontend` and `.../backend` respectively.

Live-rendered against a fresh dashboard (`HEL-584 eval dashboard`) with a text, markdown, and divider panel
created for this review:

- **Happy path (text panel):** Fullscreen button present, opens `Modal size="full"` dialog titled
  "Untitled Panel" with a "text" eyebrow and matching content; `Esc` closes and restores focus to the exact
  triggering button (`document.activeElement` verified via `browser_evaluate` before/after); close-button
  click does the same.
- **Eligibility gating, live:** divider panel — Fullscreen button absent (confirmed via accessibility
  snapshot, only "panel actions"/"Move" buttons present). Text and markdown panels — button present. This
  matches `isFullscreenEligible`'s implementation exactly (design.md Decision 3).
- **No console errors** across the entire session (open/close × 2 kinds × 2 themes × 3 breakpoints, plus
  panel creation) — `browser_console_messages` returned 0 errors/warnings for the whole session.
- **Light/dark cohesion:** screenshots at both themes (persisted, see refs below) show an opaque surface,
  dimmed backdrop, mono eyebrow content-kind label, and — critically — a definite-height box that visibly
  fills a large majority of the viewport rather than the pre-fix shrink-to-fit collapse the HEL-746/design
  Decision 1a history describes. This is direct visual confirmation that the CSS fix is live, not just
  present in source.
- **Breakpoints:** 1440px and 1100px render the overlay without layout breakage (screenshots persisted).
  768px switches the whole dashboard into `MobilePanelStack` (per Decision 4, no Fullscreen affordance
  there — confirmed via accessibility snapshot: no header actions of any kind at that width, a pre-existing
  surface constraint, not a regression). 0px/narrowest was not separately captured since 768px already
  exercises the mobile-stack path where the control is documented-absent; nothing narrower would exercise
  new behavior.
- One benign visual artifact investigated and ruled out as a false alarm: at 1440px a screenshot showed
  what looked like an editable text-input box around the dialog's title. Cross-checked against the
  accessibility snapshot at the same moment — it is a `<h2 tabIndex={-1}>` (`Modal.tsx:190`) receiving the
  browser's native dialog-open focus, rendered with this app's orange accent-colored focus ring; pre-existing
  `Modal` behavior untouched by this diff, not a defect.
- Resize verification (chart/output panel kind): no `chart`-kind Output existed in this dev DB session to
  open in fullscreen live (the "Add panel" search returned "No output fits?" — no Outputs available to
  bind). This AC is instead covered by the unit-level evidence design.md Decision 5 itself prescribes:
  jsdom has no `ResizeObserver`/real layout, so a live pixel-resize assertion isn't achievable in Jest
  either, and design.md explicitly names the CSS-definite-height test + the `ReactECharts`
  `autoResize`-wiring-preserved test as "the achievable mechanical evidence." Both exist and pass. Not
  escalating per Decision 5's own terms, since the premise (`autoResize` firing) was not contradicted by
  any evidence gathered — I found no basis to independently confirm or refute the live-pixel claim beyond
  what design.md already anticipated as the ceiling of available evidence.

**Persisted evidence (durable refs, since these screenshots were captured in the shared repo-root
`.playwright-mcp/` directory rather than this worktree — a known cross-worktree Playwright-session
artifact location, not a defect):**
- `/home/matt/Development/helio/.concertino/runs/HEL-584/evidence/.playwright-mcp/hel584-markdown-dark.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-584/evidence/.playwright-mcp/hel584-markdown-light.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-584/evidence/.playwright-mcp/hel584-1100.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-584/evidence/.playwright-mcp/hel584-1440.png`

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `PanelCard.tsx` is now 505 lines, above CONTRIBUTING.md's informational ~400-line "propose a split"
  threshold (it was already at 453 before this ticket). Not a blocker for this ticket, but worth a
  deliberate decomposition pass (e.g. extracting the header-actions cluster) before the file grows further.
