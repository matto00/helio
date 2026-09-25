## 1. Frontend: Overlay component

- [x] 1.1 Create `PanelFullscreenOverlay.tsx` wrapping `Modal size="full"`, accepting `panel` + the same
      `PanelDataResult` props shape `PanelCardBody` takes (data/rawRows/headers/isLoading/error/errorKind/
      noData/neverMaterialized/chartAggregate/rowsTruncated), rendering `<PanelContent>` with them and a
      title header (panel title + mono eyebrow context); verify it renders via a standalone render test.
- [x] 1.2 Wire `open`/`onClose` state and title/eyebrow content; verify `Esc`, close-button, and backdrop
      click all invoke `onClose` (reusing `Modal`'s existing behavior — no new keydown handling).
- [x] 1.3 Create `PanelFullscreenOverlay.css` with `.panel-fullscreen-overlay { height: min(90vh, 1000px);
      overflow: hidden; }` (design.md Decision 1a) and apply it via `Modal`'s `className` prop; verify the
      rule exists using this repo's established static-CSS-source-parse convention (`*.css.test.ts`, e.g.
      `PanelDetailModal.css.test.ts`) — NOT a render + `getComputedStyle` assertion, since Jest's
      `styleMock.js` mocks `.css` imports to an empty object and would never see the real rule (design-gate
      round-2 non-blocking note, `skeptic-design-2.md`). This is the prerequisite the chart-resize
      verification (3.1) depends on, not cosmetic.

## 2. Frontend: PanelCard integration

- [x] 2.1 Add a "Fullscreen" `IconButton` to `PanelCard`'s header actions, gated on eligible kinds
      (`output`/`text`/`markdown`/`image`; excluded: `divider`, `form` — design.md Decision 3), passing
      `panelData` (the existing `usePanelData(panel)` result already held in `PanelCard`) into the overlay
      as props — verify no second `usePanelData` call is introduced (grep `PanelFullscreenOverlay.tsx` for
      `usePanelData`; must be zero hits).
- [x] 2.2 Verify focus restore: opening from the Fullscreen button and closing via `Esc` returns focus to
      that same button (render/interaction test).

## 3. Frontend: Chart resize verification

- [x] 3.1 Verify (not implement, unless proven necessary) that a chart panel's `ChartPanel` `autoResize`
      re-fits when rendered inside the fullscreen overlay — a rendered test asserting the chart's
      container reports the overlay's larger dimensions, or an equivalent resize-call assertion. This
      verification is only meaningful once task 1.3's definite-height rule is in place and confirmed
      (design.md Decision 5); do not assert a resize call against a still content-shrunk container. If
      `autoResize` does not fire reliably inside the `<dialog>`, stop and escalate per design.md Decision 5
      rather than adding an unverified workaround.

## 4. Tests

- [x] 4.1 Render test: Fullscreen button present for `output`/`text`/`markdown`/`image` panels, absent for
      `divider`/`form` panels.
- [x] 4.2 Interaction test: open → content matches card (same data, no extra fetch) → `Esc` closes →
      focus restored to the triggering button — red-first (show it fail before the overlay exists / before
      the fix, per the run's standing red-first constraint).
- [x] 4.3 `npm run lint` and `npm test` pass with zero new warnings.

## Standing Constraints

- [C1] All agents (executor/evaluator/skeptic/auditor) run on sonnet, per driver instruction — no
  budget-fallback promotion to a stronger model this run.
- [C2] Migration ledger: V110 is the highest applied Flyway migration; V111 is free but NOT expected for
  this ticket (frontend-only). If a migration is genuinely needed, flag it to the driver before taking
  V111.
- [C3] Every git commit invocation must use Bash timeout: 600000ms; never re-run a commit while one is in
  flight; never `git add -A` (add specific files only).
- [C4] Proof is red-first: for any test added/changed to cover this ticket's behavior, show it fail
  without the change before showing it pass with the change.
