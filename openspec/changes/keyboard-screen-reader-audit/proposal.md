## Why

HEL-1083..1089 shipped the form panel's individual fields, each verified in isolation. Nothing has
verified the *assembled* panel — tab order across mixed field types, focus management across
submit/success/error, and live-region announcement — against a real browser's accessibility tree.
Isolated-component jsdom coverage cannot catch cross-field focus/tab-order defects or computed ARIA
association gaps (HEL-1084 shipped an error `<p>` with no `id`/`aria-describedby` link that two
evaluator cycles missed by checking attribute presence, not computed state).

## What Changes

- Add a Playwright e2e spec that completes a full form-panel submit keyboard-only against the
  running app: tab order across every field type (text/textarea/number/date/select/checkbox/file/
  counter), focus on submit, focus after success, focus after a **server-side** rejection, and
  computed live-region announcement.
- Assert the panel's own `role`/accessible name inside the dashboard grid via the computed
  accessibility tree (not attribute presence).
- Re-measure HEL-1158's three open findings (submit-below-fold, same-frame re-announcement,
  duplicated error text) against the assembled panel; report status, do not duplicate the ticket.
- Fix any newly-found defect that blocks keyboard-only completion (not polish-only findings, which
  get filed as follow-ups per the triage procedure).

## Capabilities

### New Capabilities
(none — this is a verification/audit change)

### Modified Capabilities
- `form-panel-rendering`: adds an assembled-panel keyboard/screen-reader accessibility requirement
  (tab order, focus management, computed ARIA association) verified against the running app.

## Impact

Affected: `e2e/hel1090-*.spec.ts` (new), possibly `frontend/src/features/panels/ui/form/**` and
`frontend/src/shared/ui/Form*.tsx` if a blocking defect is found and fixed. No backend or schema
changes expected.

## Non-goals

- Not re-auditing individually-covered field components (HEL-1083..1089 ACs).
- Not fixing or filing HEL-1158's three findings as new work — only re-measuring and reporting.
