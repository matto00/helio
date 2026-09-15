## Evaluation Report — Cycle 3 (evaluation-3.md, FINAL execution cycle)

Re-evaluated at head `a4dc031246abbb37024c6921fe7765b33eb8bb3e`, resuming from `evaluation-2.md`'s
PASS at `edbf71a7`. This cycle's scope: the executor's fix for skeptic-final-2.md's key-order
change request (spray-json's `JsObject`/`JsonParser` are `TreeMap`-backed and alphabetically
reordered CSV<->JSON keys in both directions; fixed by moving `csvToJson`/`jsonToCsv` onto
Jackson `ObjectMapper`/`ObjectNode`, which is `LinkedHashMap`-backed and preserves literal key
order).

### Diff scope

`git diff edbf71a7..a4dc0312 --stat`: `ConvertFormatStep.scala` (+55/-17, production),
`ConvertFormatStepSpec.scala` (+30, tests), `files-modified.md` (+68, handoff). Matches the
claimed scope (a targeted parser swap in `csvToJson`/`jsonToCsv` only).

### Key-order fix — verified correct

- `sbt test` (full suite) at `a4dc0312`: **4446/4446 passed** (4443 + 3 new key-order tests),
  matches the executor's claim.
- Independently re-applied one of the two recorded mutations: mutated
  `val keys = objs.head.fieldNames().asScala.toVector` (`ConvertFormatStep.scala:169`) to
  `.toVector.sorted` (reintroducing alphabetical-sort behavior on the read side). Re-ran
  `sbt "testOnly com.helio.domain.steps.ConvertFormatStepSpec -- -z \"key order\""` — confirmed
  **RED**, both non-alphabetical-key-order round-trip tests failed with exactly the mismatch the
  handoff's own mutation-2 table predicts. Reverted; `diff` against a pristine pre-mutation copy
  was empty; `git status --short` in the worktree is clean.
- Confirmed via a real probe (temporary, deleted before finishing — never committed) that the
  fix does what it claims: checked out the pre-fix (`edbf71a7`) version of `ConvertFormatStep.scala`
  into the worktree, ran the same non-alphabetical-key CSV/JSON probes against it, and reproduced
  the reported alphabetical-reordering defect directly (`z,y,x,w,v` -> `v,w,x,y,z` on read), then
  restored the fixed file and confirmed the same probe round-trips correctly. This corroborates
  the handoff's root-cause narrative against ground truth rather than trusting its prose.
- `json-inconsistent-keys` still passes for same-set-different-order objects: probed directly
  (`[{"a":"1","b":"2"},{"b":"3","a":"4"}]` converts cleanly to `a,b\n1,2\n4,3`, header taken from
  the first object) — matches the executor's claim and the capability spec's "same key SET"
  contract.
- D3 messages byte-identical: confirmed by reading the diff directly — every `fail(...)` call
  site's message string is unchanged text (`"input is not valid JSON"`, `"top-level value is not
  an array"`, `"an array element is not an object"`, `"objects do not share the same key set"`,
  `"field '$k' holds a nested object/array"`, `"field '$k' is not a string"`); only the mechanism
  producing/consuming the JSON changed, not the reason codes or wording.

### Probed the four requested parser-swap hypotheses — one CONFIRMED as a real regression

Built a temporary spec exercising `ConvertFormatStep.apply` end-to-end for `json->csv` (real
production entry point, not internals), against both the current (Jackson) and the prior
(spray-json, checked out from `edbf71a7` into the worktree, run, then restored) implementations,
for direct before/after comparison. All probe files deleted before finishing; `git status
--short`/`diff` confirmed byte-identical restoration of `ConvertFormatStep.scala`.

| Input | Old (spray, `edbf71a7`) | New (Jackson, `a4dc0312`) |
|---|---|---|
| `[{"a":"1"}] garbage` | THREW `json-malformed` | **SUCCEEDED**, silently ignored trailing text, emitted `a\n1` |
| `[] ]` | THREW `json-malformed` | **SUCCEEDED**, silently ignored the extra `]`, emitted `""` |
| `[{"a":"1"}] // comment` | THREW `json-malformed` | **SUCCEEDED**, silently ignored, emitted `a\n1` |
| `""` (empty) | THREW `json-malformed` | THREW `json-not-array-of-objects` (reason code changed) |
| `"   "` (whitespace) | THREW `json-malformed` | THREW `json-not-array-of-objects` (reason code changed) |
| `[{"a":"1","a":"2"}]` (dup keys) | **SUCCEEDED**, silently last-wins, emitted `a\n2` | **SUCCEEDED**, silently last-wins, emitted `a\n2` (unchanged) |
| `[{'a':'1'}]` (single quotes) | THREW `json-malformed` | THREW `json-malformed` (unchanged) |
| `[{"a": NaN}]` | THREW `json-malformed` | THREW `json-malformed` (unchanged) |
| `[{"a":"1"},]` (trailing comma) | THREW `json-malformed` | THREW `json-malformed` (unchanged) |

**Hypothesis 1 — CONFIRMED, real regression.** Jackson's `ObjectMapper.readTree(String)` parses
only the first JSON value and silently ignores anything after it (no `FAIL_ON_TRAILING_TOKENS`
equivalent is set); spray-json's `JsonParser` requires `value ~ EOI` and rejected all three
trailing-content shapes above. This is not a cosmetic difference: `design.md` D4 and the
capability spec's own "converting any accepted JSON to CSV and back SHALL reproduce a
structurally equal value" and AC2's "an unconvertible input fails the step with a named reason"
are both violated for genuinely malformed input that now silently converts using only its
leading, valid-looking prefix and discards the rest without any signal to the caller. A user
whose upstream JSON has a trailing artifact (a stray character, an accidental double-close
bracket, a trailing comment some tool appended) gets a wrong, truncated conversion instead of a
named failure they can act on.

**Hypothesis 2 — confirmed as a reason-code drift, non-blocking on its own.** Empty/whitespace
input now reports `json-not-array-of-objects` instead of `json-malformed`. Neither
`design.md` nor `ConvertFormatStepSpec` names an expected code for this specific edge case, so
this isn't a violation of a stated contract, but it is an unreported, untested behavior change
worth folding into the same fix (a `null`/empty `JsonNode` is naturally a parse failure, not a
"not an array" shape failure).

**Hypothesis 3 — REFUTED, not a regression.** Duplicate JSON keys silently overwrite
(last-wins) in *both* the old spray-json implementation and the new Jackson one — confirmed by
running the same probe against the checked-out pre-fix file. `D3`'s reason-code list has no
`json-duplicate-keys` code at all, so this was already outside the design's named-failure
taxonomy before this cycle's change; the Jackson swap did not introduce or worsen it.

**Hypothesis 4 — confirmed, no other leniency regression found.** Single-quoted keys, bare
`NaN`, and a trailing comma inside the array all still throw `json-malformed` under Jackson's
defaults, matching spray-json's behavior exactly (`ObjectMapper()`'s default
`JsonReadFeature`/`JsonParser.Feature` set is strict on these).

### Overall: FAIL

Hypothesis 1 is a real, concretely-demonstrated regression against AC2 ("An unconvertible input
fails the step with a named reason, never empty rows... The failure-arm tests must be failable,
proven by mutation") and against D4/the capability spec's round-trip/failure contract: three
input shapes that correctly failed before this cycle's parser swap now silently succeed with
truncated, wrong output and no named reason at all. This is squarely a code defect (not a
`BLOCKER` — nothing environmental is wrong) and must be a Change Request.

### Change Requests

1. **`backend/src/main/scala/com/helio/domain/steps/ConvertFormatStep.scala`, `jsonToCsv`
   (currently `val parsed = try jsonMapper.readTree(text) catch { case _: Exception =>
   fail("json-malformed", "input is not valid JSON") }`)**: `ObjectMapper.readTree(String)` does
   not reject trailing content after the first JSON value. Parse via a `JsonParser` explicitly and
   assert end-of-input immediately after reading the tree, folding any resulting exception into
   the same `json-malformed` failure, e.g.:
   ```scala
   val parsed =
     try {
       val parser = jsonMapper.createParser(text)
       val node   = jsonMapper.readTree(parser)
       if (node == null || parser.nextToken() != null)
         fail("json-malformed", "input is not valid JSON")
       node
     } catch { case _: Exception => fail("json-malformed", "input is not valid JSON") }
   ```
   I independently probed this exact shape (temporary test, not committed) against all three
   trailing-content cases above plus a clean-input control and an empty-string control: it
   rejects all three trailing-content shapes and the empty string, and still accepts clean input.
   Add regression tests for at minimum: `[{"a":"1"}] garbage`, `[] ]`, and an empty string,
   each asserting `json-malformed`.
2. **Non-blocking alongside CR1**: since CR1's fix naturally makes empty/whitespace input flow
   through the `json-malformed` catch arm again (a `null` tree from an empty parse), this also
   restores the pre-Jackson reason code for that edge case (Hypothesis 2) as a side effect worth
   confirming with an explicit test once CR1 lands.

### Non-blocking Suggestions
- Consider naming duplicate-JSON-keys explicitly in a future ticket (D3 currently has no code
  for it; behavior is unchanged from before this cycle, so this is pre-existing design scope, not
  a defect of this diff).

## Critical Path (final cycle, Overall = FAIL)

This is the last execution cycle in budget (`CYCLE=3` of `EXECUTION_CYCLES=3`). The single
blocking issue is CR1 above: `jsonToCsv`'s Jackson-based parse silently accepts trailing content
after a valid JSON value, which the pre-fix spray-json implementation correctly rejected as
`json-malformed`. This is a narrow, mechanical fix (swap `readTree(String)` for an explicit
`JsonParser` + end-of-input check, as shown above) with no design-level ambiguity — I verified
the replacement snippet directly. Recommend a focused cycle-4 (or a direct human/executor fix
outside the automated budget) that applies exactly this change plus the three named regression
tests, then a fast re-run of `ConvertFormatStepSpec` and the full suite; no other part of this
ticket's implementation needs further work based on this review.
