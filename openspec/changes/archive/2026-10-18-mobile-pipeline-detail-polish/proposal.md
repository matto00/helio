## Why

HEL-1582 shipped the phone pipeline page and its BottomSheet step editor. Its gates found seven polish defects: a
`?step=` deep link does nothing on a phone, toasts paint behind the open sheet, Escape on the schema panel also closes
the sheet, the schema panel picks its side by its cap rather than its real height (and now opens below on desktop),
hover fills stick after a tap, three pieces of spine copy are unclear or clipped, and the editor's phone refresh has
no e2e.

## What Changes

- Phone: an initial `?step=<id>` opens that step's sheet; the open sheet and `?step=` stay in sync.
- Toasts render above an open modal dialog (any `Modal`/`BottomSheet`), still announced and dismissable.
- Escape while the schema panel is open closes only the panel.
- `OutputSchemaDisclosure` places by measured height, prefers above, clears the phone bottom nav, and derives its
  sizes from CSS instead of literal pixel mirrors.
- Pipeline-page hover fills are gated behind `@media (hover: hover)`.
- Copy: no duplicated "Static" on the source card; Output card reads "from <step>"; the last-run relative time
  survives an 8-digit row count at 375px.
- New e2e: an editor refreshes a source sample on the phone page.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-detail-mobile-layout`: deep link, Escape scoping, hover gating, copy, editor refresh coverage.
- `pipeline-detail-spine-layout`: schema panel placement (desktop and phone), Output card wording.
- `toast-surface-behavior`: toasts visible above an open modal dialog.

## Non-goals

- HEL-1661 (viewer Run buttons, grantee banner) and HEL-1670 (tidy, schedule 404s).
- App-wide hover colour/contrast tokens (HEL-1669) and the hel1579 rate-limit fix (HEL-1620).
- No backend or API change. No release.

## Impact

Frontend only: `features/pipelines/ui/{mobile,spine}`, `OutputSchemaDisclosure`, `hooks/usePortalPopover`,
`shared/ui/Toast.tsx`/`toast.css`, pipeline-page CSS, new jest tests and e2e specs.
