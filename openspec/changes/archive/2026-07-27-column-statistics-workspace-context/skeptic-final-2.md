## Skeptic Report — final gate (round 2)

### What I verified (with evidence)

**1. Mandatory RLS-bypass call-graph trace — re-traced fresh on the CURRENT tree (not inherited from round 1).**

- `WorkspaceContextService.toDataTypeEntry` (`WorkspaceContextService.scala:196-231`) calls
  `dataTypeService.listRows(dt.id, user, limit = Some(StatsRowLimit), excludeKeys = excludeKeys)`.
- `DataTypeService.listRows` (`DataTypeService.scala:37-50`, read directly): calls
  `dataTypeRepo.findByIdOwned(id, user)` first; `dataTypeRowRepo.listRows` is only reached inside the
  `Some(_)` branch (line 45-49). Confirmed by reading the method body verbatim.
- `DataTypeRoutes.scala`'s `/rows` route (`DataTypeRoutes.scala:49-87`, read directly): branch 1
  (`!excludeContentFields && maxStructuredColumns.isEmpty`, line 58-61) calls `dataTypeService.listRows`
  directly — `findByIdOwned`-gated. Branch 2 (else, lines 62-84) calls `dataTypeService.findById` first
  (itself `findByIdOwned`-gated, `DataTypeService.scala:27-31`) then `dataTypeService.listRows` again,
  independently gated. No bypass.
- `PanelCapabilityService.getCapabilities`/`rowCountOf` (`PanelCapabilityService.scala:31-44`, read
  directly): `dataTypeRepo.findByIdOwned(id, user)` is called first (line 32); `rowCountOf(id)` — the only
  other `DataTypeRowRepository.listRows` call site in the whole backend — is only reached inside the
  `Some(dt)` branch (line 34). Unaffected by this ticket, correctly gated.
- Fresh grep of every call site: `grep -rn "DataTypeRowRepository\|\.listRows(" backend/src/main/scala`
  confirms exactly the three read paths above plus DI wiring in `Main.scala`/`ApiRoutes.scala` — no new
  site introduced.
- MCP path: `helio-mcp/src/context.ts:412` calls `api.getDataTypeRows(t.id, STATS_ROW_LIMIT, true,
  SAMPLE_COLUMN_LIMIT)` → `helioApi.ts:223-235` → HTTP `GET /api/types/:id/rows` — the exact route traced
  above. No direct DB access from MCP.
- **Conclusion: the RLS-bypass concern remains closed on the current tree.** This was independently
  re-derived by reading the actual method bodies, not by trusting round 1's report.

**2. `asNumeric` fix (round-1 REFUTE fix, commit `1ba0f75c`) — adversarially tested against the real code, not read-and-trusted.**

Confirmed the specific bug round 1 found is fixed: `sbt testOnly
com.helio.services.WorkspaceContextServiceComputeColumnStatsSpec` and `npx jest
helio-mcp/src/context.test.ts` both pass, including the new `"NaN"`/`"Infinity"`/`"-Infinity"`
string-literal regression tests, and I read the test bodies directly (not just names) — they assert the
actual computed `min`/`max`/`mean` values reflect only the valid rows (e.g. `stats.mean shouldBe
Some(15.0)` over `10, 20, "NaN"`), not merely `isDefined`/`isEmpty`. Also probed the adjacent cases named
in my brief directly against `asNumeric`/`context.ts`'s `asNumeric` (via a temporary jest/ts-node probe,
removed after): empty string → `undefined`/`None`, whitespace-only → same, `"  42  "` → `42`/`Some(42.0)`
(still parses correctly), `"0x1A"` (JS `Number` accepts hex — TS returns `26`; a pre-existing, out-of-scope
quirk, not part of this ticket's `"NaN"`/`"Infinity"` fix), `"1_000"` → correctly rejected. All matched the
documented, intended behavior for the fixed literals.

**A second, distinct instance of the SAME bug class survives the fix — found via the adjacent-case probing
this round's brief explicitly directed me to do ("confirm JsNumber/TS's numeric JSON values can't smuggle
a non-finite value in some other way you can think of").**

The round-1 fix patched only the `JsString`/`typeof "string"` branch of `asNumeric`. The `JsNumber`/`typeof
"number"` branch was left unfiltered, on the stated (and, on inspection, incorrect) assumption that a
native numeric JSON value can never be non-finite:

- **Scala** (`WorkspaceContextService.scala:406-409`): `case JsNumber(n) => Some(n.toDouble)` — the
  comment claims "a spray-json `JsNumber` wraps `BigDecimal`, which cannot represent `NaN`/`Infinity`, so
  this branch is always finite." This is true of `BigDecimal` *itself*, but false of `n.toDouble`: a
  `BigDecimal` of sufficiently large magnitude overflows to `Double.PositiveInfinity` on conversion,
  independent of `BigDecimal`'s own (arbitrary-precision, always-finite) representation.
- **TS** (`context.ts:147-156`): `if (typeof value === "number") return value;` — no `Number.isFinite`
  check at all on this branch (only the `typeof "string"` branch got the `Number.isFinite` fix).

I reproduced both, against the actual shipped code (not a hand-copy), with temporary probes removed after
verification (`git status` now clean):

- **Scala**, via a temporary test added to `WorkspaceContextServiceComputeColumnStatsSpec.scala`, run with
  `sbt testOnly com.helio.services.WorkspaceContextServiceComputeColumnStatsSpec`:
  `service.asNumeric(JsNumber(BigDecimal("1e400")))` → `Some(Infinity)` (printed directly from the running
  test). Folded into `computeColumnStats` alongside two normal values (10, 20): `max = Some(Infinity)`,
  `mean = Some(9.223372036854776E14)` — the identical `Long.MaxValue`-via-`math.round(Infinity)` corruption
  round 1 found for the `"Infinity"` string case, this time via a genuine `JsNumber`, not a string.
- **TS**, via a temporary `helio-mcp/src/__skeptic_probe__.test.ts` importing the real, exported
  `asNumeric`/`computeColumnStats` from `context.ts` (not a reimplementation), run with `npx jest`:
  `JSON.parse("1e400")` — a real Node.js `JSON.parse` call, exactly what the axios/fetch layer underneath
  `HelioApi.getDataTypeRows` performs on every HTTP response body — evaluates to the native JS value
  `Infinity` (`typeof` `"number"`, confirmed by printing both). `asNumeric(Infinity)` returns `Infinity`
  unfiltered. Folding it into `computeColumnStats` alongside two normal values (10, 20) produced `{"min":
  10, "max": null, "mean": null}` on the wire (`JSON.stringify` renders `Infinity` as `null`) — the same
  "plausible-looking wrong number or bare null" corruption class, reached through the numeric-JSON channel
  rather than the string-literal channel the round-1 fix closed.

This is not confined to the artificial `"1e400"` magnitude I used to demonstrate it cleanly — it is a
structural gap in the `asNumeric` contract (Scala's `.toDouble` and JS's own float representation both
silently overflow to `±Infinity` for sufficiently large/small magnitude numeric JSON literals; this is a
well-known IEEE-754 behavior, not exotic to this codebase) that D5's own stated invariant — "a value that
fails to parse as numeric is excluded... don't silently produce garbage" — was supposed to close for
*every* unparseable-or-non-finite input, not only the string-literal subset round 1 happened to probe. A
`sum`-then-average pipeline output, or any sufficiently large stored numeric value in a `float`/`integer`
Structured column, can trigger this without any adversarial string content at all.

**3. Fresh full test/lint/format runs (read directly, not trusted from evaluator/executor claims).**
- `sbt test`: **2285 tests, 0 failures**, 135 suites — matches the executor's claimed count exactly.
- `npx jest helio-mcp/src/context.test.ts`: **33/33 passed**.
- `npx openspec validate column-statistics-workspace-context --strict`: **valid**.
- `npm run check:schemas`: **schemas in sync with JsonProtocols (32 checked)**.
- `npm run check:scala-quality`: **clean (77 soft warnings, pre-existing file-length convention, exit 0)**.
- `npx eslint helio-mcp/src/context.ts helio-mcp/src/context.test.ts helio-mcp/src/helioApi.ts
  --max-warnings=0`: clean.
- `npx prettier --check` on touched TS/schema files: clean.

**4. Design.md binding constraints spot-checked against the current code (read directly).**
- D2's independent `.take(SampleColumnLimit)` in `computeColumnStats`: confirmed at
  `WorkspaceContextService.scala:311-312` (Scala, filters+takes before folding) and `context.ts:172-174`
  (TS, same).
- `DataTypeService.overflowStructuredFieldNames` (shared, one implementation): confirmed at
  `DataTypeService.scala:190-195`, called from both `WorkspaceContextService.scala:207` and
  `DataTypeRoutes.scala:79`.
- D1a memory-retention discipline: `toDataTypeEntry`'s `statsF` (`WorkspaceContextService.scala:203-215`)
  derives both `sanitizeSampleRows` and `computeColumnStats` from `rawRows` inside the same `.map` step;
  `rawRows` is not threaded anywhere else. Confirmed by reading the method body directly.
- D7 schema: `schemas/workspace-context.schema.json`'s `ColumnStats.required` =
  `["nullRate","distinctCount","distinctCountCapped","exampleValues"]`; `min`/`max`/`mean` typed
  `["number","null"]`, correctly excluded from `required`. Note: this typing choice means the newly-found
  `JsNumber`-overflow defect's `null` wire output stays schema-valid — the schema cannot catch this class of
  bug by construction (same observation round 1 made about the string case, now confirmed to still apply).

### Verdict: REFUTE

### Change Requests

1. **Fix the `JsNumber`/native-number branch of `asNumeric` on both sides to reject non-finite conversions,
   symmetric with the already-fixed string branch.**
   - Scala (`WorkspaceContextService.scala:406-409`): change `case JsNumber(n) => Some(n.toDouble)` to
     filter the converted value, e.g. `case JsNumber(n) => Some(n.toDouble).filter(_.isFinite)`. Also
     correct the method's doc comment (`WorkspaceContextService.scala:388-405`) — the claim "a spray-json
     `JsNumber` wraps `BigDecimal`, which cannot represent `NaN`/`Infinity`, so this branch is always
     finite" is false for the `.toDouble` conversion (a large-magnitude `BigDecimal` overflows to
     `Double.PositiveInfinity`/`NegativeInfinity`), even though it is true of `BigDecimal`'s own
     representation.
   - TS (`context.ts:147-156`): change `if (typeof value === "number") return value;` to `if (typeof value
     === "number") return Number.isFinite(value) ? value : undefined;`.
2. **Add regression tests on both sides for a genuine numeric-JSON-value overflow, not just the
   string-literal case already covered**, e.g. a `computeColumnStats`/`computeColumnStatsForField` case
   with a `JsNumber(BigDecimal("1e400"))` (Scala) / `JSON.parse("1e400")`-derived (TS, or any construction
   that yields a native `Infinity`/`-Infinity` number) cell mixed into an otherwise-valid numeric column,
   asserting `min`/`max`/`mean` reflect only the valid values — not a fabricated number, not a `null` that
   masks a `Some`/non-`undefined` internal state. A direct `asNumeric`/`service.asNumeric` unit test for a
   `JsNumber`/native-number non-finite input (mirroring the existing `"NaN"`/`"Infinity"` string tests)
   should also be added.
3. Re-run `sbt test` and `npx jest helio-mcp/src/context.test.ts` after the fix to confirm no other test's
   fixtures relied on the current (still-buggy) numeric-branch behavior, and re-run
   `check:scala-quality`/`check:schemas`/lint/format once more before returning to this gate.

### Non-blocking notes

- The RLS/ownership call-graph trace, the full fresh test suite, schema/lint/format checks, and every
  design.md binding constraint spot-checked (D1a, D2, D7, `overflowStructuredFieldNames`) all hold in the
  current code. The round-1 REFUTE's specific finding (string-literal `"NaN"`/`"Infinity"`/`"-Infinity"`)
  is genuinely and correctly fixed — this REFUTE is scoped narrowly to the sibling gap in the same
  function's other branch, not a broader rejection of the approach.
- `"0x1A"`-style hex-string parsing (JS `Number("0x1A")` → `26`) is a pre-existing quirk of using bare
  `Number(...)` for string parsing on the TS side, asymmetric with Scala's `toDoubleOption` (which rejects
  hex). Out of scope for this ticket (not part of D5's stated concern, and not a "garbage becomes a
  plausible wrong number" case in the same sense — `0x1A` is arguably a deliberately-parsed value, not
  corruption) — flagging only as a documentation note, not a blocker.
