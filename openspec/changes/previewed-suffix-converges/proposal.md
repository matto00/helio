## Why

HEL-1154 reported a title stacked with five "(previewed)" markers. Premise validation found the only writer is the
DEV-only demo patch set on the Patch Set Review page; its unbounded growth was already fixed by F-002 (c0fbb56a), but
`baseTitle` strips only one trailing marker, so an already-compounded title never converges back to one marker.
The owner ruled `proceed-with-restated-scope`.

## What Changes

- `baseTitle` in `PatchSetReviewPage.tsx` strips every trailing " (previewed)" marker, not just the last one, so the
  demo patch set's rename always carries exactly one marker.
- Red-first Jest probe on the demo patch-set path with a compounded title; existing single-strip test updated.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — the demo fixture is a DEV-build-only development aid, not a product capability with a spec
(`skip_specs: true`).

## Non-goals

- No stored-data repair (the one 5x dev row `93f894fc-…` and its output are left as evidence).
- No backend, migration, helio-mcp, or pipeline step-preview change.
- No change to whether the demo fixture persists on Accept (that is its purpose).

## Impact

- `frontend/src/features/patchSets/ui/PatchSetReviewPage.tsx`, `PatchSetReviewPage.test.tsx`. DEV builds only.
