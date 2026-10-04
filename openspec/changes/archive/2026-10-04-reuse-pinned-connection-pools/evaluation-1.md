## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit 35ef86fecc9b3d2777d3392441ff636d951d2715.

### Phase 1: Spec Review — PASS
Issues: none. Fix is address-keyed, per-ActorSystem (Pekko Extension), bounded (256, clear-on-overflow);
validateAndResolve is called per request at both call sites (ContentSourceSupport.scala:341, RestApiConnectorDriver.scala:329) and is not cached.
Spec delta and tasks match the implementation. Constraints C1-C4 honored. No scope creep.

### Phase 2: Code Review — PASS
Gate (own run, nice -n 19): `sbt testFull` -> 5597 tests, 0 failed (no flakes hit). sbt client shutdown issued as its own call. No frontend files changed.
Independent mutation runs (all restored via backup; `git status` clean afterwards):
- M0 (revert fix: pinnedPoolSettings builds fresh settings each call): 3 RED (fetchUrl 10-sequential reuse, per-address connection count, REST 10-sequential reuse).
- M1 (drop explicit maxConnections/maxOpenRequests, Pekko defaults on the shared pool): the "40 parallel requests" test goes RED (1 failure) -> it genuinely discriminates Decision 4. Not evidence-shaped non-evidence.
- M2 (constant cache key across addresses): 3 RED (both A,B,A,B routing tests + per-address connection count).
Faithfulness of the constant-key stand-in: pinnedPoolSettings only receives an InetAddress (no hostname), and the pinning tests use one hostname (rebind-test.invalid) resolving to alternating addresses, so a hostname key is behaviourally identical to a constant key for these tests. Faithful.
Thread safety: ConcurrentHashMap.computeIfAbsent; the size()/clear() check-then-act is racy but benign (documented: a miss only costs a new pool). Per-system scoping via Extension is correct.

### Phase 3: UI Review — N/A
No frontend/schemas/routes changes.

### Overall: PASS

### Non-blocking Suggestions
- ContentSourceSupport.scala fetchUrl doc comment line is now over-long after the HEL-1254 insertion; cosmetic.
- Orphaned pools after cache clear linger up to 30s idle (documented); fine.
