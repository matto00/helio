## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Verified cold against the code on this branch; round 1's report was read only as a list of claims to re-test.

**Round-1 CR#1 (four `toRows` call sites) — CLOSED.**
`grep -rn "toRows(" backend/src/main/scala` gives exactly four REST sites:
`RestApiConnectorDriver.scala:320` (`inferSchema`), `:325` (`fetch(config, maxRows, ctx)`),
`:387` (`inferSchemaEphemeral`), `services/sources/SourceService.scala:342`
(`connector.toRows(json, source.config.rootSelector).take(10)`). D5's table and task 4.4 now enumerate all
four. The claimed error channel is real: `SourceService.scala:335-339` is the existing HEL-311
`ServiceError.BadGateway(err)` curated pass-through, in the same `previewRest` method. `:325`'s only caller
is `InProcessPipelineEngine.scala:136`, which already `Future.failed`s on `Left` — D5's claim there is true.

**Round-1 CR#2 (preview decision) — CLOSED, and the decision is correct.**
`previewRest` (`SourceService.scala:333-348`) stays in `JsValue` space and never reaches `jsRowToRow`, so
without D6 this change would have created a fresh preview-vs-schema-vs-rows divergence. I checked the stated
side effect: `applyComputedFields` (`SourceService.scala:376-397`) evaluates over `obj.fields`, so flattening
before it changes what expressions see. That is benign — `grep -rn computedFields` shows computed fields are
applied **only** in `SourceService.previewSql`/`previewRest`, never in the executed pipeline path, and a
top-level flat key's binding is unchanged by flattening. Spec coverage exists
(`nested-json-flattening` scenario "Source preview agrees with schema and rows") and task 5.9 tests both
halves. `previewSql` needs no change — `SqlConnectorDriver.toRows` (`:124`) is flat by construction.

**HEL-858 boundary — still respected.** `mergeObjects` (`SchemaInferenceEngine.scala:82-99`) is first-non-null-wins
over raw `JsObject`s; task 2.2 pins it untouched and D8 forbids widening. `leaves` as a pure per-object
function is a genuine seam for 858, not a blocker. Nothing here implements or obstructs it.

**Scope — still tight.** One new object (`JsonFlattener`), two projections rewired, one third projection for
preview, one `Either` variant plus four call sites. No migration, no wire change, no frontend. Expression-lexer
work correctly pushed to a spinoff (D9 re-verified: `ExpressionEvaluator` identifier scan is letters/digits/`_`,
`.` enters the number branch).

`openspec validate nested-json-row-flattening --strict` → `Change 'nested-json-row-flattening' is valid`.

### Where round 1's third request was not actually closed

**Round-1 CR#3 (pipeline-run-execution snapshot scenario) — the wording moved from one false claim to another.**
It now reads: "every field in the snapshot corresponds to a column present in **at least one** of the run's
rows, **and every column key appearing in any run row corresponds to a field in the snapshot**."

The second clause is false on this change, by construction, and provably so on the ticket's own mandated payload:

- Inference merges *objects* before flattening. `mergeObjects` keeps the **first non-null value per top-level
  key** (`SchemaInferenceEngine.scala:85-87`), so for a key whose value is a nested object, only the **first
  row's** sub-keys ever reach `flattenObject`. Sub-keys appearing only in a later row are invisible to the
  schema but present as columns in that row. That is exactly the field report's issue #2 — the bug **HEL-858
  owns and this change deliberately does not fix** (D8: "Inference over an array of rows keeps behaving as it
  does today, bug included").
- This is not hypothetical. I fetched the live acceptance endpoint
  (`https://api.sleeper.app/projections/nfl/2026?...position[]=WR`, 1364 rows): row 0's `stats` has 32 keys;
  the union over just the first 50 rows has 34 (`pr_td`, `rush_td` appear only later). So on the very payload
  the ticket requires as the fixture (task 5.4) and the live probe (6.1), the reverse-inclusion clause fails.
- A second, independent breaker of the *forward* clause exists too: `mergeObjects`' `withNulls` pass
  (`SchemaInferenceEngine.scala:91-97`) overwrites a merged value with `JsNull` if **any** sampled row had null
  for that key. If one row has `"stats": null` and another `"stats": {...}`, the merged object carries
  `stats -> JsNull`, so the schema advertises a flat nullable `stats` field while the rows carry `stats.pts_ppr`
  — the ticket's original defect shape, surviving the fix. The live WR payload happens not to trigger it
  (`stats`/`player` are objects in all 1364 rows; the nulls are on scalar keys), but neighbouring Sleeper
  endpoints and any partially-populated API will.

So the scenario as reworded asserts a guarantee only HEL-858 can deliver, and satisfying it here would mean
silently delivering 858 — the outcome D8 exists to prevent. Round 1's request (scope the claim honestly) is
still open; the artifact swapped one unsatisfiable scope for another.

This propagates into the test plan: task 5.4 says to drive **5.2 (the symmetry regression test)** from the
multi-player Sleeper slice. Over a multi-row array that test fails for the reason above, regardless of a correct
implementation. The symmetry criterion is per-object (as `nested-json-flattening`'s own "Schema and rows agree
on the same input" scenario correctly scopes it); the tasks do not say so, so the executor is currently pointed
at a test that cannot pass.

### Verdict: REFUTE

### Change Requests

1. **`specs/pipeline-run-execution/spec.md` — drop the unsatisfiable reverse-inclusion clause.** Keep only the
   direction this change guarantees ("every field in the snapshot corresponds to a column present in at least
   one of the run's rows") and state the residual gap explicitly: a nested sub-key present only in a later
   sampled row is not yet in the snapshot, owned by HEL-858. Evidence it is false as written:
   `SchemaInferenceEngine.scala:85-87` plus the live payload's `stats` key-set drift (32 keys in row 0 vs 34
   across the first 50 rows).

2. **`design.md` D8 — name the `mergeObjects` null-clobber as a known residual, decide it, and say so.**
   `withNulls` (`SchemaInferenceEngine.scala:91-97`) turns a nested-object key into `JsNull` whenever any
   sampled row has null there, producing a flat `stats` schema field against `stats.pts_ppr` rows — i.e. the
   ticket's exact defect surviving in a null-heterogeneous payload. Either (a) declare it out of scope as
   HEL-858's merge-policy territory and document the residual in D8 and the PR body, or (b) decide to handle
   it here. (a) is defensible and keeps scope tight; leaving it unnamed is not, because AC #1
   ("rows … as the DataType advertises") reads as covering it.

3. **`tasks.md` 5.2 / 5.4 — scope the symmetry test per-object.** State that the symmetry assertion runs
   per row object (`inferredFieldNames(rowObj) == materialisedColumnKeys(rowObj)`), not over the whole
   multi-row array, and that the Sleeper slice is exercised row-by-row for symmetry (whole-array use stays for
   5.3/5.5). As written, 5.4's "drive 5.2 from it" makes the mandated regression test fail against a correct
   implementation, which is how a real fix gets misdiagnosed as broken at the eval gate.

### Non-blocking notes

- D1 says `leaves` returns pairs "sorted by generated path (preserving `flattenObject`'s existing
  `sortBy(_._1)`)". Those are not the same ordering: today's sort is per level, so for keys `a` (object with
  `z`) and `a-b`, per-level gives `a.z, a-b` while a global path sort gives `a-b, a.z` (`-` = 45 < `.` = 46).
  Harmless — both projections consume the same `Seq`, so agreement and collision determinism hold, and flat
  input is unaffected — but the parenthetical is inaccurate and an existing field-order assertion could move.
- `scripts/concertino/next-report-number.sh` now exists in this worktree (round 1 reported it missing);
  it returned `READY number=2`.
- The live payload has `player.metadata` as a third-level object, so the fixture in 5.4 will naturally
  exercise multi-level nesting — worth keeping that key in the trimmed slice rather than pruning it.
