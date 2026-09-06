-- HEL-590 (evaluation-1.md CR5): explicit, idempotent GRANT for the privileged pool's read on
-- `share_tokens`. `findActiveByHash` (the anonymous share-link validation lookup -- the entire
-- feature for its intended, unauthenticated audience) reads through `ctx.withSystemContext`
-- (the `helio_privileged` role), and V38's `ALTER DEFAULT PRIVILEGES` most likely already covers
-- newly-created tables -- but V100's own header records that V60/V61/V75/V91/V94 all still issue
-- explicit grants rather than relying solely on the default-privilege path, and this repo has had
-- three prod-only RLS/grant incidents (HEL-974) that local/CI/prod-dump testing as a superuser
-- cannot catch. Never edit V101 to add this -- it is already applied to the shared dev database,
-- and Flyway checksums the whole file including comments, so any edit is a boot failure for every
-- other worktree on this machine.

GRANT SELECT ON share_tokens TO helio_privileged;
