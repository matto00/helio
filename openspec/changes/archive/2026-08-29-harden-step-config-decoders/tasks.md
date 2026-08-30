# Tasks — HEL-814

## 1. Enumeration (do this first; it is an acceptance criterion in its own right)

- [x] 1.1 Walk all 23 step-kind files (the directory also holds `README.md` and `StepCodecUtil.scala`) in `backend/src/main/scala/com/helio/domain/steps/` and produce a per-field table:
      step kind, field, how it is read, current default, JSON type expected, and requiredness
      (`required` / `optional-with-legitimate-default`). Verify in BOTH directions: no step file omitted, none
      wrongly included. Record the table in the change directory as `enumeration.md`.
- [x] 1.2 Classify each field's tolerance mechanism: (1) item-level `flatMap`+`Try.toOption` drop,
      (2) `collect{JsString}` / `stringOr` array+scalar default, (3) enum/numeric coercion with no validation,
      (4) `asObject` non-object fallback. Name any further mechanism found.
- [x] 1.2b **Bind the requiredness column to the shipped specs — THE structural fix, and the actual guarantee
      for this whole class (design gate rounds 6-7).** For EVERY field the 1.1 table marks `required`, add two
      columns to `enumeration.md`: **spec citation** (the `openspec/specs/pipeline-*-op/spec.md` file and line
      whose REQUIREMENT TEXT you read) and **conclusion** (does that spec bless the field's absent or empty
      value?). A field with no governing spec statement records `no governing statement` plus the file you
      checked. A tick-box saying "I checked the specs" is satisfiable vacuously; a column of citations is not —
      record it per field or the check has not happened.

      If a spec DOES bless the empty/absent value, either mark the field optional-with-legitimate-default, or
      include a MODIFIED delta for that capability in THIS change. Do not decide this by grepping for tolerance
      vocabulary: three different vocabularies have already been needed (`defaults to`/`falls back`; `no-op`/
      `SHALL return all`; `empty ... map/array/list`), and each new pattern found guarantees the previous one
      missed. Start from the field and go find its spec, not from a pattern and hope it matches.

      **Pre-settled by design.md D8 — do NOT re-decide these seven, all optional-with-legitimate-default:**
      `limit.count` (`pipeline-limit-op:9`), `sort.sortBy` (`pipeline-sort-op:10`), `cast.casts`
      (`pipeline-cast-op:35`), `rename.renames` (`pipeline-rename-op:25`), `filter.conditions`
      (`pipeline-filter-op:11`), `select.fields` (`pipeline-select-op:24`), `dedupe.keys`
      (`pipeline-dedupe-op:9`, plus UI requirement `:52` and scenario `:59`). Each is the sole or principal config
      of its step kind, so the natural heuristic ("the step does nothing without it") marks them required and is
      WRONG for all seven. For `select.fields` and `dedupe.keys` the empty case is behaviour-DEFINING (empty rows;
      whole-row distinct) rather than a no-op, so marking those required silently changes an algorithm. Treat that heuristic as a red flag prompting a spec check, not as an answer.
- [x] 1.3 Have the requiredness column reviewed as data before any code changes. Any field where
      "required vs optional-with-legitimate-default" is genuinely ambiguous is an ESCALATION, not a judgement
      call to make silently.

## 2. Read path — raise on wrong JSON type only (D1)

- [x] 2.1 Add strict typed extractors to `StepCodecUtil` that raise on a present-but-wrong-type key and preserve
      today's default for an absent key. Cover: scalar type mismatch, non-array for an array key, wrong element
      type within an array, non-object for an object key.
- [x] 2.2 Convert each of the 23 decoders to the strict extractors, field by field, per the 1.1 table.
- [x] 2.3 Make a mismatched array element fail the whole configuration rather than being dropped
      (`AggregateStep`, `SortStep`, `FilterStep`, `WindowStep.orderBy`).
- [x] 2.4 Decide `StepCodecUtil.asObject`'s non-object fallback (a stored top-level scalar such as `"42"`
      currently becomes an all-defaults config) — covered by D1 or deliberately exempted, with the reason stated.
      `AssertStepSpec.scala:55-58` (`AssertConfig.decode("42") shouldBe AssertConfig(Vector.empty)`) is the test
      this decision moves or preserves; name it either way rather than discovering it during execution.
- [x] 2.5 GUARD: assert an absent key and an empty-but-correctly-typed key still decode to their defaults.
      Include the `unpivot` `varName shouldBe "variable"` absence-default assertion displaced from 6.1.
- [x] 2.6 Update `PipelineStepRoutesSpec.scala:1019-1035` to its new expected behavior. It raw-inserts a legacy
      row `{"casts":[{"field":"amount","to":"double"}]}` and asserts `GET /pipelines/:id/steps` returns 200 with an
      empty cast map, under a comment stating the read path is untouched. D1 deliberately reverses that for
      wrong-**type** stored rows. PROOF that D1 took effect — not incidental churn. Rewrite the comment to record
      that HEL-860's read-tolerance guarantee is knowingly narrowed here, and why (0 of 233 measured rows carry a
      wrong-type config; absence, which has 20 real rows, stays tolerant).
- [x] 2.6b Update `AssertStepSpec.scala:48-53` (`{"rules":["not-an-object",42,null]}` currently asserts 3
      all-default rules) and `:70-73` (`params: "not-an-object"` currently asserts `JsObject.empty`) to expect a
      raise. PROOF. Both follow from the `pipeline-assert-op` delta, which narrows that capability's
      "decode SHALL NOT throw for any input" guarantee to absence and open `params` CONTENTS only.
- [x] 2.7 Update `PipelineAnalyzeProposalRoutesSpec.scala:429-434`, which asserts `CastConfig.decode(...).casts
      shouldBe empty` for a wrong-type raw config. Under D1 that decode raises. Re-point the assertion at the raise.
      PROOF.

## 3. Write path — extend and wire `validateRawConfig` (D2, D0)

- [x] 3.1 Implement `validateRawConfig` for all 23 step kinds, rejecting wrong-**type** values only, each message
      naming the offending key and its expected shape. Follow `CastStep`/`RenameStep`'s existing wording
      discipline: the shape description is per-key and must not be a shared generic string.
- [x] 3.2 Wire the hook into `PatchSetApplyResolvers.validateEmbeddedStepReferences:223`, before the existing
      decode and referential checks. Pin which `ServiceError` the preview surface returns for a rejection: the
      rejection spec says 422 for create/update, while this function currently emits `BadRequest` (400) for a
      decode failure. Decide and state it, so 7.2 can assert a status rather than just a `Left`.
- [x] 3.3 Wire the hook into `PipelineProposalService.validateStep:179`.
- [x] 3.4 Confirm `PipelineService.addStep:466` / `updateStep:642` remain wired and unchanged — do not duplicate.
- [x] 3.5 GUARD: a config with an empty required value is still accepted on write (drafts stay savable).

## 4. Run and analyze time — reject missing/empty required values (D3)

- [x] 4.1 Add a single per-step declaration of required fields. Requiredness can be **conditional on another
      config value**, and at least one field is: `window.field` is required by `running_sum`/`lag`/`lead` and
      ignored by the rank family (`pipeline-window-op:14-15`, with the named scenario "Running_sum without a
      field fails with a descriptive error" at `:49-50`). The predicate is evaluated against the whole raw config
      string, so it CAN express this — make sure the declaration's shape allows a condition rather than being a
      flat required-field list, or `window` will be wrong in one direction or the other.
      **A second, harder case: `assert.rules[].field`** — required for `notNull`/`unique`/`range`/`regex` and
      NOT for `rowCountMin`/`rowCountMax` (`pipeline-assert-op:46-50` and `:71-74`). The condition keys off a
      SIBLING field (`kind`) within a nested rule ELEMENT, not a top-level config value. A predicate built to
      read only top-level keys satisfies this task's letter and still gets `assert` wrong — so the declaration
      must support element-level conditions too.
      Then: both the run-time and analyze-time checks derive
      from it so the two surfaces cannot disagree. Evaluate the predicate against the **raw config string** (which
      is what `validateStepConfig(kind, rawConfig)` already holds on the analyze side), with the run path obtaining
      it via `Companion.encodeConfig`. Stating the representation is what makes "cannot disagree" structural
      rather than aspirational.
- [x] 4.2 Fail the run with an error naming the failing step and the missing field, following HEL-859's shape.
- [x] 4.3 Report the same condition at analyze time through the existing `validationError` field, with
      `outputSchema` falling back to `inputSchema`, combining with any other failure on that step.

## 5. Enum and numeric coercion (D4)

- [x] 5.1 Case-normalize then reject unknown values for `filter.combinator`, `dedupe.keep`, `splittext.mode`,
      `chunkbytokencount.encoding`, deriving the supported set from the engine's own set, never a copy.
      **LAYER (settled in D4, do not re-decide):** `decode` case-normalizes and REMAINS TOLERANT of an
      unknown-but-correctly-typed enum value; the REJECTION lives at analyze and run, next to D3. Rejecting at
      decode would 500 a stored row on listing via `rowToDomain`, over a population the 233-row measurement never
      covered. A wrong-TYPE enum value (e.g. `combinator: 5`) is already handled by D1/D2 and is not this task.
- [x] 5.1b Decode stops coercing: it normalizes a case-variant to the canonical member and passes an unknown
      value through UNCHANGED (never substituting a different member). Update the two tests to their new expected
      values: `ChunkByTokenCountStepSpec.scala:145-149` expects `encoding == "not-a-real-encoding"` (was
      `"o200k_base"`); `PipelineStepConfigCodecSpec.scala:262-265` expects `keep == "bogus"` (was `"first"`).
      GUARDS on the read path. If decode kept coercing, the wrong value would be gone before analyze or run could
      see it and 5.1's rejection would be unimplementable — that is why this is pinned rather than left open.
- [x] 5.2 Reject a non-representable `limit.count` instead of narrowing it to `0`. Note `LimitConfig.decode`
      (`LimitStep.scala:19-25`) returns `0` for BOTH a wrong-TYPE `count` and a correctly-typed non-representable
      one; D1 covers the first at decode, D4 the second at analyze/run. Make the split explicit in the 1.1 table
      so neither is missed.
- [x] 5.3 Sweep the 1.2 table for any other coercing enum found during enumeration and treat it the same way.

## 6. Characterization tests (D5) — do not soften

- [x] 6.1 Invert `pivot`, `unpivot`, `window` decode-level tests to expect a raise. PROOF. Note: the inverted
      `unpivot` test can no longer assert `varName shouldBe "variable"`, because the `valueVars` decode now raises
      first — move that absence-default assertion into the 2.5 GUARD so the coverage is not lost.
- [x] 6.2 Keep `PatchSetPreviewServiceSpec`'s preview test's `Right` expectation and rewrite its
      CHARACTERIZATION-TEST WARNING comment to state that HEL-814 deliberately preserves preview acceptance of an
      absence-only draft (D2 rejects wrong-TYPE only; completeness is enforced at run/analyze by D3), and that
      wrong-type rejection at preview is proven instead by 7.2 below. GUARD. Do not invert it — absence-rejection
      would contradict the approved D2 and the rejection spec, and faking the flip is worse than not having it.
- [x] 6.3 Keep the `join` decode test's `joinKey shouldBe ""` assertion and rewrite its comment to label it a
      deliberate read-tolerance guard per D1. GUARD. Do not delete, weaken, or contrive a flip.

## 7. New tests

- [x] 7.1 PROOF, shown red first: preview rejects a wrong-shape config for each affected step kind.
- [x] 7.2 PROOF, shown red first: preview rejects a `join` edit whose `joinKey` is PRESENT but of the wrong JSON
      type (e.g. `{"rightDataSourceId":"...","joinKey":123}`), asserting a specific status, not merely a `Left`.
      Site it in `PatchSetPreviewServiceSpec` directly next to the 6.2 guard so the proof/guard pair is legible in
      one place. This is the test that actually closes the gap the original preview characterization test exposed.
      Assert the **422 from D2's `validateRawConfig`** and a message naming `joinKey` — NOT merely a `Left`. The
      same config is also caught by D1's decode raise (a 400), so an assertion that accepts any `Left` would still
      pass with 3.2's wiring omitted entirely, making it vacuous as proof of this ticket's actual defect.
- [x] 7.2b PROOF, shown red first: proposal apply rejects a wrong-shape config.
- [x] 7.3 PROOF, shown red first: run and analyze reject a missing/empty required value, naming step and field.
- [x] 7.4 PROOF, shown red first: `filter.combinator: "XOR"` rejected; `dedupe.keep: "LAST"` accepted AND keeps
      the last row; `limit.count` non-representable rejected rather than treated as unlimited. Assert against
      BOTH surfaces explicitly — analyze AND run. `PipelineRunService` does not gate on analyze, so an
      analyze-only implementation would leave `combinator: "XOR"` silently ANDing on every scheduled run, which
      is the defect rather than the fix. Name the surface each assertion targets.
- [x] 7.4b Confirm rather than rediscover: `PipelineAnalyzeService.validateStepConfig:110-119` wraps its dispatch
      in `catch { case _: Exception => Vector.empty }`. Under D1 a wrong-type stored config raises inside a
      validator and is swallowed there, falling through to the downstream "<op> config error" path. That matches
      the validation delta's "stored-pipeline analyze surface cannot report such a key" scenario, so it is
      consistent — verify it holds rather than assuming it.
- [x] 7.5 GUARD: the 20 real draft shapes measured in dev and prod still save and still list.
- [x] 7.6 Every assertion checks decoded contents or an observable status and message — never "did not throw".

## 8. Verification and delivery

- [x] 8.1 Record the red-before evidence for every test labelled PROOF, and the mutation used to demonstrate each
      GUARD is failable.
- [x] 8.2 `sbt test` green; backend gates pass. A green root `npm test` inside the worktree is NOT evidence
      (HEL-880) — do not cite it.
- [x] 8.3 Do not run `concertino sync`; do not commit rendered agent/script changes.
- [x] 8.4 PR states: HEL-860's contract was followed over the ticket's original framing and why; which assertions
      are proof and which are guards; that **3 of 5** characterization tests flip and **2 are relabelled as
      guards**; and explicitly WHY the preview test does not flip (absence is deliberately tolerated on write;
      completeness is enforced at run/analyze by D3) so the count does not read as a shortfall.
- [x] 8.5 PR notes the residual risk: under D1, a wrong-type row created between measurement and deploy would
      become a 500 on listing via `rowToDomain`'s `IllegalStateException`. Say it out loud rather than leaving it
      only in design.md.
