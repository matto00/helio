## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)
- Head 35ef86fe; diff vs live base 9a57f7aa read in full (main: ContentSourceSupport.pinnedPoolSettings now delegates to new PinnedPoolSettingsCache).
- AC2/AC3: validateAndResolve still runs per request before the lookup in both callers (RestApiConnectorDriver.guardedPoolSettings:329, fetchUrl:341-344); cache keyed by validated InetAddress, never hostname; no validation caching. A blocked-address test with warm pool asserts no new connection.
- Reran PinnedPoolReuseSpec + ContentSourceSupportSpec: 41/41 green, 0 canceled (the 127.0.0.2 binding fixture ran, not skipped).
- My own mutation (cache keyed by /16 prefix of address, a partial unpin the executor did not try): 3 tests FAILED (both A/B/A/B routing tests and the one-connection-per-address test); source restored byte-exact (git status clean of src changes).
- Red-before-fix: evidence/red-before-fix.txt shows "10 was not less than 10" for fetchUrl and REST driver (10 server connections for 10 requests) on unfixed code; the same tests green after.
- Full backend `nice -n 19 sbt testFull`: 5597 succeeded, 0 failed. sbt server shut down.
- Pool limits (16 conn / 256 open, power of two) covered by a 40-parallel test; 4s keepAlive rationale sound; extension scoped per classic ActorSystem; ConcurrentHashMap with computeIfAbsent plus clear-on-overflow is race-safe (a miss costs only a new pool; orphaned pool idles out at 30s).
- AC4: design.md "HEL-1245 bearing" states pooling neither causes nor prevents the entity-subscription timeout, no re-attribution; spec delta and design match shipped code (16/256/4s/256 cap).

### Verdict: CONFIRM

### Non-blocking notes
- cache.size()>=Max check then clear() is not atomic with concurrent inserts; harmless (soft bound).
- evaluation-1.md is untracked in the worktree (normal pre-commit state).
