## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Read all planning artifacts**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `workflow-state.md`, `specs/mobile-bottom-nav/spec.md`, `specs/mobile-dashboard-sheet/spec.md`.
- **Read the binding spec** `notes/mobile-pwa-handoff.md` in full (§0–§8, specifically §2 scope
  and §W3.0–W3.3), `DESIGN.md` (§0, §4 Breakpoints, §5), and `CONTRIBUTING.md` (General, Frontend
  sections).
- **Read the actual frontend code** the plan claims as ground truth:
  `frontend/src/app/App.tsx` (lines 1–60, 230–320), `frontend/src/app/App.css` (grep for `@media`
  and `breadcrumb`, plus lines 300–420), `frontend/src/shared/chrome/SidebarBody.tsx`,
  `SidebarItemList.tsx` (path check), `OverlayProvider.tsx`, `frontend/src/shared/ui/Modal.tsx`,
  `frontend/src/features/dashboards/ui/DashboardList.tsx`.
- **git log/branch check**: confirmed HEL-300 (PR #226 + follow-up #227) is merged and on this
  branch's base, and that `feature/mobile-viewer-grid-sizing/HEL-301` exists as a sibling worktree
  (parallel, as the ticket's "Out of scope" section explicitly states).

### Design Decision 1 (768px gate vs. 430px) — verified sound

- `App.css:335` is `@media (max-width: 768px)` — the **only** mobile media query in the file.
  There is no existing `430px` query. This confirms the plan's factual premise: the broken
  sidebar stub (fixed position, width-0 collapse, no reopen) and the hidden breadcrumb
  (`.app-command-bar__breadcrumb { display: none; }`) both already span the *entire* sub-768px
  range today, not just sub-430px.
- `DESIGN.md` §4 ratifies `1440/1100/768/430` as the canonical breakpoint **set** ("CSS media
  queries use these values only" — `[mechanical]`); 768 is a legitimate member of that set, so
  gating at 768 does not violate the mechanical rule, even though DESIGN.md's prose labels 430 as
  "(phone, ratified HEL-300)".
- `notes/mobile-pwa-handoff.md` §2 literally defines scope as "the phone (**<768px**) is a
  viewer" — the handoff's own operative definition of "the phone" is the sub-768 band, which
  supports gating there rather than at 430.
- Gating at 430 instead would leave 431–767px with **zero navigation** (desktop sidebar already
  hidden there; a 430-gated `BottomNav` wouldn't render either) — that is a worse violation of the
  ticket's own AC ("No route is a trap; every one is escapable") than the wider blast radius the
  design accepts. The design.md risk table records this trade-off explicitly with a stated
  alternative-rejected rationale, not hand-waving.
- **Conclusion: Decision 1 is grounded in code, not asserted — CONFIRMED sound.**

### Binding checkpoints — encoded correctly

- Ticket's checkpoint 1 (mid-execution ESCALATION, screenshots before full build-out) is encoded
  as `tasks.md` §4 ("CHECKPOINT — human design review (mandatory, do not proceed past it)"),
  correctly sequenced *after* first-cut BottomNav + sheet (§2–§3) and *before* build-out to the
  other three routes / desktop regression pass (§5). This matches the ticket's literal
  instruction: "pause after producing first-cut visuals of both components... wait for human
  feedback before completing the build."
- Ticket's checkpoint 2 (terminal state = "ready for device testing") is encoded as `tasks.md` §7,
  requiring a production build, an ordered on-device test plan (≥3-dashboard switch without a URL
  bar, safe-area, swipe feel, every-route-escapable walk) written into `files-modified.md`, and an
  explicit note that desktop 390px evidence is regression-only.
- Both checkpoints are also restated near-verbatim in `proposal.md` Decision 8 / `design.md`
  Decision 8. **CONFIRMED — both binding checkpoints are present and correctly sequenced.**

### Scope discipline — verified

- `proposal.md` ("Non-goals"), `design.md` (Goals/Non-Goals, Risks) both explicitly name
  `PanelGrid`, renderers, and `PanelList` zoom as HEL-301 territory to avoid.
- `tasks.md` (all 7 sections) touches only: `App.tsx`, `App.css`, new files under
  `shared/chrome/` (`navDestinations.ts`, `BottomNav.tsx/.css`, `MobileNavSheet.tsx/.css`), and
  Jest tests for those. No task references `PanelGrid`, `PanelList`, or `features/panels/ui/renderers`.
  **CONFIRMED — no scope creep into HEL-301's territory.**
- Reuse claims are grounded: `useOverlay`/`OverlayProvider` exist and are mounted app-wide in
  `main.tsx`; `DashboardList` reads `state.dashboards` (`items`, `selectedDashboardId`, `status`,
  `error`) and dispatches `setSelectedDashboardId` exactly as the design claims; `SidebarItemList`
  is confirmed to exist and to carry CRUD affordances (add/delete) that the spec correctly
  excludes from the mobile sheet ("no editing affordances" — matches handoff §2's viewer-scope
  rule).

### AC traceability

All six ACs in `ticket.md` map to at least one task and one spec scenario: tab bar (AC1 →
`mobile-bottom-nav` spec + tasks 2.x), dashboard switching (AC2 → `mobile-dashboard-sheet` spec +
tasks 3.x), escapability (AC3 → task 5.2 + spec "Every route is escapable"), promotable component
(AC4 → Decision 3 + spec "promotable to desktop without a rewrite"), desktop/iPad unchanged (AC5 →
task 5.3), lint/test/no-backend-changes (AC6 → task 6.5, `proposal.md` Impact section lists only
frontend files).

### Verdict: CONFIRM

### Non-blocking notes

1. **Terminology nit in design.md Decision 4**: it describes following "`Modal.tsx`'s
   portal/backdrop pattern," but `Modal.tsx` (read in full) is built on the native `<dialog>`
   element (`showModal()`/`close()`), not a React `createPortal`. It's a reasonable top-layer
   primitive either way, but if the executor wants an actual portal precedent, `Toast.tsx`,
   `Select.tsx`, `ActionsMenu.tsx`, and `OpDropdown.tsx` are the ones in this codebase that use
   `createPortal`. Worth a one-line correction so the executor picks the right reference
   implementation rather than assuming `Modal.tsx` uses `createPortal`.
2. **768px boundary edge case**: `design.md` Decision 1 asserts "the ≥768px requirement
   ('unchanged') is measured at 768 anyway," but the plan's own gate (matching the existing
   codebase convention, `max-width: 768px`) is inclusive of exactly 768px, which would place a
   768px-wide viewport in the *mobile* shell, not the unchanged-desktop bucket. This ambiguity
   predates this ticket (the current stub uses the same inclusive `max-width: 768px`), so it is
   not a new defect introduced by this plan, but the evaluator should test the "≥768 unchanged" AC
   at 769px+ (or against `main` at the exact same width) rather than assuming 768px itself proves
   parity.
3. **Title-control content on non-dashboard routes** (Decision 5 / task 5.1) is left ambiguous —
   "current item or section name" doesn't specify which one shows when, e.g., on `/pipelines` with
   no route id vs. `/pipelines/:id`. This is reasonable to leave to executor discretion (explicitly
   flagged as such elsewhere in the doc for icon/component-name choices) and will surface at the
   mandatory design checkpoint regardless — not blocking.
