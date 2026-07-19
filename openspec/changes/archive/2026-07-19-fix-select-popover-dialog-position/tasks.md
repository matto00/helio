## 1. Probe & audit

- [x] 1.1 Probe at 390×844: open the chart-type Select in the panel-creation modal; confirm via DOM inspection
      that `.panel-creation-modal[open]` retains a `transform` at rest (containing block) and that its
      `animation-fill-mode` is `both`; measure the trigger-vs-panel offset (record the finding)
- [x] 1.2 Audit every `<dialog>` / `Select` / `usePortalPopover` call site by checking each dialog's
      entrance-animation `animation-fill-mode` (both/forwards = afflicted; backwards/none = correct), referencing
      the `Modal.css` d7fb3816 precedent. Expected outcome: only `PanelCreationModal.css` is afflicted
      (`PanelDetailModal` has no transform animation; shared-`Modal` dialogs already use `backwards`;
      `ActionsMenu`/`UserMenu`/`DashboardAppearanceEditor` always portal to `document.body`). Record the result.

## 2. Frontend fix

- [x] 2.1 In `PanelCreationModal.css`, change `.panel-creation-modal[open]`'s animation fill mode from `both`
      to `backwards`, mirroring `Modal.css`; add/keep a brief comment explaining the containing-block rationale
- [x] 2.2 Confirm via probe that the dialog no longer retains a `transform` at rest and the chart-type Select
      popover aligns to its trigger at 390×844 with options tappable

## 3. Tests

- [x] 3.1 Regression test (static CSS-source assertion via `fs.readFileSync`, mirroring
      `ActionsMenu.css.test.ts`; jest mocks `.css` imports to `{}` so no computed-style/jsdom check works):
      read `PanelCreationModal.css` and assert `.panel-creation-modal[open]`'s animation uses `backwards` (and
      not `both`/`forwards`), so the dialog leaves no lingering containing-block transform for a portalled Select
- [x] 3.2 Run `npm run lint`, `npm run format:check`, and `npm test` for touched files; all green
