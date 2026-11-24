# HEL-1839: Viewer read-only hygiene: fail-closed edit defaults, wider disabled-fieldset scan, test comment fix

## Description

origin_kind: followup
origin_ticket: HEL-1794

Three small loose ends from HEL-1794's final review:

1. **Fail-closed UI defaults.** The pipeline-page hooks now require `canEdit`/`editable`, but some UI-level components
   still default `canEdit`/`readOnly` to allow editing when the prop is omitted. Make the defaults deny editing, so a
   future caller that forgets the prop shows no edit controls.
2. **Wider e2e scan.** `e2e/hel1794-viewer-read-only.spec.ts` scans for enabled controls inside disabled fieldsets.
   Extend it to links and `<summary>` elements too.
3. **Wrong comment** in `viewerCopy.test.ts`: fix it to match what the test asserts.

## Acceptance criteria

- [ ] Omitting the prop yields no edit control, with a test that fails if the default flips back.
- [ ] The e2e scan covers links and `<summary>`, proven by mutation.
- [ ] The comment matches the test.

## Driver notes (claims, verified at Planning)

- Enumerate every such default by grep; check every existing caller still passes the prop explicitly so no
  owner/editor loses a control.
- A link inside a disabled fieldset that is legitimately navigational must be told apart, not failed; a product
  question there is an escalation.
- Frontend + e2e only; no backend, no migration.
