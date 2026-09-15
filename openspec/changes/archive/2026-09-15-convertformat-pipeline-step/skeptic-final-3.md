## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Reviewed the whole change from base `04d8b590` to HEAD `4f1ad24ca82aa8878ca2921489ae63e9d7f65673`
(resolved live via `scripts/concertino/resolve-review-base.sh`, exit 0). Treated
`files-modified.md`, `evaluation-1..4.md` and `skeptic-final-1..2.md` as claims only;
everything below is derived from reading the diff, running the code, and running the
gates fresh in this round.

### What I verified (with evidence)

**1. Spray -> Jackson swap correctness (attack #1).**
Read `ConvertFormatStep.scala` in full. Probed the live `ObjectMapper` (via `sbt console`,
same dependency/version as the backend) for the specific hazards named:
- Non-ASCII (`héllo wörld ☺`): written raw UTF-8, valid JSON, no escaping bug.
- Control chars (``, ``): correctly escaped as ``/`` (hex-verified byte
  output `5c 75 30 30 30 31 ... 5c 75 30 30 30 37`) — valid JSON.
- U+2028/U+2029: emitted raw/unescaped (`e2 80 a8` / `e2 80 a9`) — still valid JSON; no spec/AC
  requires JS-eval-context escaping, so not a defect for this ticket's scope.
- `/`: not escaped — valid JSON either way, matches existing test expectations (URLs in CSV
  values round-trip unescaped, e.g. no test regressed).
- Lone surrogate (`\ud800`): silently replaced with `?` (U+FFFD-style) by `writeValueAsString`,
  no exception. Not spec'd anywhere (design.md/ticket.md have zero mentions of
  surrogate/encoding requirements), and BOM handling is explicitly filed out-of-scope by the
  owner ruling — I'm treating this the same way (non-blocking, not required by any AC).
- Big integer (`123456789012345678901234567890`): parses as `BigIntegerNode`, `isTextual` is
  false, so `cell()` correctly routes to `json-non-string-value`, never `json-malformed`.
  Verified by direct probe and by the existing "cell holds a number" test.
- `1e400`: parses as `DoubleNode` (value `Infinity`), still `isNumber`/non-textual, same
  `json-non-string-value` path — never `json-malformed`. Verified.
- `-0`: parses fine, non-textual, same path. Verified.
- Deep nesting (2000 levels): Jackson's default `StreamReadConstraints` (max depth 1000) throws
  `StreamConstraintsException` at `readTree` — this is caught by `jsonToCsv`'s `catch { case _:
  Exception => fail("json-malformed", ...) }` (confirmed: `StreamConstraintsException extends
  JsonProcessingException extends IOException extends Exception`), so it surfaces as a **named**
  `convertformat json-malformed` reason, not the opaque "step execution failed" fallback.
- `csvToJson` output is compact (`ObjectMapper.writeValueAsString` default, no pretty-printer
  configured) — confirmed both by reading the code (no `writerWithDefaultPrettyPrinter`) and by
  the existing exact-string assertions in `ConvertFormatStepSpec` (e.g.
  `"""[{"a":"1","b":"2"}]"""`, no whitespace).
- Round-trip: `csvToJson` output round-trips back through `jsonToCsv` — exercised by the existing
  "csv -> json -> csv reproduces ... exactly" and "property: round trip" tests, which I re-ran
  fresh (see gates below) and confirm pass.

**2. Every named failure reaches the run-visible reason (attack #2).**
Read `InProcessPipelineEngine.StepExecutionException.from` (`InProcessPipelineEngine.scala:47-50`):
only `IllegalArgumentException` messages are kept verbatim; everything else collapses to the
opaque `"step execution failed"`. `ConvertFormatStep.fail()` always throws
`IllegalArgumentException`. The only place a raw Jackson exception type could otherwise escape is
`jsonToCsv`'s parse block, which is now wrapped in `try { ... } catch { case _: Exception =>
fail("json-malformed", ...) } finally { parser.close() }` — every Jackson exception type
(`JsonParseException`, `StreamConstraintsException`, `MismatchedInputException`, etc.) is caught
by the generic `Exception` arm and re-thrown as a named `IllegalArgumentException`. Confirmed with
the deep-nesting probe above (a genuine Jackson `StreamConstraintsException` -> surfaced as
`convertformat json-malformed`, not `"step execution failed"`) and with the existing engine-level
test `"the engine should surface a convertformat failure through StepExecutionException ...
not the opaque fallback"` (re-run fresh, passes). `csvToJson` has no try/catch, but it never
parses arbitrary JSON (only builds/writes its own flat `ObjectNode`s from already-validated CSV
cells), so there's no live Jackson-exception path there to catch.

**3. Failability — two never-before-tried mutations (attack #3).**
I mutated the source directly, ran the full `ConvertFormatStepSpec` (69 tests), observed the
result, then reverted and confirmed the file byte-for-byte matches the pre-mutation original
(`diff` clean) before moving to the next mutation:
- **csvToJson mutation** (`parseCsvRows`): removed the `if field.isEmpty` guard on the
  quote-opens-a-field case (`case '"' if field.isEmpty => ...` -> `case '"' => ...`), i.e. let a
  quote character toggle quoting anywhere mid-field, not just at field start. Result: **all 69
  tests stayed green** — no test exercises a literal quote mid-field. Manually probed both
  versions on `"h\nab\"c,d\"e"`: the real (unmutated) code correctly throws `csv-malformed`
  (ragged row, since the mid-field quote is treated as a literal character per the code's own
  documented contract); the mutant silently produces `[{"h":"abc,de"}]`, silently dropping the
  comma instead of failing. **The delivered code's behavior is correct** (matches its own
  documented "a quote only opens at the start of a field" contract) — this is a test-coverage
  gap, not a delivered defect, so I'm not blocking on it, but flagging as non-blocking (see below).
- **markdownToText mutation**: in the `[text](url)` link-decode branch, changed the emitted
  substring from `text` to `text](url)` (i.e. broke link-text extraction). Result: **all 69 tests
  stayed green** — no test exercises `markdownToText` on real, un-escaped Markdown link syntax
  directly (the one round-trip test containing `[brackets](x)` uses it as *input to
  text->markdown*, which escapes the `[` to `\[`, so it never reaches the raw link-decode branch
  on the way back). Manually probed the real code on `"see [my link](http://example.com) here"`
  markdown->text: correctly returns `"see my link here"`. Again, delivered behavior is correct;
  this is disclosed in the code's own comment as "best-effort, never required for the
  text->markdown->text round trip" — consistent with design.md D5's round-trip guarantee being
  scoped to text produced by this step, not general Markdown parsing. Non-blocking.

Both mutations are genuine coverage gaps in `ConvertFormatStepSpec`, but in both cases the actual
shipped code behaves correctly against its own documented contract, and neither gap corresponds
to an AC or a `tasks.md` C6 requirement (C6 is about the *named failure-arm* tests being
provably killable by mutation, which the 20+ dedicated `failWith(...)` tests already are —
confirmed by inspection: each has its own isolated input isolating exactly one check).

**4. Scope (attack #4).**
- `git diff --name-only` (base->HEAD): backend + openspec/schema files only — zero
  `frontend/**` changes, zero new `db/migration/*.sql` files (confirmed no migration files
  newer than the base in `backend/src/main/resources/db/migration`), zero `ClaudeClient`
  references in the new step or in `PipelineCostEstimator`/`PipelineAnalyzeService`.
- `PipelineCostEstimator.scala` diff: `AiOps` set is **byte-identical** except a comment-only
  correction (`HEL-1105/1106` -> `HEL-1106/1107`, satisfying AC6's second half). `convertformat`
  is classified via a new, distinct `ContentConversionOps` set with its own `content-conversion`
  deny code — it is **not** added to `CheapOps`/auto-run, matching design.md D7's stated
  rationale (byte-size cost is invisible to `CostInput`). Verified live via
  `PipelineCostEstimatorSpec`'s "op coverage" test (`partition every registered op into exactly
  one of CheapOps, AiOps, WriteBackOps, ContentConversionOps`) and the specific
  "deny with content-conversion for an enabled convertformat step" test — both pass.
- design spec `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` §6 (line
  217-227): `convertformat` is described as "deterministic, local ... No ClaudeClient, no AI
  hooks" and separately from the `ClaudeClient`-based ops — matches AC6.
- Full op wiring (AC3) traced end-to-end: `PipelineStep.Registry` (`PipelineStep.scala:235`),
  `PipelineStepKind.ConvertFormat` (`:278`), `PipelineStepConfigCodec` encode/decode path,
  `PipelineStepProtocol`'s wire read/write (`ConvertFormatStepResponse`), `PipelineAnalyzeProtocol`'s
  `ConvertFormatAnalyzeStepResponse`, and `PipelineStepRepository.rowToDomain`'s
  `case Success(cfg: ConvertFormatConfig) => ConvertFormatStep(...)` — all present.
- AC5 (tests using `convertformat` as an unregistered stand-in): `PipelineCostEstimatorSpec` and
  `PipelineCreateTransactionalSpec` both re-ran clean (part of the full suite below); no
  regression, and the "op coverage" test would fail loudly if `convertformat` were left
  unclassified.
- AC8 (no migration): confirmed — Flyway log in the full test run stops at "107 - add writeback
  ops" (the pre-existing migration, unchanged), nothing new.

### Gates re-run fresh this round

```
sbt "testOnly com.helio.domain.steps.ConvertFormatStepSpec"
  Tests: succeeded 69, failed 0 -- All tests passed.

sbt "testOnly com.helio.domain.engine.PipelineAnalyzeServiceSpec \
  com.helio.domain.engine.PipelineCostEstimatorSpec \
  com.helio.domain.model.PipelineStepSpec \
  com.helio.domain.steps.PipelineStepRequiredConfigSpec \
  com.helio.services.pipelines.PipelineAnalyzeConvertFormatSpec \
  com.helio.services.pipelines.PipelineCreateTransactionalSpec"
  Tests: succeeded 201, failed 0 -- All tests passed.

sbt test (full backend suite)
  Tests: succeeded 4451, failed 0, canceled 0
  Suites: completed 294, aborted 0
  All tests passed. [success] Total time: 285 s, exit code 0.
```

No UI changes (`frontend/**` untouched by this diff) — the design-standard/screenshot step of
this gate does not apply.

### Verdict: CONFIRM

AC1-AC8 all trace to real, currently-passing evidence. The two prior rounds' fixes
(Jackson swap for key-order, explicit end-of-input check for trailing-content leniency) hold up
under a fresh adversarial pass including probes those rounds didn't try (control chars, U+2028,
lone surrogates, big/overflow numerics, deep nesting, and two source mutations in previously
untested code paths). Both mutations found coverage gaps, not delivered-behavior defects — the
code does the documented-correct thing in both cases, it's only the test suite that doesn't pin
it down. Scope stayed within the owner ruling: no frontend, no migration, no `ClaudeClient`,
`AiOps` untouched, `convertformat` deliberately excluded from auto-run cheapness.

### Non-blocking notes

1. `ConvertFormatStepSpec` has no test for a literal (non-opening) `"` character appearing
   mid-field in an unquoted CSV cell (e.g. `ab"c`). Current behavior is correct (throws
   `csv-malformed` via the ragged-row check, per the code's own documented "quote only opens at
   the start of a field" contract) but this specific path is currently unpinned — a mutation
   that lets a quote toggle quoting mid-field survives all 69 tests. Worth a follow-up test.
2. `markdownToText`'s `[text](url)` link-decode branch (a "best-effort" path per its own comment,
   never exercised by the text->markdown->text round trip since text->markdown always escapes
   `[`) has zero direct test coverage — a mutation that corrupts the extracted link text also
   survives all 69 tests. Current behavior is correct on a direct probe; flagging only because
   it's genuinely untested, disclosed-dead-in-the-round-trip code.
3. Lone-surrogate CSV/JSON cells are silently replaced with `?` by Jackson's writer rather than
   failing or round-tripping — undocumented and unspecified either way (same "not required,
   filed as its own scope decision" bucket as BOM handling, which the ticket already excludes).
