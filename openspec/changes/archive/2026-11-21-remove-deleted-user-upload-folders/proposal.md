## Why

Deleting a test user leaves `assistant-conversations/{userId}/` behind under the uploads root. The conversation file
itself is queued and drained with its row (V132), but the local filesystem delete leaves the now-empty user directory,
and a lane database dropped before a drain tick leaves the file too. 331 folders had piled up on the owner's machine.

## What Changes

- The local storage backend's delete removes directories it empties, up to (never including) the top-level family
  directory, so a drained conversation leaves no `{userId}/` folder. GCS has no directories and is unchanged.
- The e2e/test-user cleanup removes each deleted user's `assistant-conversations/<exact id>` folder under the uploads
  root after the delete commits, for every `buildUserDeleteSql` caller in this repo (three), resolving the root the
  way the dev backend does (process env over `backend/.env`, then the home default).
- A new prune script lists conversation folders whose user id is in none of the given databases. Dry run by default;
  deletes only with an explicit flag; selects by exact UUID folder name only.
- The PR documents production account-deletion behaviour: there is none; any `users` delete queues every blob.

## Non-goals

- Building a production account-deletion feature (none exists; that is a product decision).
- Changing concertino's lane cleanup (rendered, gitignored here; a CON follow-up).
- Cleaning the owner's existing residue (the script makes it possible; running it with the delete flag is the owner's).
- Any migration or change to the deletion queue, other upload families (flat, object-id keyed), or GCS.

## Capabilities

### New Capabilities

- `orphan-upload-folder-prune`: dry-run-first prune of conversation folders whose user exists in no given database.

### Modified Capabilities

- `stored-object-lifecycle`: removing a conversation object also removes the per-user directory it leaves empty.
- `e2e-test-user-cleanup`: teardown also removes each deleted user's conversation folder under the uploads root.

## Impact

`LocalFileSystem` (+ spec), a new drain integration test, `e2e/support/userCleanupCore.cjs`/`userCleanup.ts` and its
selftest, `e2e/support/db.cjs`, `helio-mcp/scripts/layoutPreconditionSeam.ts`, `scripts/landing-captures/run.mjs`, a
new `scripts/` prune script with selftest, `package.json`, `.husky/pre-commit`, `.github/workflows/ci.yml`, docs.
No migration, no API change, no frontend change.
