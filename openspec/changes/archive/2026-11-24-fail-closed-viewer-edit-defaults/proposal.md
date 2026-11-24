## Why

HEL-1794 made the pipeline detail page read-only for viewer grantees. Most of its hooks require the caller's role, but
about a dozen UI components still treat an omitted role prop as "may edit" (`canEdit = true`, `canRun = true`,
`readOnly = false`, `isOwner = true`), and one hook (`usePipelineDraftSave`) takes an optional `runRole` that allows
Save & run when omitted. A future caller that forgets the prop silently shows a viewer edit controls. The
HEL-1794 e2e scan also skips everything inside a disabled `<fieldset>`, though a browser does not disable links or
`<summary>` there, and one test comment overstates what its test pins.

## What Changes

- Every pipeline-page UI component whose role prop is optional defaults to the read-only state: `canEdit`/`canRun`/
  `isOwner` default `false`, `readOnly` defaults `true`. `usePipelineDraftSave`'s `runRole` becomes required. Every production caller passes the prop explicitly (unchanged behavior
  for owners, editors and viewers). Test harnesses that relied on the old default pass the role explicitly.
- Jest tests render each component without the prop and assert its read-only signal: no edit/run control, or, for a
  component whose role changes only copy, the viewer copy. Each assertion is red with only that default flipped back.
- The HEL-1794 e2e scan stops skipping by `fieldset[disabled]` ancestry and instead skips only elements the browser
  itself reports `:disabled`, so links, `<summary>`, ARIA buttons, draggables and contenteditables inside a disabled
  fieldset are scanned. `<summary>` joins the scanned selector. A self-test plants an enabled link and summary in a
  viewer's disabled fieldset and requires the scan to report both.
- `viewerCopy.test.ts`'s header comment describes what the test asserts.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-detail-spine-layout`: adds a requirement that a pipeline-page component not told the caller's role offers
  no edit or run control.

## Impact

- `frontend/src/features/pipelines/ui/**` (defaults, callers, tests), `frontend/src/test/` harnesses,
  `e2e/hel1794-viewer-read-only.spec.ts`. No backend, schema, API or migration change.

## Non-goals

- `features/panels/ui/detailModal/usePanelDetailEditState.ts` (`canEdit = true`): the panel detail modal, not the
  pipeline page; raised as a follow-up at Delivery rather than widened here.
- Making the props required at the type level (see design.md D1).
