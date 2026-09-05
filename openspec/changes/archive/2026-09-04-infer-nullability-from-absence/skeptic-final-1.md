## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Commit under review: a5a4745c. All conclusions derived from the diff, the source files, the
fixture, and my own test runs — not from evaluation-1.md or files-modified.md.

### What I verified (with evidence)

**Scope / run constraints.** `git diff main...HEAD --stat`: 11 files — one production file
(`SchemaInferenceEngine.scala`), one spec file, and openspec docs. `git diff --name-only |
grep -c "helio-mcp\|WorkspaceContextService\|PipelineService\|patchsets"` → `0`. No Flyway
migration, no `backend/src/main/resources/db/migration/` file, no `frontend/**` file. No UI
surface exists in this change, so no browser/Playwright check was performed or needed (per the
run constraints and because DESIGN.md binds only `frontend/**`). Working tree is clean apart
from the untracked `evaluation-1.md`; no `node_modules` or helio-mcp artifact was committed.

**HEL-893 not fixed as a side effect.** The only change to the CSV path (`fromCsv`) is a
five-line explanatory comment (design D3/D4); `parseRfc4180Row(...).padTo(...)` and the
empty-cell→nullable fold are byte-identical to main. Declared-vs-materialized CSV numeric types
are untouched. HEL-893 is recorded as out-of-scope in proposal.md:47 and design.md:37.

**Q1 — produced inferred nullability, 1-of-100 and the real fixture.** Both asserted on the
produced value, not on "inference completed":
- `SchemaInferenceEngineSpec.scala:112-119` builds 1 object carrying `stats.rec` plus
  `Vector.fill(99)` that do not, and asserts `stats.rec` `nullable shouldBe true`.
- `:357-364` loads `hel858/sleeper-mixed-projections-slice.json` and asserts `stats.rec`
  nullable. I independently confirmed the fixture's ground truth with `jq`: 15 elements,
  `stats.rec` present in only **4 of 15**, positions `[QB, RB, WR]`. So the fixture genuinely
  exercises the reported defect shape rather than a synthetic stand-in.

**Q2 — three encodings, each named in the test.** Three distinct tests, each stating its
encoding in the test name and the assertion line: ABSENT (`:81`, "…(ABSENT encoding)"),
PRESENT-BUT-EMPTY (`:89`, `JsString("")` in every object → `nullable false`, `StringType`), and
a combined test at `:99-108` that labels all three inline (`// ABSENT`, `// EXPLICIT NULL`,
`// PRESENT-BUT-EMPTY`). The explicit-null arm is additionally pinned by the pre-existing
`ts`/`opponent` tests. Spec lines 119-129 state the same three-way distinction normatively.

**Q3 — red-before.md is genuine.** I did not take the transcript on trust. Each cited line
number was checked against the file as it stands now: 85, 106, 118, 131, 144, 364 land exactly
on the six `nullable shouldBe true` assertions of the six named tests — so the transcript was
captured against these tests, not an earlier draft. The transcript's `Total number of tests run:
59` (53 passed, 6 failed) matches my own green run's `59` exactly, i.e. no test was added or
removed after capture. Deductively the six are necessarily red pre-fix: the old `PathAcc`
carried `nullable: Boolean` seeded `false` and flipped only on a `JsNull` leaf, and all six
assert `true` for absence-only inputs (the fixture's `stats.rec` has no explicit null anywhere —
it is simply missing from 11 of 15 elements).

**Q4 — WR-fixture expectations were not edited at all.** This is the strongest possible answer
to "edited to make tests pass": the diff contains **zero** changes to the 63-triple pinned
expectation block or to any fixture file (`git diff --stat` lists no resource under
`backend/src/test/resources/`). The pinned `(name, type, nullable)` list from HEL-858 stands
untouched and still passes, which is itself the honest outcome — the WR fixture is single-shape,
so no field is absent from any element and the new rule flips nothing there.

**Q5 — one composed rule, no residual assignment.** `nullable` is computed at exactly one site,
in the projection: `val nullable = presentNonNullCount < objects.size`. `grep -n "nullable =
true" SchemaInferenceEngine.scala` returns only a comment at line 145 describing an unrelated
pipeline-output caller's own policy. The `JsNull` branch now does `m.updated(path, prior)` —
it sets nothing; it merely fails to increment, which is arithmetically identical to absence.
No second boolean survives anywhere in `PathAcc`.

**Denominator soundness (my own added check).** Two ways the count could lie were checked
against source, not documentation: (a) `JsonFlattener.leaves` deduplicates to at most one pair
per dotted path per object (ListMap fold), so `presentNonNullCount` can never exceed
`objects.size` and mask a real absence; (b) the denominator is the same `objects` sequence that
is folded (`SchemaInferenceEngine.scala:16-17, 109`), with non-object array elements dropped by
`elements.collect` *before* both, so it cannot be inflated by non-objects.

**Q6 — false-positive direction guarded on real data.** `:364` asserts `player_id`
`nullable shouldBe false` on the same live fixture; I verified with `jq` that `player_id` is
present **and** non-null in all 15 elements, so this is a real guard rather than a vacuous one.
Reinforced synthetically at `:85` (`x` stays non-nullable) and `:150-155` (single root object,
`fields.forall(!_.nullable)`).

**Q7 — order-independence preserved and tested.** `:369-381` pins the FULL sorted
`(name, type, nullable)` triple sequence over a heterogeneous 3-object array and asserts
`reversed shouldBe forward`. Structurally it is also guaranteed by construction: a count
compared against a constant total is commutative, and the projection re-sorts paths globally.
Type-independence from absence is separately pinned on two arms — `IntegerType` (`:123-133`)
and `StringType` (`:137-147`) — so absence poisons neither the numeric nor the string case.

**Blast-radius claim (AC5) verified, not accepted.** design.md D6 claims no persisted schema
changes. I traced it: REST/SQL create and refresh persist through
`SchemaInferenceFacade.toSchemaFields`, which projects to `SchemaField(name, type)` only —
`nullable` is structurally absent from the persisted shape. The one place `f.nullable` does
reach a persisted `DataField` (`DataSourceService.scala:673`) is on the **CSV** refresh path,
whose behaviour this ticket does not change. The claim holds.

**Gates re-run by me (fresh output read):**
- `sbt "testOnly com.helio.domain.engine.SchemaInferenceEngineSpec"` → 59/59 passed.
- `sbt "testOnly com.helio.domain.engine.* com.helio.domain.connectors.*"` → 607/607 passed
  across 21 suites (covers every other consumer of the engine I found by grep:
  `JsonFlattenerSpec`, `NestedJsonFlatteningSymmetrySpec`, `NewConnectorInferenceSpec`,
  `RestApiConnectorDriverSpec`).
- `node scripts/check-scala-quality.mjs` → clean (soft warnings only, all pre-existing).
- `node scripts/check-openspec-hygiene.mjs` → `openspec/ is clean`.

### Verdict: CONFIRM

### Non-blocking notes
- The `[RED] task 3.10b` comment (pre-existing, from HEL-858) cites
  `evidence/wr-fixture-characterisation.md`, which lives in HEL-858's archived change dir and so
  is not resolvable from this change dir. Not introduced here and not worth a change request,
  but it is the "ticket-ref in a comment is never dereferenced" pattern again.
- CSV still conflates present-but-empty with absent. This is documented as deliberate (design
  D3/D4, spec line 4) and is the right call given CSV has no distinct encoding — noting it only
  because the two paths are now stated to "agree on absence" while deliberately disagreeing on
  the empty case.
