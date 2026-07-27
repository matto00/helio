## Skeptic Report — final gate (round 3)

### What I verified (with evidence)

**1. `asNumeric` restructure — adversarially attacked; confirmed structurally sound (the specific fix the
human mandated genuinely holds).**

Read the current code directly:
- Scala (`WorkspaceContextService.scala:417-421`):
  `(v match { case JsNumber(n) => Some(n.toDouble); case JsString(s) => s.trim.toDoubleOption; case _ =>
  None }).filter(_.isFinite)` — single exit-point filter over the whole match, exactly as claimed.
- TS (`context.ts:141-175`): `rawNumericCandidate` (per-branch conversion, no finiteness opinion) feeds
  `asNumeric`, which applies `Number.isFinite` once at its single return point. Confirmed
  `rawNumericCandidate` is **not exported** (`grep -rn "rawNumericCandidate" helio-mcp/src/` — only
  definition + doc references + the one internal call from `asNumeric` at line 173) — no call path can
  bypass the wrapper.

I wrote and ran temporary probes directly against the real, exported/`private[services]` functions (removed
after verification; `git status` clean before and after):
- Scala: `asNumeric(JsString("1e400"))` → `None` (the exit filter catches overflow reached via the string
  branch too, not just the literal `"NaN"`/`"Infinity"` words — confirms the filter is genuinely
  branch-independent, not just re-testing the two known literals).
- Scala: `asNumeric(JsNumber(Double.MaxValue))` → `Some(Double.MaxValue)` (finite boundary correctly kept).
- Scala: `asNumeric(JsNumber(Double.MinPositiveValue))` → `Some(Double.MinPositiveValue)` (subnormal
  correctly kept).
- Could not construct any input to either language's `asNumeric` that produces a non-finite return. The
  restructure's claim — "structurally incapable of returning a non-finite value regardless of which branch
  produced the candidate" — holds under adversarial testing.
- Re-confirmed round 2's `"0x1A"` characterization: `Number("0x1A")` → `26`, a finite, deliberately-parsed
  value, not a non-finite-smuggling path. Out-of-scope characterization still holds.

**2. Exhaustive test tables — read every row directly, both sides.**

- Scala (`WorkspaceContextServiceComputeColumnStatsSpec.scala:287-311`): a table of 15 cases (13 the human
  specified + `JsNull` bonus), each asserting the exact `Option[Double]` (e.g. `Some(42.0)`, `Some(10.5)`),
  not a weaker `isDefined`/`isEmpty`. All 13 required categories present: finite number, +overflow (`1e400`),
  -overflow (`-1e400`), `"NaN"`, `"Infinity"`, `"-Infinity"`, valid numeric string, valid numeric string with
  whitespace, empty string, whitespace-only string, non-numeric string, boolean, object, array (+ null).
- TS (`context.test.ts:309-339`): identical 15-case table (using `JSON.parse("1e400")`/`JSON.parse("-1e400")`
  for the overflow cases — the same code path the real HTTP-response `axios`/`fetch` JSON parse would take,
  not a hand-constructed `Infinity` literal), each asserting the exact `number | undefined`. Same 13
  categories present, none superficial or weakly asserted.
- Both tables would have caught round 1's and round 2's original bugs had they still existed. Confirmed
  exhaustive, not merely long.

**3. RLS-bypass call-graph — re-traced fresh on the current tree, not inherited from any prior round.**

- `WorkspaceContextService.toDataTypeEntry` (`WorkspaceContextService.scala:196-215`) →
  `dataTypeService.listRows(dt.id, user, ...)`.
- `DataTypeService.listRows` (`DataTypeService.scala:37-50`, read verbatim): calls
  `dataTypeRepo.findByIdOwned(id, user)` first; `dataTypeRowRepo.listRows` only reached in the `Some(_)`
  branch.
- `DataTypeRoutes.scala`'s `/rows` route (lines 49-87, read verbatim): branch 1 (no
  `excludeContentFields`/`maxStructuredColumns`) calls `dataTypeService.listRows` directly — gated. Branch 2
  (either param set) calls `dataTypeService.findById` first (itself `findByIdOwned`-gated,
  `DataTypeService.scala:27-31`) to read `dt.fields`, then `dataTypeService.listRows` again — independently
  gated a second time.
- `DataTypeRepository.findByIdOwned` (`DataTypeRepository.scala:85-90`): `ctx.withUserContext(...)` **plus**
  an explicit app-layer `r.ownerId === ownerUuid` filter — double-protected, not merely relying on RLS.
- `DataTypeRowRepository.listRows` (`DataTypeRowRepository.scala:63-79`) confirmed on `ctx.withSystemContext`
  (privileged, BYPASSRLS) — no RLS backstop, app-layer gate is the sole protection.
- Fresh `grep -rn "DataTypeRowRepository\|\.listRows(" backend/src/main/scala`: exactly three read call
  sites — `DataTypeService.listRows` (gated, above), `PanelCapabilityService.rowCountOf`
  (`PanelCapabilityService.scala:31-44`, only reached inside `getCapabilities`'s `Some(dt)` branch, itself
  `findByIdOwned`-gated at line 32) — plus DI wiring in `Main.scala`/`ApiRoutes.scala`. The other two
  `dataTypeRowRepo.*` call sites found (`PipelineRunService.scala:354`, `BoundPanelService.scala:297`) are
  `overwriteRows` (write path), not `listRows`.
- MCP path: `context.ts:431` → `api.getDataTypeRows(...)` (`helioApi.ts:223-235`) → HTTP `GET
  /api/types/:id/rows` — the exact route traced above. No direct DB access from MCP.
- **Conclusion: the RLS-bypass concern remains closed on the current tree**, independently re-derived by
  reading the actual method bodies this round, not trusted from rounds 1/2.

**4. Fresh full gate suite (all read directly, not trusted from executor's claims).**
- `sbt test`: **2293 tests, 0 failures**, 135 suites — matches the executor's claimed count.
- `npx jest helio-mcp/src/context.test.ts`: **40/40 passed**.
- `npx openspec validate column-statistics-workspace-context --strict`: **valid**.
- `npm run check:schemas`: **schemas in sync with JsonProtocols (32 checked)**.
- `npm run check:scala-quality`: **clean (77 soft warnings, pre-existing file-length convention, exit 0)**.
- `npx eslint helio-mcp/src/context.ts helio-mcp/src/context.test.ts helio-mcp/src/helioApi.ts
  --max-warnings=0`: clean.
- `npx prettier --check` on touched TS/schema/md files: clean.

**5. Other design.md binding constraints, spot-checked against current code.**
- D2's independent `.take(SampleColumnLimit)` in `computeColumnStats`: confirmed
  `WorkspaceContextService.scala:312` (Scala) and `context.ts:191-193` (TS), separate from
  `sanitizeSampleRows`'s own cap.
- `DataTypeService.overflowStructuredFieldNames` (shared, one implementation): confirmed
  `DataTypeService.scala:190-195`, called from both `WorkspaceContextService.scala:207` and
  `DataTypeRoutes.scala:79`.
- D1a memory-retention discipline: `toDataTypeEntry`'s `statsF` (`WorkspaceContextService.scala:203-215`)
  derives both `sanitizeSampleRows` and `computeColumnStats` from `rawRows` inside the same `.map` step.
- D7 schema: `ColumnStats.required` = `["nullRate","distinctCount","distinctCountCapped","exampleValues"]`;
  `min`/`max`/`mean` correctly excluded, typed `["number","null"]`. Present/absent branches both tested
  (`WorkspaceContextServiceSpec.scala:735`/`749`).

### A new, real, reproducible correctness bug — same failure class as rounds 1/2, different location

`asNumeric` itself is now provably airtight. But the SAME symptom (silent `mean` corruption to a
plausible-looking fabricated number, or `min`/`max`/`mean` disappearing to a bare `null`) survives via a
sibling gap the human's directive didn't scope: **the running `numericSum` accumulator in
`computeColumnStatsForField`/its TS mirror has no finiteness guard, and can overflow to `±Infinity` even
though every individual value fed into it — post-`asNumeric` — is legitimately finite.**

This directly violates design.md's own explicit D5 invariant: *"a value that fails to parse as numeric is
excluded from the numeric aggregate... it does NOT silently become 0 (would corrupt min/mean)... If zero
values parse as numeric... min/max/mean are None... **rather than a fabricated number**."* D5 addresses the
"nothing parses" case; it does not address "everything parses individually-finite, but the running sum
overflows" — and that gap produces exactly the fabricated-number outcome D5 says must not happen.

Reproduced against the real, unmodified shipped code (temporary probes only, removed immediately after
verification — `git status` clean before and after each probe):

- **Scala**, `WorkspaceContextService.scala:368-374` (the final `(min, max, mean)` wrap — no `.isFinite`
  check anywhere in this block): a `float`-declared column with just **two** rows, each `JsNumber(1e308)`
  (a legitimately finite `Double`, well within the valid range for a Postgres `double precision`/JSON
  numeric column — `asNumeric` correctly returns `Some(1e308)` for each individually):
  `min = Some(1.0E308)` (correct), `max = Some(1.0E308)` (correct), **`mean =
  Some(9.223372036854776E14)`** — the identical `Long.MaxValue`-via-`math.round(Infinity)` corruption
  pattern rounds 1 and 2 found in `asNumeric` itself, now reached because `fold.numericSum` (`1e308 +
  1e308`) overflows `Double` to `Infinity` during the fold, entirely downstream of an airtight `asNumeric`.
  - More realistically mixed: 499 ordinary rows (`1` through `499`) plus **one** row with `1.7e308` (still
    `< Double.MaxValue`, a single outlier/corrupted-upstream value, not 500 identical extreme rows):
    `min = Some(1.0)`, `max = Some(1.7E308)` (both correct), **`mean = Some(9.223372036854776E14)`** — a
    single bad-but-technically-valid cell poisons `mean` to a wildly wrong fabricated number, exactly
    mirroring the "one bad cell corrupts everything" pattern that made rounds 1/2's findings real bugs
    rather than contrived ones.
- **TS**, `context.ts:214-263` (`computeColumnStatsForField`, no `Number.isFinite` guard on `numericSum` or
  the final `stats.mean` assignment): the identical 499-normal + 1×`1.7e308` case, run against the real
  `computeColumnStats` via a temporary jest probe importing it directly: internal `stats.amount.mean` is
  the raw JS value `Infinity` (confirmed by `console.log`), which `JSON.stringify` (exactly what the wire
  serialization does) renders as `"mean":null` — the same "plausible-looking wrong number (Scala) or bare
  null masking a corrupted internal state (TS)" corruption class, on the aggregation step this time, not
  the per-value parse step.

This is not confined to the deliberately extreme values I used to demonstrate it cleanly: any `float`
column value near the `Double`/Postgres-`double precision` ceiling (whether from a legitimate scientific
dataset, a corrupted upstream computation, or a division-by-near-zero bug elsewhere in the pipeline) reaches
this gap through the currently-unmodified fold — a scenario this ticket's whole three-round arc has been
about precisely closing (min/max/mean must never silently become a fabricated number). No test on either
side (the new exhaustive `asNumeric` tables, or any existing `computeColumnStats`/`computeColumnStatsForField`
test) exercises a large-but-individually-finite numeric value; the entire suite passes despite this gap.

### Verdict: REFUTE

Note for the record, since this REFUTE's finding is a genuinely different function/location than the prior
two rounds': **this is not another `asNumeric`-branch gap.** `asNumeric`/`rawNumericCandidate` themselves
were attacked exhaustively this round and found structurally sound — the human-mandated single-exit-filter
restructure holds. The bug is one level up, in `computeColumnStatsForField`'s (and its TS mirror's) running
`numericSum`/final `mean` computation, which has no finiteness guard of its own even though every value it
accumulates individually passed `asNumeric`'s guarantee.

### Change Requests

1. **Add a finiteness guard on the aggregated `mean` (and, for defense-in-depth, `min`/`max`) at
   `computeColumnStatsForField`'s single wrap point on both sides**, mirroring the same "one guard at the
   function's exit, not per-intermediate-step" discipline just applied to `asNumeric` — e.g. Scala
   (`WorkspaceContextService.scala:368-374`): wrap the three-tuple assembly so a non-finite `numericSum`
   (or a non-finite computed `mean`) degrades that column's `mean` to `None` rather than emitting a
   fabricated `Some(9.223372036854776E14)`-style value; TS (`context.ts:257-263`): the equivalent
   `Number.isFinite` check before assigning `stats.mean` (and consider `stats.min`/`stats.max`, since
   `numericMin`/`numericMax` are `Math.min`/`Math.max` over already-finite values and cannot themselves
   overflow the same way, but should still be defensively covered if the guard is written generically).
2. **Add regression tests on both sides** for a `computeColumnStats`/`computeColumnStatsForField` case with
   individually-finite numeric values whose running sum overflows (e.g. two `JsNumber(1e308)`/two `1e308`
   values, or the more realistic "499 ordinary rows + 1 near-`Double.MaxValue` outlier" case demonstrated
   above), asserting `mean` reflects a genuinely finite value or `None`/absent — never a fabricated
   `Long.MaxValue`-derived number or a bare `null` masking corrupted internal state.
3. Re-run the full gate suite (`sbt test`, `npx jest helio-mcp/src/context.test.ts`,
   `npx openspec validate column-statistics-workspace-context --strict`, `npm run check:schemas`, `npm run
   check:scala-quality`, lint/format on touched files) after the fix.

### Non-blocking notes

- The `asNumeric` restructure itself is correct, thoroughly tested, and should not be revisited again on
  its own — the human's mandate to stop patching that specific function is fully earned by this round's
  evidence.
- The RLS/ownership call-graph trace, the full fresh test suite, schema/lint/format checks, and every other
  design.md binding constraint checked (D1a, D2, D7, `overflowStructuredFieldNames`) all hold in the current
  code.
- Once the aggregation-level guard is added, consider whether `min`/`max`'s own accumulation
  (`Math.min`/`Math.max` over already-`asNumeric`-filtered finite values) needs the same treatment — my
  probes show `min`/`max` stayed correct in every case I could construct (since `Math.min`/`math.min` over
  finite operands cannot itself produce a non-finite result), but a single shared guard covering all three
  fields is simpler to reason about and audit than one covering `mean` alone.
