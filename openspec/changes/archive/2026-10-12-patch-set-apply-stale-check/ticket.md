# HEL-1458: Patch-set apply doesn't check that targets are unchanged since preview

## Description

`PatchSet(summary, edits)` and `EditTarget(kind, id, parentId)` (`api/protocols/patchsets/PatchSetProtocol.scala:40,76`)
don't record which version of each target was previewed. `PatchSetApplyService` and its resolvers merge each edit onto
whatever is current at apply time. No `updatedAt`, hash or preview token is compared.

* The before/after diff the user approved can differ from what gets applied.
* A delete edit can remove a resource that someone edited after the preview.
* Undo already has a conflict check (`PatchSetUndoConflictCheck.scala`), but apply has none.

## Repro

1. Preview a patch set that updates panel P's title.
2. In another tab, rename P.
3. Apply. The title is overwritten without warning.

**Variant (read from code, reproduce once before fixing):**

1. Apply a patch set. It navigates to `/` with a push.
2. Press Back. `location.state.patchSet` is restored (`PatchSetReviewPage.tsx:~38,~127`), the patch set is previewed
   again, and Apply is enabled again.
3. Apply again. Create edits run twice.

## Acceptance criteria

* The preview returns a fingerprint for each target (`updatedAt` or a content hash).
* Apply accepts those fingerprints and returns 409 naming the stale targets. Nothing is applied on a 409.
* The review page shows the conflict and offers to re-preview.
* After a successful apply, navigation replaces the review route (`navigate(..., { replace: true })` or clear the
  state), so Back can't re-apply.
* The MCP `apply_patch_set` tool behaves the same way.

Verified against origin/main e4289e6c. (Re-verified against origin/main e4ef70c31 at Setup — see premise-validation.md;
resolver code has since been split into per-kind files, defect unchanged.)

## Driver context (overnight queue)

* Product call: the fingerprint carrier/optionality is a contract change — take the reversible recommendation, put an
  "OWNER REVIEW: assumed product call(s)" section at the top of the PR body, and the auditor must return
  PARKED-FOR-OWNER (do not merge).
* Concurrent lanes: HEL-1457 (dashboard `layoutVersion`, touches dashboard update paths), HEL-1515 (step reference
  checks, touches step create/update), HEL-1511 (run reaper). Re-sync with origin/main before PR.
