## Why

HEL-1802 added a post-commit folder-removal step to the e2e throwaway-user teardown, and a prune script for orphan
conversation folders. Its reviews left three gaps: a folder-removal failure after the user delete commits aborts
teardown before the run registry is cleared, so the left-behind registry (the documented by-hand recovery input) now
names users that no longer exist and the delete builder's exact-match check refuses it; the prune script ignores
`DB_USER`/`DB_PASSWORD`, so a credential-less URL fails where the e2e helpers succeed; and `LocalFileSystemSpec.scala`
is 442 lines, past the 250-line soft budget.

## What Changes

- The shared delete-then-remove helper never lets a post-commit failure escape as an exception: every folder (and the
  uploads-root resolution itself) is attempted, failures are counted, and the result carries `{removed, failed, total}`.
  Its one log line stays numbers-only and now includes the failed count.
- The registry teardown (moved from `userCleanup.ts` into the testable CommonJS helper module, with `userCleanup.ts` a
  thin wrapper) removes the run's registry directory once the delete has committed, even when folders failed, and then
  fails loudly with a count-only message. A delete that did not commit keeps the registry, as today.
- The other two callers (`helio-mcp/scripts/layoutPreconditionSeam.ts`, `scripts/landing-captures/run.mjs`) surface a
  non-zero failed count as a failure (a failing check / a non-zero exit), count only.
- The prune script maps `DB_USER`/`DB_PASSWORD` from the process environment to `PGUSER`/`PGPASSWORD` for every
  database it queries, through the same helper `e2e/support/db.cjs` uses, and scrubs them from any error output.
- `LocalFileSystemSpec.scala` is split into three suites with identical tests; per-suite counts recorded before/after.

## Capabilities

### New Capabilities

### Modified Capabilities
- `e2e-test-user-cleanup`: a failed post-commit folder removal no longer blocks the registry cleanup.
- `orphan-upload-folder-prune`: database credentials may be supplied by `DB_USER`/`DB_PASSWORD`.

## Impact

`e2e/support/userCleanupRun.cjs`, `e2e/support/userCleanup.ts`, `e2e/support/db.cjs`,
`e2e/support/userCleanup.selftest.mjs`, `helio-mcp/scripts/layoutPreconditionSeam.ts`,
`scripts/landing-captures/run.mjs`, `scripts/prune-orphan-conversation-folders.mjs` and its selftest, `e2e/README.md`,
`backend/src/test/scala/com/helio/infrastructure/storage/LocalFileSystem*Spec.scala`. No product code, no migration,
no API change.
