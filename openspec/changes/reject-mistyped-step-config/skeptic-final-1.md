## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Commit reviewed: `a97431e4`, branch `bug/reject-mistyped-step-config/HEL-860`. Backend-only; no
`frontend/**` in `git diff main...HEAD --stat`, so no UI review. Everything below is from my own
commands in `WORKTREE_PATH`, not from the executor's or evaluator's narrative.

### What I verified (with evidence)

**1. Full suite — my own run.**
`cd backend && sbt test` → `Total number of tests run: 3686`, `Tests: succeeded 3686, failed 0`,
`All tests passed.`, exit 0.

**2. Red-on-revert against the FINAL committed tests — my own run, not the evaluator's transcript.**
`git checkout main --` on exactly the five changed main sources (tests left at `a97431e4`), then
`sbt testOnly PipelineStepRoutesSpec PipelineAnalyzeRoutesSpec PipelineAnalyzeProposalRoutesSpec`:

```
- 4.1 list-shaped casts ... *** FAILED ***
- 4.2 casts object with non-string values ... *** FAILED ***
- 4.3 list-shaped renames ... *** FAILED ***
- 4.5 PATCH mistyped config ... *** FAILED ***
Tests: succeeded 86, failed 4
```

Exactly the four rejection tests red; all 86 others green. Tree restored (`git checkout HEAD -- backend/src/main`).

**3. Mutation kill of CR-1's negative assertion — independently reproduced, not accepted on the
orchestrator's artifact.** I reintroduced only the pre-fix `shapeDescription` in `RenameStep.scala`
(validator and 422 path intact) and ran `PipelineStepRoutesSpec`:

```
- 4.3 ... *** FAILED ***
  "Invalid 'rename' config: 'renames' must be an object mapping field name to type name, ..."
  did not include substring "from-field-name to to-field-name" (PipelineStepRoutesSpec.scala:968)
Tests: succeeded 54, failed 1
```

One failure, and it is 4.3 failing on the reintroduced wording. The negative assertion is bound to the
exact defect cycle 1 caught, not vacuous. File restored; `git status` clean for `backend/`.

**4. The 422 reaches the HTTP surface, for both kinds, with a non-trapping message.**
Shipped strings (read from source, not from a report):
- cast: `Invalid 'cast' config: 'casts' must be an object mapping field name to type name, e.g. {"casts": {"amount": "double"}} — got an array.`
- rename: `Invalid 'rename' config: 'renames' must be an object mapping from-field-name to to-field-name, e.g. {"renames": {"amount": "total_amount"}} — got an array.`

Both name the offending key and the expected shape. I checked the cycle-1 trap independently: `"double"`
is a genuinely supported cast target (`CastStep.castValue`, `case "double"`), so cast's example is valid
input; rename's message and example contain no type-name language at all, so no message can now guide a
caller into `{"renames":{"amount":"double"}}`. Tests 4.1/4.2/4.3/4.5 assert `StatusCodes.UnprocessableEntity`
on `responseAs[ErrorResponse].message` through the real route, plus a re-list showing no step was created
(or the stored config unchanged) — not a bare `Left`.

**5. Task 2.1a's negative is non-vacuous.** I read the test: it seeds with a raw
`sqlu"INSERT INTO pipeline_steps ..."` carrying the literal text `{"casts":[{"field":"amount","to":"double"}]}`,
then asserts `storedConfig shouldBe mistypedConfig` (a genuine pre-assertion via `sql"SELECT config ..."`)
before asserting `validationError shouldBe None`. The mistype is provably in the row when the analyze
call runs, so the negative is bound.

**6. Task 2.1's positive genuinely exercises the raw-config contract.** I traced the message to source:
`PipelineAnalyzeService.parseConfig` (line 638-651) emits `Some(s"$op config error")` only when
`fn(json)` throws, and `inferCast` does `json.fields("casts").convertTo[Map[String, String]]` — which can
only throw if the raw list-shaped `casts` survived un-round-tripped to `inferCast`. The test also
pre-asserts `CastConfig.decode(...).casts shouldBe empty`, pinning the premise. A well-shaped config
would produce `None`, so the assertion discriminates.

**7. AC3 / no migration regression.** `git diff main...HEAD -- backend/src/main` shows the `CastStep.scala`
and `RenameStep.scala` hunks are pure additions beginning after `writeToWire`; zero lines removed from or
inside `CastConfig.decode` / `RenameConfig.decode`. Test 4.6 raw-inserts a legacy list-shaped row and
asserts `GET /pipelines/:id/steps` still decodes it to an empty map.

**8. Every step write path is covered.** `grep` for step-repo writes in `src/main` returns exactly
`insertInternal:570` and `insertAtInternal:587`, both inside `addStep`; `updateStep` is the only config
mutation path; the patch-set apply path (`PatchSetApplyForward.scala:93`) and the bound-panel path
(`BoundPanelService.scala:188`) both route through `addStep`/`updateStep`, so all of them inherit the
check. No bypass.

**9. AC trace.**
| AC | Evidence |
|---|---|
| AC1 list-shaped `casts` → 422, no step | `PipelineStepRoutesSpec` 4.1 (route-level, asserts message + empty step list) |
| AC2 `rename` analogous shape rejected | 4.3, plus 4.2 for the non-string-value variant |
| AC3 correct config succeeds; stored rows unaffected | 4.4 (mapping retained, `{}` accepted) + 4.6 (legacy raw row) + byte-identical `decode` in the diff |
| AC4 (corrected) sweep by enumeration + classification + known-remaining + follow-up | design Decision 6 classifies all 23 decoders; I re-derived the counts myself: 24 `.scala` in `domain/steps/`, `grep -l "def decode(raw"` → 23. Follow-up **HEL-871** verified live in Linear (High, parent HEL-857, links HEL-860/859, names the `groupby` case). **One half outstanding — see Delivery obligation.** |
| AC5 tests assert the message names the expected shape | 4.1 (`object mapping field name to type name`), 4.3 (`from-field-name to to-field-name` **and** `not include "type name"`) |
| AC6 five HEL-859 validators + multi-failure join at the real analyze surface | `PipelineAnalyzeRoutesSpec`: aggregate/groupby/pivot/union/join each assert the offending value **and** the "Unsupported ..." phrasing; the join test (`window`, `lag`, `offset = -1`) asserts both problem strings and `";"` |
| AC7 raw-config contract on the proposal surface | `PipelineAnalyzeProposalRoutesSpec` — see item 6 above |

**10. Document audit against the final code.** Spec delta `pipeline-step-config-rejection`'s "each of
which SHALL be an object mapping string field names to string values" is still accurate for `rename`
after the message fix: it states the *type-level* rule (`Map[String, String]`), which is what the code
enforces, and asserts nothing about value semantics. Its scenarios only require the message to describe
the string-to-string shape, which both messages do. proposal.md makes no wording claim.
`pipeline-step-config-validation` is untouched by cycle 2 and consistent with the two analyze tests.

### Verdict: CONFIRM

The change ships. The behaviour is real, reaches the HTTP surface, is pinned by tests that I proved go
red for the right reason under two different mutations, and the read path is untouched.

### Delivery obligation (for the orchestrator, not the executor)

- AC4/task 5.1 requires the sweep's **exact command and raw unabridged output** to be recorded *in the
  PR*. design.md Decision 6 carries the classification of every hit but not the raw output, and nothing
  in the worktree does. The PR body must carry it, or AC4 is only half-signed. (Already flagged in
  evaluation-1 #4 and evaluation-2 #7; recording it here so it is not lost at squash time.)

### Non-blocking notes

1. `tasks.md` 5.1a contradicts itself: the bullet opens `[x] 5.1a DONE — filed as HEL-871` and then still
   carries the superseded paragraph `**NOT DONE — executor has no Linear MCP tool available…**`. HEL-871
   demonstrably exists, so the trailing paragraph is stale and false. One-line deletion at delivery.
2. design.md Decision 3 line 102 — "so the two call sites cannot drift" — is stale after CR-1: the
   *wording* is now deliberately per-kind and only the *format* is shared. Not a false behaviour claim,
   and the durable guard is correct (the `requireStringMap` scaladoc explains at length why the wording
   must differ, and the two parameters have no defaults so a third caller cannot inherit one), but the
   sentence would read as an invitation to re-DRY it. Suggest: "so the two call sites cannot drift on the
   message *format*; the wording is deliberately per-kind (see CR-1)".
3. `PipelineService.updateStep`'s new `if (rawConfigError.isDefined) … else` leaves the following
   `PipelineStepConfigCodec.decode(...)` block at its original indentation, so the `else` body is visually
   unattached. It compiles and both paths are covered by test 4.5, but it is easy to misread.
4. Adjacent, out of scope, already covered by HEL-871: `cast` still accepts any *string* target type —
   `CastStep.castValue`'s `case _ => str` silently passes an unknown type name through. Shape is now
   validated; value is not.
5. `PipelineService.duplicateStep` re-encodes from the typed decode, so duplicating a legacy mistyped row
   silently normalises it to `{"casts":{}}`. Pre-existing, unreachable for new rows after this change.
