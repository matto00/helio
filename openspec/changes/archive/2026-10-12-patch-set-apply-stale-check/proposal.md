## Why

Patch-set apply merges each edit onto whatever is current at apply time, so the before/after diff a user (or an MCP
agent) approved can differ from what is written: an intervening rename is silently overwritten and a delete can remove
a resource edited after the preview (HEL-1458). Separately, Back after a successful apply restores the review page and
lets the same patch set be applied twice.

## What Changes

- Preview returns an opaque `fingerprint` per update/delete edit, a content hash of the fields the target's update request can write
  (dataSource/pipeline: name only — OWNER REVIEW limitation).
- A patch-set edit's `target` accepts an optional `fingerprint`. Apply compares every supplied fingerprint against the
  target's current state before any write; on any mismatch it returns **409** `PATCH_SET_STALE` naming every stale
  target (index, kind, id) and writes nothing. Absent fingerprints keep today's behaviour (additive, not breaking).
- Refinement (`POST /api/refinements`, MCP `propose_patch_set`) stamps the fingerprints from its own validating
  preview onto the returned patch set, so MCP `apply_patch_set` is protected without any caller change.
- MCP `apply_patch_set` keeps `target.fingerprint` and surfaces the 409's stale targets.
- The review page sends the fingerprints from the preview it showed, renders a 409 as a conflict naming the stale
  targets with a Re-preview action, and navigates with `replace` after a successful apply.

## Capabilities

### New Capabilities
- `patch-set-stale-check`: per-target preview fingerprints, apply's stale-target 409, refinement stamping, MCP and
  review-page behaviour on conflict, and replace-navigation after apply.

### Modified Capabilities
- (none — behaviour added as a new capability)

## Impact

- Backend: patch-set protocol (`EditTarget`, `EditPreview`), preview/apply services, a new fingerprint helper, a new
  `ServiceError` variant + 409 body, refinement service.
- Contract: `schemas/patch-sets/patch-set.schema.json`, `patch-set-preview-response.schema.json`. Additive.
  **New 409 for callers that send fingerprints (MCP via refinement stamping)** — owner review.
- Frontend: patch-set types, slice, `PatchSetReviewPage`. helio-mcp: schemas, types, tool description.
- No migration.

## Non-goals

- Row locking across the check and the writes (a sub-second window remains; see design.md).
- Making fingerprints required (would break existing callers).
- Changing a vanished target's existing error (resolvers already fail loudly; nothing is overwritten).
