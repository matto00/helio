# HEL-1239: POST /api/patch-sets/preview returns 500 for an output update (unverified on main)

## Description
`POST /api/patch-sets/preview` returned 500 "Internal server error" for an `update` op on an Output (even a plain rename), while `/apply` for the same op worked. Reproduce on main first.

Claim from a ticket comment (HEL-1249 lane, to be reproduced): reproduces on main with a valid payload for owner, stranger and absent id alike. Claimed root cause: `PatchSetPreviewService` builds its `PatchSetApplyContext` without `outputRepo` (null), so `PatchSetApplyResolvers.findOwnedOutput` NPEs. `ExistenceNotLeakedRoutesSpec`'s "every (kind, op)" guard exempts `output:update`/`output:delete` for preview because of this.

## Acceptance Criteria
- Red first: a preview with an output update and delete on main gives 500.
- Fix the context wiring. Audit every field of `PatchSetApplyContext` that preview leaves null/stubbed against what any resolver dereferences for every (kind, op) preview supports; fix all or make each a typed rejection. Add a test that fails if the preview context lacks something the apply context has (structural parity test).
- Preview stays write-free: prove no rows change after a preview of every supported (kind, op).
- Remove the ExistenceNotLeakedRoutesSpec exemption for preview output:update/output:delete and add real rows (foreign and absent ids give a byte-identical 404, per HEL-1002).
