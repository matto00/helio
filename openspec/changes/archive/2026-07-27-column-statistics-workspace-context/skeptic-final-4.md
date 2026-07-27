## Skeptic Report — final gate (round 4)

### What I verified (with evidence)

**1. Read all three prior final-gate reports in full** (`skeptic-final-1.md`, `skeptic-final-2.md`,
`skeptic-final-3.md`) before touching code, per the brief. Summary confirmed consistent with the
orchestrator's framing: round 1 fixed the `JsString` branch of `asNumeric` for `"NaN"`/`"Infinity"` literals;
round 2 found the sibling `JsNumber` branch unguarded and mandated a single-exit-point restructure; round 3
confirmed `asNumeric`/`rawNumericCandidate` airtight but found `computeColumnStatsForField`'s `numericSum`
accumulator itself could overflow to `±Infinity` even with individually-finite inputs.

**2. Attacked the NEW rounding technique directly, with real probes against the actual shipped code**
(temporary files, removed after use — see item 5).

Read the round-4 diff (`git show 65b1245a`) and the current code directly: Scala replaced
`math.round(mean * 10000) / 10000.0` with `BigDecimal(v).setScale(4, HALF_UP).toDouble`
(`WorkspaceContextService.scala:432-433`); TS added a pre-check `roundToFourDecimals` that falls back to the
unrounded (still-finite) value if `value * 10000` itself overflows (`context.ts:217-221`). Both are applied
after (Scala) or alongside (TS) a `.filter(_.isFinite)`/`Number.isFinite` guard at the
`WorkspaceContextColumnStats`/`stats` construction site, covering `min`/`max`/`mean` together, exactly
matching the human's binding condition (1) in `workflow-state.md:178`.

Wrote and ran a temporary Scala probe spec (`SkepticRoundingProbeSpec.scala`, `sbt testOnly
com.helio.services.SkepticRoundingProbeSpec`) and a temporary TS probe (`helio-mcp/src/__skeptic_probe__.test.ts`,
`npx jest`), both removed after (git status clean before and after — confirmed below):

- `BigDecimal(Double.MaxValue).setScale(4, HALF_UP).toDouble` → `1.7976931348623157E308`, finite, `== Double.MaxValue`. No overflow at the ceiling.
- `Double.MaxValue * 0.9999999999`, rounded → finite, `diff = 0.0` vs. the input — confirms `setScale(4)` on a huge-magnitude value is a pure zero-pad (no rounding-driven magnitude increase), so it structurally cannot push a legitimately-finite value over the `Double` ceiling in practice — matching the reasoning in the code's own comment (`WorkspaceContextService.scala:396-412`).
- Two rows at exactly `Double.MaxValue` (sum genuinely overflows): `min=Some(Double.MaxValue)`, `max=Some(Double.MaxValue)`, `mean=None` — correct, no fabrication.
- One row at exactly `Double.MaxValue`: `mean=Some(Double.MaxValue)` — rounding doesn't destroy or corrupt a legitimate boundary value.
- 499 ordinary rows + one `1.7e308` outlier (Scala and TS, independently): both report the exact same, precisely-computed `mean` (`3.3999999999999998E305`), matching a hand-computed "true" floating-point mean I derived independently in the probe — not the old fabricated `922337203685477.6`. Verified exact-value equality, not just magnitude/sign.
- TS `roundToFourDecimals`'s pre-check path: constructed `v = (Number.MAX_VALUE / 10000) * 1.5` (large enough that `v * 10000` overflows but `v` itself doesn't) → `mean === v` exactly (falls back to the unrounded-but-correct value, no fabrication).

**No case I could construct produced a non-finite value or a wildly-wrong (order-of-magnitude) fabricated
value from either rounding technique.** The specific failure class this whole four-round arc has chased —
"non-finite becomes a deceptively finite, wildly-wrong number" — is closed for the rounding step itself.

Two genuinely reproducible but categorically different findings surfaced (see "Notes for the human's
representation-level decision" below) — neither is a non-finite-or-wildly-fabricated-number path, so per the
human's own framing in `workflow-state.md:186-188` neither triggers "yet another guard."

**3. `asNumeric` regression — confirmed not touched, exhaustive table still passes.**

`git diff 5df9eb6c..HEAD -- backend/.../WorkspaceContextService.scala helio-mcp/src/context.ts` shows zero
hunks inside `asNumeric`/`rawNumericCandidate`'s bodies (only comment references elsewhere) — confirmed by
reading the diff directly, not trusting the commit message's claim.
- `sbt testOnly com.helio.services.WorkspaceContextServiceComputeColumnStatsSpec`: **34/34 passed**, including
  the 15-row exhaustive `asNumeric` table (13 human-specified categories + 2 bonus), each asserting an exact
  `Option[Double]`, not a weaker `isDefined`.
- `npx jest helio-mcp/src/context.test.ts`: **42/42 passed**, including the mirrored 15-case `asNumeric`
  table.

**4. RLS-bypass call-graph — re-traced fresh on the current tree, not inherited from rounds 1-3.**

- `WorkspaceContextService.toDataTypeEntry` (`WorkspaceContextService.scala:213`) → `dataTypeService.listRows(dt.id, user, ...)`.
- `DataTypeService.listRows` (`DataTypeService.scala:37-49`, read verbatim): `dataTypeRepo.findByIdOwned(id, user)` gates the only call into `dataTypeRowRepo.listRows`.
- `DataTypeRoutes.scala`'s `/rows` route (lines 49-84, read verbatim): branch 1 (no params) calls `dataTypeService.listRows` directly (gated); branch 2 (`excludeContentFields`/`maxStructuredColumns`) calls `dataTypeService.findById` first (itself `findByIdOwned`-gated), then `dataTypeService.listRows` again, independently gated a second time.
- `PanelCapabilityService.getCapabilities`/`rowCountOf` (`PanelCapabilityService.scala:31-44`, read verbatim): `dataTypeRepo.findByIdOwned` gates the only other `.listRows` read call site.
- Fresh `grep -rn "DataTypeRowRepository\|\.listRows(" backend/src/main/scala`: exactly the two gated read sites above, plus DI wiring (`Main.scala`/`ApiRoutes.scala`) and two unrelated *write* call sites (`PipelineRunService.overwriteRows`, `BoundPanelService`'s constructor-only import).
- MCP path: `context.ts` → `api.getDataTypeRows(...)` → HTTP `GET /api/types/:id/rows` — the exact route traced above. No direct DB access from MCP.
- **Conclusion: the RLS-bypass concern remains closed**, independently re-derived by reading the actual method bodies this round.

**5. Full fresh gate suite (all read directly).**
- `sbt test` (full suite, before any probe files added): **2296 tests, 0 failures**, 135 suites, `90 s`.
- `sbt testOnly com.helio.services.WorkspaceContextServiceSpec` (the previously-poisoned 8-test DB-backed
  spec, isolated): **27/27 passed**, run standalone — confirms genuinely healthy, not just relocated-and-untested.
- `npx jest helio-mcp/src/context.test.ts`: **42/42 passed**.
- `npx openspec validate column-statistics-workspace-context --strict`: **valid**.
- `npm run check:schemas`: **schemas in sync with JsonProtocols (32 checked)**.
- `npm run check:scala-quality`: **clean (77 soft warnings, pre-existing file-length convention, exit 0)**.
- `npx eslint helio-mcp/src/context.ts helio-mcp/src/context.test.ts helio-mcp/src/helioApi.ts --max-warnings=0`: clean.
- `npx prettier --check` on touched TS/schema/md files: clean.
- Re-ran the compute-stats spec and the MCP jest file again *after* removing my probe files, to confirm my own probing left nothing broken: 34/34 and 42/42 respectively.

**6. Regression tests added this round — read the bodies directly, not just names.**
- Scala "two individually-finite 1e308 values" test: asserts `min = Some(1e308)`, `max = Some(1e308)`,
  `mean shouldBe None` — correct per the invariant.
- Scala "499 ordinary + 1 near-Double.MaxValue outlier" test: asserts `min = Some(1.0)`, `max = Some(1.7e308)`,
  `mean` is `defined`, `.isFinite`, `> 1e300`, and explicitly `should not equal 9.223372036854776E14` (the old
  fabricated value) — a real, meaningful assertion, not a placeholder.
- TS mirrors both cases; the outlier-mean assertion is a looser `toBeGreaterThan(1e300)` rather than an exact
  value (Scala's version is stronger) — a minor test-strength asymmetry, not a correctness gap (I independently
  confirmed via probe that the TS-computed value is exactly correct, matching a hand-derived true mean).
- Serialization-boundary test (human's condition 3, `workflow-state.md:181-183`, "**ONE** test..."): present in
  the Scala pure-unit spec (`WorkspaceContextServiceComputeColumnStatsSpec.scala`), constructs a
  multi-column `columnStats` map (one overflowing, one ordinary numeric, one non-numeric), asserts
  `allNumericValues.forall(_.isFinite)` across the WHOLE map, and round-trips it through the real
  `Map[String, WorkspaceContextColumnStats]` spray-json format (`JsonProtocols` mixin), asserting the wire
  JSON contains no literal `"NaN"`/`"Infinity"` token. Satisfies condition 3 exactly as specified (singular,
  the human's own "relevant columnStats slice" alternative after the DB-backed version poisoned 8 unrelated
  tests). No equivalent needed on the TS side — TS has no spray-json-style wire-serialization quirk to guard
  against (its `JSON.stringify` renders `Infinity`/`NaN` as `null` predictably and was already covered by the
  earlier per-field `undefined`-omission tests).

**7. No scratch/probe artifacts survive.**
- My own two probe files (`SkepticRoundingProbeSpec.scala`, `__skeptic_probe__.test.ts`) were removed.
- `find . -iname "*skeptic*probe*"` after cleanup shows only gitignored build byproducts
  (`backend/target/test-reports/*.xml`, `backend/target/scala-2.13/test-classes/...class`) — confirmed via
  `git check-ignore -v` — matching the pattern the round-4 executor already documented for its own probe.
- `git status --short` and `git status --porcelain | wc -l` both confirm a **fully clean working tree**
  before and after my probing.

### Notes for the human's representation-level decision (not REFUTE-worthy on their own)

Per the explicit instruction to attack the rounding technique for anything "finite, passes every guard, and
still numerically wrong/fabricated" — I found two real, reproducible things, but neither is the
non-finite-or-wildly-fabricated-number class that the human's own framing (`workflow-state.md:186-188`)
identifies as the trigger for "no 5th guard, a representation-level call instead":

1. **Inherent `Double`-accumulator precision loss, pre-existing since round 1, not introduced or worsened by
   round 4's fix.** 500 rows of exactly `1e300` summed via the existing `Double` `numericSum` fold produce
   `mean = 1.0000000000000088E300` instead of the mathematically exact `1e300` — a relative error of
   ~8.8e-15 (≈14th significant digit), reproduced identically on both the Scala and TS sides (same IEEE-754
   summation order, same result). This is **standard, expected floating-point summation behavior** for any
   naive `Double` accumulator (present in numpy, pandas, etc. too), not a "fabrication" in the sense rounds
   1-3 found (those were off by many orders of magnitude via a deceptively-finite garbage value; this is off
   by 1 part in 10^14 and stays in the mathematically correct neighborhood). It is directly relevant evidence
   for the "BigDecimal accumulation vs. documented overflow semantics" choice the human is weighing — BigDecimal
   accumulation would eliminate this class of drift entirely; documented-semantics would need to note it as an
   accepted `mean` precision caveat for extreme-magnitude/high-row-count numeric columns.
2. **A genuine, newly-introduced cross-language rounding tie-break divergence at exact half-cent boundaries.**
   Before round 4, both sides used `math.round`/`Math.round`, which tie-break identically ("round half towards
   positive infinity" — confirmed: `math.round(-0.5) == 0` in both Scala and JS). Round 4 switched *only* the
   Scala side to `BigDecimal`'s `RoundingMode.HALF_UP`, which is "round half away from zero" — a different
   convention for negative numbers. Reproduced directly: a column whose mean divides to exactly `-0.00005`
   rounds to `-0.0001` on the Scala side but to `-0`/`0` on the TS side (probes above). This is a real,
   reproducible divergence from design.md D5/D6's own explicit text (`design.md:258-260`: "an identical
   technique in both Scala and TS... so both sides compute the same IEEE-754 double sum and the same rounded
   result (D6's determinism requirement)") — that text is now **stale** (it still describes the pre-round-4
   `math.round`-based technique verbatim, not the current `BigDecimal`/pre-check-fallback approach). Practical
   materiality is very low: it requires `numericSum / numericCount` to land on an *exact* binary tie at the
   4th decimal place, an essentially unreachable condition for real computed floating-point sums (verified
   only by deliberately constructing rows whose mean is exactly `-0.00005`), and the discrepancy itself is
   `0.0001` — it does not change order of magnitude or mislead in the way the four real bugs this ticket
   caught did. Flagging because it is real, adversarially confirmed, and relevant to a "does full determinism
   hold" question — but it is not the failure class ("non-finite becomes deceptively finite and wildly wrong")
   this round was scoped to hunt for, and I do not believe it should block delivery on its own.
3. Non-blocking, minor: design.md's D5 prose (`design.md:257-260`) should be updated at archive time to
   describe the actual `BigDecimal.setScale`/pre-check-fallback techniques and their (documented-in-code)
   rationale, rather than the stale `math.round`-based description.
4. Non-blocking: the TS "outlier mean" regression test asserts `toBeGreaterThan(1e300)` rather than an exact
   value (Scala's sibling test asserts strict inequality against the old fabricated constant AND a lower
   bound); I independently confirmed via probe that the TS-computed value is in fact exactly correct, so this
   is a test-strength nitpick, not a functional gap.

### Verdict: CONFIRM

### Non-blocking notes
- All five mandatory checks (rounding-technique attack, `asNumeric` regression, fresh RLS-bypass trace, full
  gate suite including the previously-poisoned spec, scratch-artifact hygiene) hold on the current tree.
- The four real, independently-found, reproducible corruption bugs this ticket's four-round arc caught
  (`"NaN"`/`"Infinity"` string literals; `JsNumber`/native-number overflow; `numericSum` accumulator overflow;
  the rounding *technique's own* multiply-overflow surface) are all genuinely closed — confirmed by direct,
  adversarial, reproduced probes this round, not by reading and trusting the executor's or prior skeptics'
  narratives.
- See "Notes for the human's representation-level decision" above for the two precision/parity findings
  worth folding into that decision, plus a design.md staleness note for the archive-time spec sync.
