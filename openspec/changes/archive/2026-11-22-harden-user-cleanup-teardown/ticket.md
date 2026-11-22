# HEL-1817: HEL-1802 tidy: teardown leaves run registry dirty if folder removal fails; prune script ignores DB_USER/DB_PASSWORD; split LocalFileSystemSpec

## Description

origin_kind: followup
origin_ticket: HEL-1802 (PR matto00/helio#1219, merged as 79288722a). The owner chose to file this.

Three leftovers from HEL-1802's reviews:

1. **Teardown order.** If removing a user's upload folder fails after the database delete has committed, e2e teardown (`e2e/support/userCleanupRun.cjs` and its callers) aborts before it clears the run registry. A rerun then fails the registry's exact-match check. Clear the registry, or record the failure, so a failed folder removal cannot block the next run. Report the failure as a count, with no ids or paths.
2. **Prune script credentials.** `scripts/prune-orphan-conversation-folders.mjs` does not map `DB_USER`/`DB_PASSWORD` the way `e2e/support/db.cjs` does, so a URL without credentials fails where the e2e helpers succeed. Make them consistent. The script must still never print a connection string or credential.
3. **Split** `LocalFileSystemSpec.scala` (442 lines, past the soft budget) without changing behaviour, with the same test count before and after.

## Acceptance criteria

- [ ] Item 1: a test fails first. A failed folder removal leaves the registry in a state the next run accepts.
- [ ] Item 2: a selftest covers credentials passed by environment variable.
- [ ] Item 3: the per-suite test counts are recorded before and after the split, and they are equal.
