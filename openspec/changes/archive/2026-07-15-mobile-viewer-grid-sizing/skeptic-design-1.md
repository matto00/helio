## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Ticket vs. handoff read in full.** `ticket.md` (HEL-301) and the binding
  `notes/mobile-pwa-handoff.md` (W4, W5, §4.1) match: the ticket is a faithful,
  non-diluted restatement of the handoff sections it scopes.

- **Hazard §4.1 resolution (D1/D2) is sound and matches ground truth.**
  - `frontend/src/features/panels/ui/PanelGrid.tsx:233` — confirmed
    `onLayoutChange={handleLayoutChange}` is exactly where the design says it is;
    `handleLayoutChange` (line 207) calls `markLayoutChanged(fromResponsiveLayouts(...))`.
  - `frontend/src/features/panels/hooks/usePanelGridSave.ts` — confirmed
    `markLayoutChanged` only sets `latestLayoutRef`/dispatches `setLayoutPending`
    when invoked; the 30s `persistLayout` tick compares `latestLayoutRef` against
    `persistedLayoutRef` via `areDashboardLayoutsEqual` and no-ops if never
    diverged. This confirms the design's claim that `usePanelGridSave` may still
    be *called* on the phone path without producing a PATCH, so long as
    `markLayoutChanged` is never invoked — i.e. `<Responsive>` never mounting is
    sufficient and the hooks-must-run-unconditionally caveat is correctly reasoned,
    not hand-waved.
  - `frontend/src/features/panels/ui/panelGridConfig.ts` — confirmed
    `breakpoints = {lg:1440, md:1100, sm:768, xs:0}`, `dashboardGridCols` untouched
    by this plan, `rowHeight:52`, `margin:[18,18]` as cited.
  - Given `xs:0` and `sm:768`, RGL resolves the `xs` breakpoint for any container
    width in `[0, 768)`. Gating the stack on container width `< panelGridConfig.breakpoints.sm`
    (D1) therefore closes the hazard at exactly the width range where RGL would
    otherwise resolve `xs` — this is the correct, non-hand-wavy justification for
    diverging from the ticket's looser "below the phone breakpoint" wording in
    favor of the handoff's explicit "below 768px" / "prefer not rendering
    `<Responsive>` at all" requirement (hazard §4.1, handoff lines 155–160). A
    literal 430px-only gate would leave a 430–768px window where `<Responsive>`
    still mounts at `xs` and can PATCH — the design correctly identifies and
    rejects this. D1 documents the rejected alternative ("no-op `onLayoutChange`")
    and correctly notes it is exactly what §4.1 forbids.
  - Task 1.2 explicitly requires probing (not assuming) whether today's grid
    already PATCHes `xs` on narrow mount, matching the ticket's "worth checking...
    confirm rather than assume" instruction.
  - Task 5.1 / mobile-viewer-stack spec's "structurally incapable" requirement
    directly maps to a testable Jest assertion (fake-timer advance past
    `AUTO_SAVE_INTERVAL_MS`, assert no `updateDashboardLayout`/`setLayoutPending`
    dispatch) — this is an actual regression test for the hazard, not a
    do-not-drag disabling.

- **DESIGN.md breakpoint claims verified.** `DESIGN.md:149-159` confirms the
  430px phone breakpoint is already ratified (HEL-300) and that
  `PanelDetailModal.css`'s previously-unratified `480px` query was folded into
  430 — I read `PanelDetailModal.css:575` and it is already `@media (max-width:
  430px)`, consistent with the design's claim that HEL-300 already migrated this.
  `--space-3` = 12px per `DESIGN.md`'s spacing scale, matching D4's "12px
  rhythm" claim. The design's D1 (JS container-width gate, not a new CSS media
  query) does not conflict with DESIGN.md §4's "CSS media queries use these
  values only" rule, since it's not a CSS breakpoint at all.

- **W4.3 per-kind height policy** — `mobile-panel-sizing/spec.md` transcribes
  the handoff's table verbatim (metric ~104–132px ignoring `h`; chart
  `clamp(200px, w×0.62, 340px)` modulated by `h≤4`/`h≥8`; table
  `min(60dvh, intrinsic)` with the only internal scroller; markdown/text fully
  intrinsic; image natural aspect; divider bare hairline). `PanelKind` union
  confirmed at `frontend/src/features/panels/types/panel.ts:52` to be exactly
  `"metric" | "chart" | "table" | "text" | "markdown" | "image" | "divider"` —
  all seven kinds are covered by the spec table, none omitted. D3 centralizes
  the tuning constants in one pure module (`mobilePanelHeights.ts`) per the
  ticket's own instruction that "these numbers were derived by reading code,
  not by looking at a phone... tune them on device." Task 6.3 explicitly
  requires listing the tuning-knob file for device-feedback iteration.

- **Scope discipline.** Grepped design/tasks/proposal for `App.tsx`, sidebar,
  nav, `BottomNav` — none appear except in the design's own Risks section
  explicitly forbidding touching them ("Do not touch `App.tsx` nav, `App.css`
  sidebar rules, or anything HEL-302 owns"). Proposal's Impact list
  (`PanelGrid.tsx`, `panelGridConfig.ts`, new stack component, `PanelList.tsx`
  zoom widget, `PanelCard`/chrome CSS, `PanelDetailModal.css`, renderers,
  `DataGrid.css`) is consistent with the ticket's in-scope surface and the
  renderer file list matches the ticket's `PanelKind` set (divider correctly
  excluded from renderer changes — "no card chrome at all", no dedicated
  renderer touch needed). No backend/`schemas/` mentions anywhere in the
  planning artifacts; ticket and design both state this explicitly multiple
  times. Verified `frontend/src/features/panels/ui/PanelCard.tsx:262/271/272`
  has the exact `panel-grid-card__handle`/`__footer`/`__type-badge` class names
  the design cites for chrome trimming — not invented.

- **Terminal-state framing.** `tasks.md` §6 is titled "Handback — ready for
  device testing (terminal state)" and lists the same ordered device-check
  sequence as handoff §6 (layout-corruption byte-identity first, then
  one-of-every-kind sizing, then rotation, then scroll checks). Design's
  "Planner Notes" explicitly instructs the evaluator/skeptic to treat
  desktop-viewport evidence as *implementation* evidence only, and keeps
  device-tied ACs open in the handback plan. No artifact anywhere claims or
  implies "done" — consistent with the ticket's explicit prohibition.

- **No placeholders.** Grepped all planning artifacts for
  `TODO|TBD|figure out|to be determined|later` — no matches. Every AC in
  `ticket.md` traces to a concrete requirement/scenario in one of the four spec
  deltas and a task in `tasks.md`. `git status` confirms this worktree has made
  no code changes yet (only untracked `openspec/changes/...` planning files),
  correctly branched from `a7b914fd` (HEL-300 merge, PR #226) as the ticket's
  orchestrator context specifies.

### Verdict: CONFIRM

### Non-blocking notes

- D2 leaves the exact component-split mechanism (single branch inside
  `PanelGrid` vs. splitting into an RGL-only inner component mounted ≥768) to
  the executor's discretion. This is reasonable latitude, not hand-waving,
  because the design pins the correctness *contract* precisely (no
  `markLayoutChanged`/`updateDashboardLayout`/`setLayoutPending` dispatch from
  the stack path) and task 5.1 makes that contract a concrete, structure-agnostic
  Jest assertion. Worth the evaluator double-checking at execution time that
  whichever structure is chosen doesn't reintroduce a stray call path (e.g. if
  `usePanelGridSave`'s `flushAndReset` ref handle gets wired to something that
  can still fire `persistLayout` off a stale `latestLayoutRef` on the stack
  path — the analysis above shows this is safe today, but worth re-confirming
  against whatever the executor actually ships).
- Design D5 mentions "consider hiding legends below phone width via the
  container width already known to the renderer" as a should-consider, not a
  requirement — matches the handoff's own "consider" framing (W5), so this is
  appropriately non-committal rather than deferred-and-required.
