## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `371e101c59080fd5eb36263dce431c1b823a3e41` against the live base `13180246ad2ab41bfed697e422ff419321d9df78`.
Cycle-2 delta reviewed: `6d74aeaf4..371e101c5`.

### Phase 1: Spec Review — PASS

All cycle-1 change requests are resolved.

- **CR1 (alert rules through the real service).** Cases (e), (f) and (c) now create their rules with
  `AlertRuleService.create` as the Output owner and assert success (`DraftUndoRlsFixture.createRule`, :210-214). In (f),
  that success shows A owns the Output that editor B's save created.
  - Case (b) still uses one raw row (`insertRule`, :216-223). It is a rule owned by B on A's Output. The doc comment says
    why: `create` requires the Output owner, so no service path can produce it. This fits D6's labelled-fixture allowance.
- **CR2 (P3 revoke).** P3's revoke now goes through `PermissionService.revoke` and asserts `Right(())`
  (DraftUndoPanelNamingSpec.scala:52). The new all-unreadable case does the same (:82).
- **CR3 (inline fully-qualified name).** Replaced with the `Slf4jLogger` import alias (DraftUndoRlsFixture.scala:29, :243).
- **CR4 (dead code).** The unused `fs`/`stepRepo`, the `require` and the stale comment are gone.
- **CR5 (gate scope).** tasks.md 3.3 now says exactly which gates the executor ran, and that the full `testFull` came from
  the evaluator.

Both cycle-1 non-blocking wording suggestions were also applied (DraftRestore.scala:44, :92):
- The combined message is joined with `"; "`.
- A panel clause where every panel is unreadable no longer starts with "and". `stripPrefix("and ")` can only remove the
  describeBlocking count phrase: a named entry always starts with a quote character.
- A new test covers the all-unreadable case, and mutation M5 shows it fails without the fix.

Spec delta, ticket ACs and C16 are still honored. `PatchSetUndoService` is untouched.

### Phase 2: Code Review — PASS

**Shards re-run: yes, at the new HEAD.** `DraftRestore` production code changed, so cycle-1 results at `6d74aeaf4` no
longer count as evidence. All runs used `nice -n 19`, `SBT_OPTS=-J-Xmx3g` and an empty `ANTHROPIC_API_KEY` on embedded
Postgres.

| Gate | Result | Log |
|---|---|---|
| Targeted `testOnly` (DraftUndoPanelNamingSpec, DraftSaveUndoSpec, DraftSaveRootsUndoSpec, `*PatchSetUndo*`) | 17 suites, 96 tests, 0 failed; hel1468 guard failed=0 | `/home/matt/Development/helio/.concertino/scratch/HEL-1792/eval2-targeted.log` |
| Full `sbt testFull` in 8 shards (`HELIO_TEST_SHARD_COUNT=8`, index 0-7) | 754 suites, 10200 tests succeeded, 0 failed, 0 aborted; every guard summary failed=0 | `.../scratch/HEL-1792/eval2-shard{0..7}of8.log` |
| `npm run check:scala-quality` | clean | — |

- The full run has one more test than cycle 1 (10199): the new all-unreadable case.
- The 5 cancelled tests are the same opt-in `HELIO_MEASURE` measurements as cycle 1.
- The quality check's only soft warning on a changed file is `DraftUndoRlsFixture.scala` at 255 lines, against a soft
  budget of 250.

Mutation evidence is now persisted under `.concertino/runs/HEL-1792/evidence/.concertino/scratch/HEL-1792/`:
- `mut3b.log`: naming every rule, run against the service-created rule, makes case (f) fail.
- `mut5.log`: removing the strip makes the all-unreadable case fail.

The earlier red-run and mutation logs (`mut1`-`mut4`) are also persisted there.

The spec split is clean. Setup and helpers moved into `testsupport/DraftUndoRlsFixture.scala`; the test file is 196
lines. No other spec asserts on the changed wording: a grep finds only DraftSaveUndoSpec:116, which is unaffected.

Issues: none.

### Phase 3: UI Review — N/A

There is no frontend, schema or `openspec/specs` change. The only `ApiRoutes` change is one constructor argument.

### Overall: PASS

### Non-blocking Suggestions
- **DraftUndoRlsFixture.scala:37-44.** The doc comment repeats the spec's own description, including "Cases (a)-(c)...".
  A fixture comment could just describe what the fixture provides: two pools, `helio_app_test`, and the services.
- **Case (b).** The removed-Outputs clause only reports counts and does not depend on who owns a rule. A
  service-created rule owned by A would test the same path without a row the product cannot produce. The rule name would
  still be asserted absent, because the clause names nothing. The labelled raw row is acceptable as it is.
- **Duplicated registry.** The fixture builds the ACL registry twice (:99-104 and :126-131). A small builder would bring
  it under the 250-line soft budget.
