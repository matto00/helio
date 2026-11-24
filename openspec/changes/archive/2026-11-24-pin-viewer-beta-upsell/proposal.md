## Why

HEL-1794 left a live "Request Beta access" link in the read-only Output sheet for a viewer grantee, and filed the
question of whether a viewer should see it. The owner ruled (2026-11-24): viewers see it, the same as editors and
owners. Nothing pins that today, so a future read-only pass (or a fail-closed default like HEL-1839's) could hide it
silently.

## What Changes

- No product behaviour changes. Today's behaviour is kept.
- Add jest tests that pin the History card's "Request Beta access" link for a viewer (`readOnly`), an editor
  (not read-only, not pipeline owner) and the sheet's fail-closed default (no `readOnly` prop), on a free-owned
  pipeline. The owner's existing tests are unchanged.
- Add an e2e test on a real shared pipeline (real grants, real free-tier owner) that pins the link for a viewer and
  an editor in the Output sheet's History card, in light and dark themes.
- Prove the tests by mutation: gating the link on read-only must turn the viewer tests red.
- Correct the HEL-1794 e2e allow-list comment that attributes the "Request Beta access (opens in a new tab)" name only
  to the Ask panel (the History card link has the same name).

## Capabilities

### New Capabilities

### Modified Capabilities
- `output-history-payloads-toggle`: the "Unavailable tier shows a disabled toggle with an upsell" requirement states
  that the link is shown to every role that can open the sheet (owner, editor, viewer), with a viewer scenario.

## Impact

- `frontend/src/features/pipelines/ui/outputEditor/` tests (new test file or additions to the history test).
- `e2e/` one new spec (or additions next to `hel1794-viewer-read-only.spec.ts`), using `e2e/support/hel1661Fixture.ts`.
- No backend, no migration, no schema, no production code change expected.
