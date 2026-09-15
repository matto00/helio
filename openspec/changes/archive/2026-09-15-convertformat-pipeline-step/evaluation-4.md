## Evaluation Report — Cycle 4 (evaluation-4.md, owner-authorized extension cycle)

Re-evaluated at head `4f1ad24ca82aa8878ca2921489ae63e9d7f65673`, resuming from
`evaluation-3.md`'s FAIL (CR1: `jsonToCsv`'s Jackson `readTree(String)` silently ignored trailing
content after a valid JSON value). This cycle's scope: the executor's fix for CR1.

### Scope — confirmed

`git diff a4dc0312..4f1ad24c --stat`: `ConvertFormatStep.scala` (+32/-5, production),
`ConvertFormatStepSpec.scala` (+23, tests), `files-modified.md` (+59, handoff). No other files
touched. Read the production diff directly: only `jsonToCsv`'s parse block changed (now an
explicit `JsonParser` + end-of-input check, wrapped in `try`/`catch`/`finally` to also close the
parser) plus two new imports (`com.fasterxml.jackson.core.{JsonParser => JacksonJsonParser}`,
`com.fasterxml.jackson.databind.JsonNode`). No BOM handling and no duplicate-key handling was
added — confirmed by grep (`grep -n "BOM\|FEFF\|duplicate" ConvertFormatStep.scala` — no new
hits in the diff), consistent with the ask (CR1 was scoped to trailing-content leniency only;
duplicate-key behavior was explicitly refuted as a regression in evaluation-3.md and left alone).

### 1. Full `sbt test` — PASS, mutation re-verified

- `sbt test` (full suite) at `4f1ad24c`: **4451/4451 passed** (4446 + 5 new regression tests:
  the 3 trailing-content cases + empty-string + whitespace-only, matching my evaluation-3.md
  Change Request's recommended minimum).
- Independently re-applied **Mutation 1** from the handoff's cycle-4 table: mutated
  `if (node == null || parser.nextToken() != null)` (`ConvertFormatStep.scala:175`) to
  `if (node == null)` (dropping only the end-of-input check, keeping the null check). Re-ran
  `sbt "testOnly com.helio.domain.steps.ConvertFormatStepSpec"` — confirmed **RED**: exactly
  3 of 69 failed (the 3 trailing-content tests), 66/69 passed — byte-for-byte matches the
  handoff's own reported count and failure set. Reverted; `diff` against a pristine
  pre-mutation copy was empty; `git status --short` in the worktree is clean.

### 2. Re-ran the evaluation-3.md probe table at this head — all regressions fixed

Re-probed `ConvertFormatStep.apply` end-to-end (real production entry point) with the full
evaluation-3.md table plus the additional cases from the original CR1 mutation-testing
(nested-value/non-string-value/inconsistent-keys, to directly test item 3 below):

| Input | Cycle-3 head (`a4dc0312`) | This head (`4f1ad24c`) |
|---|---|---|
| `[{"a":"1"}] garbage` | SUCCEEDED (wrong) | **THREW `json-malformed`** |
| `[] ]` | SUCCEEDED (wrong) | **THREW `json-malformed`** |
| `[{"a":"1"}] // comment` | SUCCEEDED (wrong) | **THREW `json-malformed`** |
| `""` (empty) | THREW `json-not-array-of-objects` | **THREW `json-malformed`** (restored to the pre-cycle-3 code, per evaluation-3.md's non-blocking note) |
| `"   "` (whitespace) | THREW `json-not-array-of-objects` | **THREW `json-malformed`** |
| `[{'a':'1'}]` (single quotes) | THREW `json-malformed` | THREW `json-malformed` (unchanged) |
| `[{"a": NaN}]` | THREW `json-malformed` | THREW `json-malformed` (unchanged) |
| `[{"a":"1"},]` (trailing comma) | THREW `json-malformed` | THREW `json-malformed` (unchanged) |
| `[{"a":"1"}]` (clean) | SUCCEEDED | SUCCEEDED (unchanged) |
| `[{"z":"1","y":"2","x":"3"}]` (non-alpha key order) | SUCCEEDED, `z,y,x` | SUCCEEDED, `z,y,x` (key-order fix from cycle 3 unaffected) |

All three genuine regressions from evaluation-3.md are fixed. The reason-code drift noted as
non-blocking (empty/whitespace) is also restored to the pre-cycle-3 `json-malformed` code, as a
natural side effect of routing the null-tree case back through the same `fail(...)` call.

### 3. Broad `catch` scope — confirmed it cannot mask a post-parse defect

Read the diff directly: the `try { ... } catch { case _: Exception => fail(...) } finally { ... }`
block is scoped to a local `val parsed: JsonNode = { ... }` assignment containing ONLY the parser
construction, `readTree`, and the end-of-input check. The subsequent `if (!parsed.isArray)
fail("json-not-array-of-objects", ...)`, the `objs.head.fieldNames()`/key-set-equality check
(`json-inconsistent-keys`), and `cell(...)`'s nested-value/non-string-value checks are all
**outside** that block, at the plain function-body level — none of them run inside the `try`, so
none of their `fail(...)` throws (which are themselves `IllegalArgumentException`s, a subtype of
the caught `Exception`) can be silently re-caught and relabeled `json-malformed`.

Confirmed empirically, not just structurally — re-ran probes for each non-parse-stage code at
this head:
- `{"a":"1"}` (object, not array) → `json-not-array-of-objects` ✓ (own code, not masked)
- `[1,2]` (array of non-objects) → `json-not-array-of-objects` ✓
- `[{"a":{"x":1}}]` (nested value) → `json-nested-value` ✓
- `[{"a":1}]` (non-string value) → `json-non-string-value` ✓
- `[{"a":"1"},{"b":"2"}]` (inconsistent keys) → `json-inconsistent-keys` ✓

Every post-parse-stage input surfaces its own named reason code, never the generic
`json-malformed` — the broad catch's blast radius is exactly as narrow as claimed.

### 4. Scope — confirmed

Already covered above (diff --stat + direct read): only `jsonToCsv`'s parse block, its own new
tests, and the handoff doc changed. No BOM handling, no duplicate-key handling, no change to
`csvToJson`, the CSV parser, the Markdown functions, wiring, schemas, or docs.

### Additional gates re-run fresh
- `npm run check:schemas`: schemas in sync (no drift; this cycle touches no wire schema).
- `npm run check:scala-quality`: clean; only pre-existing soft file-size warnings (none newly
  introduced by this diff).

### Overall: PASS

All four requested checks pass: the full suite is green, the mutation independently confirms the
end-of-input check is load-bearing, every regression from evaluation-3.md's probe table is fixed
with no new leniency introduced, the broad catch is provably scoped to parsing only and cannot
mask a downstream defect, and the diff's scope matches exactly what was asked (CR1 only, no
BOM/duplicate-key scope creep).

### Non-blocking Suggestions
None new this cycle. `evaluation-3.md`'s own non-blocking suggestion (naming duplicate-JSON-keys
as a future ticket) still stands, unaddressed by design — it was explicitly out of scope for
CR1 and remains outside D3's reason-code taxonomy.
