## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit e75cc325, branch `task/harden-step-config-decoders/HEL-814`.
Backend-only change; Phase 3 (UI) is N/A — no `frontend/**`, `ApiRoutes.scala`,
`schemas/**` or `openspec/specs/**` file is touched (the spec deltas live under
`openspec/changes/`).

### Phase 1: Spec Review — PASS

Issues: none blocking.

**1. Characterization tests — exactly 3 of 5 flip, no contrivance.** Verified by
reading the full diff of both spec files.

| Test | Outcome | Verified |
| --- | --- | --- |
| `pivot` non-array `index` | flipped to `intercept[StepConfigTypeMismatch]`, asserts key + expected shape + `got a string` | PROOF |
| `unpivot` bare-string `valueVars` | flipped, asserts key + `got a string` | PROOF |
| `window` non-array `partitionBy` + bare-string `orderBy` element | flipped, both halves asserted separately with distinct messages | PROOF |
| `RefinementEditShapeSpec` join `joinKey shouldBe ""` | **kept verbatim**, renamed `GUARD:`, comment explains absence-vs-wrong-type, the `rowToDomain` 500, the 20 measured draft rows, and names the replacement proof and a failing mutation | GUARD |
| `PatchSetPreviewServiceSpec` preview `Right` | **kept verbatim**, renamed `GUARD:`, same explanation, original HEL-671 note retained "for provenance" | GUARD |

No 4th/5th flip was contrived, no assertion weakened, no test deleted, and
absence was not made to raise to improve the count. The `varName shouldBe
"variable"` assertion displaced by the `unpivot` flip was **not lost** — it is
re-sited immediately below as the task-2.5 guard, exactly as task 6.1 required.
Both relabelling comments state WHY at length and explicitly pre-empt the "the
hardening was reverted" misreading, including the counter-intuitive fact that
HEL-671's own prediction ("THIS TEST SHOULD FAIL") did not come true and why.

**2. D8 trap list — all seven correctly optional, verified in the implementation,
not just in `enumeration.md`.**

| Field | Implementation evidence |
| --- | --- |
| `limit.count` | `LimitStep.scala:97` — problems only for a `JsNumber` failing `toIntExact`; `{"count":0}`, `-1`, absent all return `Vector.empty` (asserted by a dedicated guard test) |
| `sort.sortBy` | `SortStep` has **no** `requiredConfigProblems` override |
| `cast.casts` | no override |
| `rename.renames` | no override |
| `filter.conditions` | `FilterStep.scala:159` declares only the `combinator` enum; `conditions` untouched |
| `select.fields` | no override |
| `dedupe.keys` | `DedupeStep.scala:132` declares only the `keep` enum, with an in-code comment citing `pipeline-dedupe-op:9` / `:52` for whole-row distinct |

The two behaviour-defining cases (`select.fields` → empty rows, `dedupe.keys` →
whole-row distinct) are therefore not silently re-algorithmed.

**3. Task 1.2b — real, non-vacuous compliance.** `enumeration.md` carries a
per-field **spec citation** and **conclusion** column for all 23 kinds, plus a
restated checklist of all 11 `required` fields. I opened the cited file and line
for **nine** citations; every one exists and says what the table claims:

- `pipeline-chunk-by-token-count-op:10-14` — declares `targetTokenCount`/`encoding`/`indexField`/`tokenCountField` each with an explicit default and `field` with none. ✅
- `pipeline-select-op:24-26` — named scenario "Select with empty fields list produces empty rows", "each output row is an empty map (`{}`)". ✅
- `pipeline-dedupe-op:9` — "When `keys` is empty, rows are compared as whole rows". ✅
- `pipeline-dedupe-op:52` — "Leaving the key multi-select empty SHALL be a valid configuration (whole-row distinct)". ✅
- `pipeline-window-op:14-15` — `outputColumn` declared as bare `string` between `field: Option[String]` and `offset: Option[Int] ... defaulting to 1 when absent`; the contrast the table claims is exactly there. ✅
- `pipeline-string-ops-op:11-12` — `outputColumn` "destination column name — if equal to `field`, the op overwrites the source column in place". ✅
- `pipeline-lookup-op:8-11` — `sourceKey`/`lookupKey` declared with no default and no optional qualifier. ✅
- `pipeline-limit-op:9` — "When `count` is missing, zero, or negative, the engine SHALL return all rows (safe no-op)". ✅
- `pipeline-sort-op:10` — "An empty `sortBy` array SHALL be treated as a no-op". ✅

Both directions of the 1.1 completeness check hold: 23 `*Step.scala` files
(24 minus `StepCodecUtil.scala`) and 23 `###` kind sections in `enumeration.md`.

**Eighth-trap hunt.** I ran two further grep vocabularies over the nine specs
governing `required` fields (`in place|overwrit|pass-through|permitted|tolerat|
treated as|SHALL NOT fail|is not an error|zero output|identity`, plus the usual
`empty|absent|missing|no-op|omitted|blank|defaults to|valid configuration`). One
genuine candidate surfaced and it is **already handled**:
`pipeline-chunk-by-token-count-op:12-13` shipped an explicit tolerance
guarantee ("falls back to `"o200k_base"` for any other value") with a named
scenario at `:49-51` asserting the step "decodes with `encoding` treated as
`"o200k_base"` rather than failing" — which task 5.3 reverses. The change carries
a MODIFIED delta for that capability that rewrites the requirement text and keeps
the scenario **name** (openspec constraint) with an explicit inline note that the
body now asserts the opposite. `pipeline-dedupe-op` has the equivalent delta for
`keep`. I found **no eighth trap field**: no `required` field's spec blesses its
empty/absent value without a delta in this change. Two genuinely close calls
(`unpivot.valueVars`, `groupby.aggColumn`) are recorded under task 1.3 and
resolved conservatively toward preserving shipped behaviour.

**4. Proof vs guard labelling.** Every new/changed assertion checks decoded
CONTENTS or an observable status + message. I found **zero** `noException should
be thrownBy` survivors in the changed tests — the two that existed in
`AssertStepSpec` were both replaced by `intercept[...]` + message assertions.
Mutation-verified two proof clusters myself (mutation applied, test run, source
restored, worktree confirmed clean):

- Stubbing `PatchSetApplyResolvers`'s `validateRawConfig` lookup to `None` → the three `PatchSetPreviewServiceSpec` PROOF tests fail (3 failed / 27 passed). This is the load-bearing result: decode still raises for those configs and would still yield a `Left(BadRequest)`, so a loose `Left` assertion would have stayed green. The 422 pin makes them genuine proof of the wiring.
- Stubbing `InProcessPipelineEngine.requiredConfigProblems` to `Vector.empty` → 8 `PipelineStepRequiredConfigSpec` tests fail, covering both the D3 required-value proofs and the D4 run-surface enum proofs.

**5. Three write surfaces.** `validateRawConfig` is now wired into
`PatchSetApplyResolvers.validateEmbeddedStepReferences` (before decode and the
referential check, returning `ServiceError.UnprocessableEntity`) and
`PipelineProposalService.validateStep` (same status). `PipelineService` retains
its two pre-existing call sites at `:494` (addStep) and `:670` (updateStep),
unchanged and **not duplicated**. The default `Companion.validateRawConfig` now
derives from the kind's own strict decoder (`strictDecodeProblem`), so write and
read strictness cannot diverge; `CastStep`/`RenameStep`'s bespoke HEL-860 wording
is preserved and chained via `.orElse(strictDecodeProblem(raw))`. Task 7.2 is
satisfied in the strict sense demanded: the status is pinned to
`UnprocessableEntity`, the message asserted to name `joinKey` / `must be a
string` / `got a number`, and the `case Left(other)` arm fails with a message
explaining that a `BadRequest` there means the wiring is absent.

**6. Read-path safety.** `StepCodecUtil.present` treats an absent key **and**
`JsNull` at a key position as absence; every strict extractor returns its default
for `None`. Empty-but-correctly-typed values (`[]`, `{}`, `""`) pass through.
Guards exist at three levels: decode (`AssertStepSpec`, `RefinementEditShapeSpec`
unpivot), preview/write (`PatchSetPreviewServiceSpec` accepts the real dev/prod
compute and lookup draft shapes), and HTTP listing (`PipelineStepRoutesSpec` new
test raw-inserts `'{}'` and asserts `GET /pipelines/:id/steps` → 200). The
`rowToDomain` → 500 hazard is therefore covered by an end-to-end guard, not only
by unit tests.

Other Phase 1 checks: all tasks marked done match what was implemented; no scope
creep (`git diff --name-only main...HEAD` contains only `backend/**` and
`openspec/changes/harden-step-config-decoders/**` — no rendered agent/script
files, satisfying 8.3); the four contradicted shipped specs (`assert`, `dedupe`,
`chunk-by-token-count`, `compute`) each carry a MODIFIED delta, plus three new
capability deltas; planning artifacts match the final behaviour.

### Phase 2: Code Review — PASS

**Gates, re-run by me in `WORKTREE_PATH` (fresh evidence, not the executor's report):**

- `cd backend && sbt test` → `Tests: succeeded 3821, failed 0, canceled 0, ignored 0, pending 0` / `All tests passed` / `[success] Total time: 202 s`.
- `node scripts/check-scala-quality.mjs` → `clean (144 soft warning(s))` — all warnings are pre-existing file-size soft budgets on unrelated files.
- `node scripts/check-openspec-hygiene.mjs` → `openspec/ is clean`.
- `node scripts/check-spec-structure.mjs` → `347 canonical specs, 0 issues`.

Per the orchestrator's instruction and HEL-880, no frontend gate is cited — no
`frontend/**` file changed.

Code quality: the strict extractors are a single well-documented utility reused
by all 23 decoders (DRY); the D3 declaration is one `requiredConfigProblems`
method evaluated by both the run path (via `encodeConfig(step.configValue)`) and
the analyze path over the same raw-string representation, so "the two surfaces
cannot disagree" is structural rather than aspirational; error messages are
per-key and specific, never a shared generic string; no `Any` escape hatches
beyond the pre-existing type-erased `configValue`/`decodeConfig` SPI; no dead
code, no TODO/FIXME added; the new `configValue` member is the minimum needed
to keep the run-path check inside `com.helio.domain`. Behaviour changes are all
attributable to an approved design decision and are each cited in-code.

Issues: none blocking. See Non-blocking Suggestions.

### Phase 3: UI Review — N/A

No UI-affecting file changed.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

1. **Indentation of the two newly-nested blocks.**
   `PatchSetApplyResolvers.scala:241-263` and
   `PipelineAnalyzeService.scala:135-152` wrap an existing block in a new
   `match`/`if-else` without re-indenting the wrapped body, so the `case None =>`
   / `else` arm's contents sit at the outer level. It compiles and the quality
   gate is clean, but it reads as if the block were unnested. Worth a
   whitespace-only follow-up pass.
2. **Inline `scala.util.Try` qualifiers.** `StepCodecUtil.scala` (3),
   `LimitStep.scala` (3), `PipelineStep.scala` (3), `CastStep.scala` /
   `RenameStep.scala` (2 each) use `scala.util.Try(...)` inline rather than a
   top-of-file import. `CONTRIBUTING.md:70` says never inline an FQN when an
   import would do. This is **not** a gate failure — `check-scala-quality.mjs`
   only enforces the `com.helio` / `spray.json` / `java.util.UUID` /
   `org.apache.pekko` prefixes — and the pattern already exists on `main`
   (`AclDirective.scala` has 13). Flagged for consistency only.
3. **`limit.count` run-surface gap is real, disclosed, and worth the skeptic's
   attention.** Task 7.4 asked for both surfaces; for `limit.count` only the
   ANALYZE surface is covered, because `LimitConfig.decode` narrows a
   non-representable count to `0` before the run path's
   `encodeConfig(configValue)` round-trip can see it. The executor did not hide
   this: there is a dedicated test named "the RUN surface is knowingly NOT
   covered for this one value" that asserts the gap, and `LimitStep.scala:90-96`
   states it in-code and cites `pipeline-step-config-validation`'s scenario
   wording ("**WHEN** the pipeline is analyzed") as the shipped requirement it
   satisfies. The other four enum cases (`filter.combinator`, `dedupe.keep`,
   `chunkbytokencount.encoding`, `splittext.mode`) ARE proven on both surfaces.
   Residual: an unrepresentable `count` on a scheduled run that is never
   analyzed still behaves as unlimited. Honest disclosure + spec conformance, so
   not a change request — but it is the one place the shipped behaviour falls
   short of D4's stated ambition.
4. **PR body obligations (8.4/8.5) are still owed at delivery time**: the
   HEL-860-contract-over-ticket-framing rationale, the 3-flips/2-guards count
   with the reason the preview test does not flip, and the residual risk that a
   wrong-type row created between measurement and deploy becomes a 500 on
   listing via `rowToDomain`. All the material exists in `design.md` and in the
   test comments; it just needs to reach the PR.
