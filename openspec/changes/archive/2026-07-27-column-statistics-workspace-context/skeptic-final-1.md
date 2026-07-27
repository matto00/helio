## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**1. Mandatory RLS-bypass call-graph trace (read line-by-line in the CURRENT code, not the design plan).**

Every path that can reach `DataTypeRowRepository.listRows` (privileged/`withSystemContext`, no RLS) was
traced and confirmed gated by an owner-scoped `findByIdOwned` check:

- `WorkspaceContextService.toDataTypeEntry` (`WorkspaceContextService.scala:203-215`) calls
  `dataTypeService.listRows(dt.id, user, limit = Some(StatsRowLimit), excludeKeys = excludeKeys)`.
  `DataTypeService.listRows` (`DataTypeService.scala:37-50`) calls `dataTypeRepo.findByIdOwned(id, user)`
  FIRST and only reaches `dataTypeRowRepo.listRows` inside the `Some(_)` branch — confirmed by reading the
  method body directly.
- `DataTypeRoutes.scala`'s `/rows` route, branch 1 (`!excludeContentFields && maxStructuredColumns.isEmpty`,
  line 58-61): calls `dataTypeService.listRows(id, user, limitOpt)` directly — same `findByIdOwned` choke
  point.
- `DataTypeRoutes.scala`'s `/rows` route, branch 2 (else, lines 62-84, now reachable via
  `excludeContentFields`, `maxStructuredColumns`, or both): calls `dataTypeService.findById(id, user)`
  first (`DataTypeService.scala:27-31`, itself `findByIdOwned`-gated) to read `dt.fields`, computes
  `excludeKeys` (union of `contentExcludeKeys` and `overflowExcludeKeys` via
  `DataTypeService.overflowStructuredFieldNames`), then calls `dataTypeService.listRows(id, user, limitOpt,
  excludeKeys)` — itself independently `findByIdOwned`-gated again. No bypass; the new
  `maxStructuredColumns` param never reaches the repository without first passing ownership.
- `DataTypeRepository.findByIdOwned` (`DataTypeRepository.scala:85-90`) is a real app-layer ACL check —
  `table.filter(r => r.id === id.value && r.ownerId === ownerUuid)` — independent of RLS, not merely relying
  on the privileged pool being off.
- MCP path: `helio-mcp/src/context.ts:404` calls `api.getDataTypeRows(t.id, STATS_ROW_LIMIT, true,
  SAMPLE_COLUMN_LIMIT)` → `helioApi.ts:223-235` → HTTP `GET /api/types/:id/rows?...` — the exact same route
  traced above. No direct DB access from MCP.
- Grepped every call site of `DataTypeRowRepository` (`grep -rn "DataTypeRowRepository\|\.listRows("`
  across `backend/src/main/scala`): the only other read call site is `PanelCapabilityService.rowCountOf`
  (`PanelCapabilityService.scala:42-44`), called only inside `getCapabilities`'s `Some(dt)` branch — i.e.
  only after its own `dataTypeRepo.findByIdOwned(id, user)` (line 35) already succeeded. Pre-existing,
  unaffected by this ticket, and correctly gated.
- Confirmed no direct/unscoped repository access was introduced anywhere in this ticket's diff
  (`git diff main...HEAD --stat`).

**Conclusion: no path reaches `DataTypeRowRepository.listRows` without first passing an owner-scoped
`findByIdOwned` check. The mandatory RLS-bypass concern is closed.**

**2. Fresh test runs (all read myself, not trusted from evaluator's paste).**
- `sbt test` (full backend suite): **2280 tests, 0 failures**, 135 suites, `[success] Total time: 89 s`.
- Targeted re-run of the new/changed suites individually confirmed test names match the required coverage:
  `WorkspaceContextServiceComputeColumnStatsSpec` (18 tests), `DataTypeServiceOverflowStructuredFieldNamesSpec`
  (5 tests), `WorkspaceContextServiceSpec` (26 tests incl. `"should never surface another user's sampleRows"`
  / `"...columnStats"`, both present/absent `min`/`max`/`mean` schema-validation cases), `DataTypeRoutesSpec`
  (13 tests incl. all 4 param combinations of `excludeContentFields`/`maxStructuredColumns`).
- `npx jest helio-mcp/src/context.test.ts`: **28/28 passed**, including
  `"populates columnStats for a pipeline-output DataType from the SAME fetch as sampleRows, called exactly
  once"` and `"reports [] / {} for a source-companion DataType, and never calls getDataTypeRows for it"`.
- `npx openspec validate column-statistics-workspace-context --strict`: **valid**.
- `npm run check:schemas`: **schemas in sync with JsonProtocols (32 checked)**.
- `npm run check:scala-quality`: **clean (76 soft warnings, pre-existing file-length convention, exit 0)**.
- `npx eslint helio-mcp/src/context.ts helio-mcp/src/context.test.ts helio-mcp/src/helioApi.ts
  --max-warnings=0`: clean.
- `npx prettier --check` on all touched TS/schema/md files: clean.

**3. Design-gate binding constraints, checked against the actual (not planned) code.**
- D1 round-1 fix (SQL-tier column cap): `WorkspaceContextService.scala:206-207` builds `excludeKeys =
  contentFieldNames(...) ++ DataTypeService.overflowStructuredFieldNames(dt.fields, SampleColumnLimit)` —
  confirmed applied to the `listRows` call.
- D2 round-3 fix (`computeColumnStats`'s own independent `.take(SampleColumnLimit)`): confirmed at
  `WorkspaceContextService.scala:311-312` (Scala) and `context.ts:164-166` (TS) — both filter+take BEFORE
  folding, independent of the SQL-tier bound. Tests exist for both empty and non-empty snapshot cases on
  both sides.
- D1 round-3 fix (single shared `overflowStructuredFieldNames`): confirmed one implementation in
  `DataTypeService`'s companion object (`DataTypeService.scala:190-195`), called identically from
  `WorkspaceContextService.scala:207` and `DataTypeRoutes.scala:79`.
- D1a memory-retention requirement: `toDataTypeEntry`'s `statsF` (`WorkspaceContextService.scala:208-214`)
  derives BOTH `sanitizeSampleRows` and `computeColumnStats` from `rawRows` inside the same `.map` step —
  `rawRows` is not threaded anywhere else, not accumulated across `Future.traverse`. Confirmed by reading
  the method body directly.
- D7 (schema): `ColumnStats.required` in `schemas/workspace-context.schema.json` = `["nullRate",
  "distinctCount", "distinctCountCapped", "exampleValues"]` — `min`/`max`/`mean` correctly excluded from
  `required`, typed `["number","null"]`. Both field-present and field-absent branches are tested
  (`WorkspaceContextServiceSpec`: `"...when min/max/mean ARE present"` / `"...ARE ABSENT"`).
- Determinism, cross-user (owner-scoping), and backward-compat are each independently tested, not just
  claimed — confirmed by test names read directly above (`"...produce identical...(determinism)"`,
  `"...never surface another user's..."`, `"...omitting both params preserves the plain unbounded-listRows
  response exactly as today"`).

### A real, reproducible correctness bug found via cold adversarial testing (not caught by any prior round)

`asNumeric` (`WorkspaceContextService.scala:396-400` and `context.ts:139-148`) uses each language's generic
numeric-string parser (`s.trim.toDoubleOption` / `Number(trimmed)`), which — unlike ordinary "garbage
string" rejection — treats the literal strings `"NaN"`, `"Infinity"`, `"-Infinity"` as **valid parsed
numbers**, not as unparseable garbage. This directly contradicts D5's own explicit requirement ("a value
that fails to parse as numeric is excluded... don't silently produce garbage").

I reproduced this with a temporary unit test against the actual `computeColumnStats` (removed after
verification; `git status` now clean):

- **Scala, 499 valid values + 1 literal `"NaN"` string cell** in a `float`-declared column:
  `min=Some(NaN)`, `max=Some(NaN)`, **`mean=Some(0.0)`** — `math.round(Double.NaN)` returns `0L` in Java/Scala,
  so `mean` silently becomes a plausible-looking **wrong** finite number (`0.0`) instead of `None` or an
  error. `min`/`max` become `Some(NaN)`, which spray-json's `JsNumber.apply(Double)` converts to `JsNull`
  (confirmed by reading `spray-json_2.13-1.3.6`'s `JsValue.scala` source directly) — so the wire output is
  `"min": null, "max": null` even though the `Option` is `Some`, contradicting this ticket's own schema
  comment ("Absent on the wire (not null)... spray-json omits a None Option field entirely rather than
  emitting null" — that's true for `None`, but a `Some(NaN)` is a different, unhandled case that ALSO
  produces `null`, just via a different mechanism).
- **Scala, 10 valid values (1-10) + 1 literal `"Infinity"` string cell**: `min=Some(1.0)` (correct),
  `max=Some(NaN)`→ wire `null`, and **`mean=Some(9.223372036854776E14)`** — `math.round(Double.PositiveInfinity)`
  returns `Long.MaxValue`, producing a wildly wrong ~922-trillion "mean" for a column of small integers.
- **TS, same 10-valid + `"Infinity"` case**: `asNumeric("Infinity")` returns `Infinity` (not filtered — only
  the literal `"NaN"` string is filtered by TS's `Number.isNaN` guard, `"Infinity"`/`"-Infinity"` are NOT),
  poisoning `numericMax`/`mean` to `Infinity`; `JSON.stringify({min:1, max:Infinity, mean:Infinity})` →
  `{"min":1,"max":null,"mean":null}` — same class of silent corruption on the MCP side, asymmetric with
  Scala (Scala is poisoned by `"NaN"` too; TS is not, but both are poisoned by `"Infinity"`/`"-Infinity"`).

This is not a contrived/pathological case: carried finding #4 (ticket.md) explicitly documents that CSV
sources read all columns as JSON strings at runtime regardless of declared type, and literal `"NaN"` /
`"Infinity"` text is a common real-world missing/overflow-value convention in CSV/JSON exports (numpy,
various ETL tools). A single such cell anywhere in a numeric-declared column's ≤500-row window silently
corrupts that column's `mean` to either a fabricated wrong number or a bare `null`, and no existing test
(Scala `WorkspaceContextServiceComputeColumnStatsSpec`/`WorkspaceContextServiceSpec` or TS
`context.test.ts`) exercises a `"NaN"`/`"Infinity"`/`"-Infinity"` string cell — the entire test suite passes
despite this, because none of the ~46 new test cases across both languages include this input.

### Verdict: REFUTE

### Change Requests

1. **Fix `asNumeric` on both the Scala (`WorkspaceContextService.scala:396-400`) and TS
   (`helio-mcp/src/context.ts:139-148`) sides to reject non-finite parse results.** Scala: after
   `s.trim.toDoubleOption`, additionally filter out `NaN`/infinite results, e.g.
   `s.trim.toDoubleOption.filter(_.isFinite)` (or equivalent explicit check) so `"NaN"`, `"Infinity"`,
   `"-Infinity"` are treated as unparseable garbage, matching D5's stated intent. TS: change the guard from
   `Number.isNaN(n) ? undefined : n` to `Number.isFinite(n) ? n : undefined` (catches `NaN` AND
   `±Infinity` in one check, and also symmetric with the Scala fix).
2. **Add regression tests on both sides** (a `computeColumnStats`/`computeColumnStatsForField` case with a
   `"NaN"` cell and a separate case with an `"Infinity"`/`"-Infinity"` cell mixed into an otherwise-valid
   numeric column) asserting the poisoned value is excluded from the aggregate exactly like any other
   unparseable string — i.e. `min`/`max`/`mean` reflect only the valid values, not `None`/`null` and not a
   fabricated number. This closes the exact gap ("no coverage for `"NaN"`/`"Infinity"` string literals")
   that let this through all three design-gate rounds and the executor's own test-writing.
3. (Follow-on, non-blocking on its own but should be verified once #1 is fixed) Re-run `sbt test` and
   `npx jest helio-mcp/src/context.test.ts` after the fix to confirm no other test's fixtures relied on the
   old (buggy) parsing behavior.

### Non-blocking notes

- The RLS/ownership call-graph trace, the full fresh test suite, schema/lint/format checks, and every
  binding design.md constraint I checked (D1/D1a/D2/D7 round-1/2/3 fixes) all hold in the current code —
  this REFUTE is scoped narrowly to the numeric-string-parsing defect above, not a broader rejection of the
  approach.
- `min`/`max`/`mean`'s schema typing as `["number","null"]` (rather than just `"number"`, matching the
  stated "absent, not null" intent) turned out to be prescient — it happens to keep the buggy `null` output
  schema-valid today. Once #1 is fixed, consider whether `null` should still be a permitted value for these
  three fields (it would then never legitimately occur) — a documentation/schema-tightening cleanup, not a
  blocker for this round.
