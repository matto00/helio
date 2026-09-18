## Files modified — HEL-1090

- `e2e/hel1090-form-panel-assembled-a11y.spec.ts` — new Playwright spec: keyboard-only tab order
  across all eight field types (text/textarea/number/date/select/checkbox/file/counter), focus
  management on submit/success/genuine-server-rejection, the panel's computed role/name via the
  accessibility tree (C8), live-region text-change measurement, and HEL-1158 three-finding
  re-measurement on the assembled panel.
- `frontend/src/features/panels/ui/form/FormPanelView.tsx` — fix: the submit button now carries
  `aria-disabled` instead of the native `disabled` attribute while a submission is pending. Root
  cause: a natively `disabled` focused element is force-blurred to `<body>` by the browser the
  instant it becomes disabled, which is exactly the "focus lost to the document body" this
  ticket's spec (`specs/form-panel-rendering/spec.md`, Requirement 2) forbids during the in-flight
  state. Confirmed via a bare-HTML Playwright probe with zero app code involved (a plain
  `<button>` disabled via `element.disabled = true` while focused moves `document.activeElement`
  to `<body>`), then via a targeted mutation of this exact fix (reverted `aria-disabled` back to
  `disabled`) that turned the new spec's focus-management test red at the same assertion, then
  restored byte-identical — C7.
- `frontend/src/features/panels/ui/form/FormPanel.css` — companion CSS selector update
  (`:disabled` → `[aria-disabled="true"]`) so the pending-state hover/cursor/opacity styling still
  applies under the new attribute.
