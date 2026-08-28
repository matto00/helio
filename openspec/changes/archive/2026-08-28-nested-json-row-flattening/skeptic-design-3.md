## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold review. Prior reports read as claims only; every conclusion below is re-derived from the
artifacts and the code on this branch.

### What I verified (with evidence)

**Round-2 CR#1 (unsatisfiable reverse-inclusion clause) — CLOSED, correctly.**
`specs/pipeline-run-execution/spec.md`'s snapshot scenario now asserts only the forward direction
("every field in the snapshot corresponds to a column present in at least one of the run's rows")
and states the residual explicitly ("the converse does not yet hold … owned by HEL-858").
I re-derived that the *forward* clause is actually satisfiable under both residuals:
- first-non-null-wins (`SchemaInferenceEngine.scala:85-87`) makes the schema a subset of the first
  non-null value per key, so every inferred path came from some row and is carried by it;
- the `withNulls` pass (`:91-97`) can only set a key to `JsNull` if some sampled row had `JsNull`
  there, and that row materialises a `stats` column (JsNull is a leaf) — so the flat `stats` field
  it advertises is still a column present in at least one row.
So the surviving clause is not a second over-promise. That was the specific failure of round 2.

**Round-2 CR#2 (`mergeObjects` residual) — CLOSED.**
design.md D8 now carries "Known residual in `mergeObjects` — named, and deliberately left to
HEL-858", naming both mechanisms with correct line references (verified: `mergeObjects` is
`SchemaInferenceEngine.scala:82-99`; first-non-null-wins at `:85-87`; `withNulls` at `:91-97`),
deciding both out of scope as HEL-858's merge-policy territory, and requiring the residual in the
`pipeline-run-execution` spec and the PR body. Task 2.2 pins `mergeObjects` untouched. The
decision is honest: it names the defect shape ("the ticket's exact defect surviving in a
null-heterogeneous payload") rather than minimising it.

**Round-2 CR#3 (symmetry test scoping) — CLOSED.**
tasks.md 5.2 now scopes the assertion `inferredFieldNames(rowObj) == materialisedColumnKeys(rowObj)`
**per row object**, with the reason stated (a whole-array assertion would fail against a correct
implementation), and 5.4 says the Sleeper slice drives 5.2 row-by-row while 5.3/5.5 run over the
whole slice. This matches `nested-json-flattening`'s own per-object scenario wording.

**Round-2 non-blocking notes — both applied.** D4 now says "global path sort, not `flattenObject`'s
current per-level `sortBy(_._1)`" with the `a-b` vs `a.z` divergence and the possible field-order
test update called out (verified against `SchemaInferenceEngine.scala:102`, which is per-level).
5.4 now keeps `player.metadata` in the trimmed slice.

**Round-1 CRs — re-verified still closed, independently.**
`grep -rn "toRows(" backend/src/main/scala` → exactly four REST sites
(`RestApiConnectorDriver.scala:320`, `:325`, `:387`, `SourceService.scala:342`), all four in D5's
table and task 4.4. `InProcessPipelineEngine.scala:136-139` does `case Left(err) => Future.failed`,
so D5's "fails the run loudly" claim holds. The preview decision (D6) is still the right call —
`previewRest` stays in `JsValue` space.

**Blast radius re-derived, not taken on trust.** `jsRowToRow` has exactly two callers
(`InProcessPipelineEngine.scala:138,143` — REST and SQL); `flattenObject` is only reached from
`fromJson` (`:18,:21`); the only two connector drivers are REST and SQL. So D6's enumeration
(static/image/SQL untouched) is complete. `anyToJsValue`'s HEL-216 `Map` case is on the write side
and cannot be reached by this change (task 3.3 pins it).

**No remaining over-promise found in the specs.** `schema-inference`'s "an inferred dotted field is
always a field the rows actually carry" is the forward direction, satisfiable as shown above.
`nested-json-flattening`'s symmetry requirement is scoped "for any input object". Ticket AC #2's
unqualified wording is narrowed honestly by D8 + the spec residual + task 5.2.

**Scope still tight for an Urgent ticket.** One new object, three projections, one `Either` variant,
four call sites, no migration, no wire change, no frontend. `openspec validate
nested-json-row-flattening --strict` → `Change 'nested-json-row-flattening' is valid`.

### Verdict: CONFIRM

No change request from round 1 or round 2 survives. Nothing new rises to blocking.

### Non-blocking notes

- **An existing test pins the pre-fix shape and will fail** (found this round; not raised before):
  `backend/src/test/scala/com/helio/domain/connectors/RestApiConnectorDriverTemplatingSpec.scala:158-162`
  asserts `rows.head("headers").asInstanceOf[String] should include("\"X-Custom\":...")`, with a
  comment stating that `jsValueToAny` serialises a nested `JsObject` to compact JSON. After this
  change that row carries `headers.X-Custom` and no `headers` column, so the assertion throws.
  The correct update is to assert `rows.head("headers.X-Custom") shouldBe "custom-header-value"` —
  which is a *stronger* proof of the same thing the test exists for. Flagging it because the wrong
  repair (deleting or weakening the assertion) would quietly discard a real check. tasks.md has no
  item for updating pre-fix-shape assertions; gate 8.1 will surface it either way.
- `rest-api-connector/spec.md`'s "carries dotted columns matching its inferred schema" reads
  whole-response; it is true per selected row and consistent with the D8 residual, but the
  per-object qualifier used elsewhere would make it uniform.
- `scripts/concertino/next-report-number.sh` does **not** exist in this worktree (only
  `assert-phase.sh`, `cleanup.sh`, `lib`, `README.md`, `setup-worktree.sh`, `start-servers.sh`).
  Re-checked after the first `127`. Used the main-tree copy against this change directory, which
  returned `READY number=3` — filename is still collision-safe, no fallback was guessed. Worth
  syncing the worktree's script set.
