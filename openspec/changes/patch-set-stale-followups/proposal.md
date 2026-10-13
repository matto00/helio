## Why

HEL-1458 made patch-set apply refuse targets changed since preview, but its lane left gaps (HEL-1522): `output` and
`pipelineStep` deletes cascade panels and alert rules their fingerprints never cover, the pipeline-delete hint does
not say what it removes, a create-only patch set can be applied twice from a re-entered hand-off, several
fingerprinted fields have no change-then-409 test, and one spec scenario contradicts real behaviour.

## What Changes

- `output` delete fingerprints add the Output's bound panel ids and targeting alert rules.
- `pipelineStep` delete fingerprints add the steps the delete removes and their Outputs (with panels/alert rules).
- The `pipeline` delete impact hint names the panels and alert rules the delete removes (caller-visible ones by name).
- Patch sets minted by refinement and the assistant carry a `proposalId`; apply refuses a proposal the user already
  applied (409 `PATCH_SET_ALREADY_APPLIED`); the review page shows an "already applied" state. Additive, optional.
- New route tests close the listed change-then-409 gaps; run-stability guards also write an Output schema.
- The stale-check spec documents that an `upsertsource` step's first run (new-source target) stales earlier previews.

## Non-goals

- Conflict-banner titles and the MCP 0-based wording (item 6) and splitting the two oversized specs (item 7): filed
  as a separate Follow-up.
- Impact hints for `output`/`pipelineStep` deletes (HEL-1239 decision stands); detecting secret-only changes.
- Carrying `proposalId` through helio-mcp (`helio-mcp/` untouched; MCP applies behave as before).

## Capabilities

### New Capabilities

### Modified Capabilities

- `patch-set-stale-check`: fingerprint coverage for output/pipelineStep deletes; upsertsource first-run scenario.
- `patch-set-preview`: pipeline-delete impact hint names the removed panels and alert rules.
- `patch-set-apply`: apply-once per server-minted `proposalId`.

## Impact

- Backend: `services/patchsets` (fingerprint, impact, apply), refinement + assistant proposal minting,
  `PipelineStepRepository` (shared removed-set rule), one Flyway migration (V131, apply-once claims).
- Schema: `schemas/patch-sets/patch-set.schema.json` gains optional `proposalId`; new
  `schemas/shared/patch-set-already-applied-response.schema.json` (409 body).
- Frontend: `features/patchSets` (types, review page state for the new 409).
- Tests: new route specs under `backend/src/test/.../patchsets/`, frontend unit tests.
