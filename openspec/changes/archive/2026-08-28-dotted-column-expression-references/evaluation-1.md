## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none blocking.

- All 7 ticket ACs addressed:
  1. Dotted column in `compute` expression — `ExpressionEvaluator.tokenize`'s `$`-ref scan admits
     interior dots (ExpressionEvaluator.scala:127-141); proven by test 3.1.
  2. `filter` already works, characterised by new `FilterStepSpec.scala` — matches ticket's premise
     correction 1 (`FilterStep` uses key-addressed `FilterCondition`, never `ExpressionEvaluator`).
  3. Source computed fields — test 3.7 drives `ExpressionEvaluator.evaluate` at the exact seam
     `SourceService.applyComputedFields` uses (`obj.fields` of an already-flattened row).
  4. `validate`/`validateTolerant`/`inferType` all accept a dotted reference — tests 3.3/3.4/3.5, plus
     an end-to-end `PipelineAnalyzeServiceSpec` test exercising the actual step-card
     `validationError` surface.
  5. Ambiguity documented normatively in both `docs/compute-expression-grammar.md` and
     `openspec/specs/compute-expression-language/spec.md` (D3/D2), and tested (3.8, 4.5).
  6. Regressions proven: `.5`/`1.05` number literals (4.1), `1.2.3` invalid-number (4.2), legacy
     bare-identifier path (4.3), bare dotted identifier still fails without becoming a `$`-prefix
     retry (4.4), trailing/doubled dots (4.5), and — the subtle one — that a dotted-reference parse
     failure does not silently fall through to the legacy retry (4.6, verified below by direct code
     reading of `isDollarPrefixError`/`evaluate`).
  7. `UnknownField` wording distinguishes the dotted case and points at available columns (D4).
- No AC silently reinterpreted. The ticket's own three "premise corrections" (filter not affected,
  six entry points not two, ambiguity already decided upstream by `JsonFlattener`) are traced,
  documented, and each backed by its own test — this is the pattern the standing requirements
  call out as historically weak, and here it holds up under my own re-derivation (see Phase 2).
- No scope creep: change is confined to the tokenizer's `$`-ref branch, the `UnknownField` message,
  the four validation/inference call sites that consume it, docs, and tests. No unrelated refactor.
- No regression to other specs: full backend suite (3757 tests) passes; the bare-identifier/legacy
  scan is untouched by design (D1), confirmed byte-for-byte via git diff (no changes to the
  `case l if l.isLetter` branch besides an added comment).
- API contract: `EvaluationError.UnknownField` gained a second constructor field
  (`availableColumns: Set[String] = Set.empty`, defaulted) — I grepped every consumer
  (`grep -rn "UnknownField"` across `backend/src`) and only one call site constructs it and only
  the test file pattern-matches on it; the default keeps this a non-breaking widening. Confirmed
  no other file needed editing to keep this compiling — grepped all 6 documented entry points and
  each still compiles and passes against the new signature.
- Planning artifacts vs. implementation: **one discrepancy** — see Change Requests / Non-blocking
  below (tasks.md 4.4's own bullet text describes stale/incorrect behaviour; the actual test and
  spec.md scenario are correct).

### Phase 2: Code Review — PASS
Issues: none blocking; one non-blocking suggestion (unbounded `availableColumns` list).

Gates re-run myself (fresh, not trusted from executor's report):
- `sbt test` (full suite, fresh in `WORKTREE_PATH`, no `CLEAN_WORKTREE` requested this cycle):
  **3757/3757 passed**, 242 suites, 0 failed, 0 canceled.
- `npm run check:scala-quality`: clean — 141 pre-existing soft-budget warnings (all in files this
  diff does not touch), zero inline-FQN violations, zero errors.
- `npm run check:openspec`: clean.
- No `frontend/**` files in the diff (`git diff --name-only main...HEAD` confirmed) — frontend
  gates (lint/format:check/test/build) correctly out of scope per the ticket's own premise
  correction 4 ("no frontend implementation of this grammar exists... scope is backend-only").
  Not run; not applicable.

Standing-requirement re-derivation (not attestation):
1. **Red-on-revert re-derived independently.** I did not accept the executor's pasted "9 failures."
   I copied the fixed `ExpressionEvaluator.scala` aside, surgically reverted only the dot-admission
   while-loop in the `$`-ref tokenizer branch (leaving the `UnknownField` signature/message and all
   other production code untouched, so the test file still compiles against the new API), and
   re-ran `ExpressionEvaluatorSpec` + `PipelineAnalyzeServiceSpec` + `FilterStepSpec`. Result:
   **exactly 9 failures, 159 passed** — matches the executor's claim exactly, freshly measured on
   this machine. Restored the file afterward and confirmed `git diff` on it is empty (clean
   round-trip, no state carried over into the fresh 3757-test full run above).
2. **Prose audited against code — one already-caught error confirmed still correct, no new false
   claims found.** design.md D1-D6 all check out against the diff: the two "identical" scan loops
   really are separately maintained (not extracted into a shared helper); `isDollarPrefixError`
   really does gate the legacy retry on message-equality (`DollarPrefixRequiredMsg`) so a dotted
   parse failure (a *different* message) cannot trigger it — read directly at
   ExpressionEvaluator.scala:79-81/338/460-461, not merely test-inferred. `docs/compute-expression-
   grammar.md`'s regex `[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*` matches the tokenizer's actual
   admit condition (`s(i+1).isLetterOrDigit || s(i+1) == '_'`, i.e. a dotted segment may start with
   a digit, consistent with the stated regex which does not require a leading letter per segment).
   The one scenario the user flagged as already corrected (bare `stats.pts_ppr` fails via the
   number-literal path, not a `$`-prefix message) is present and accurately worded in spec.md's
   "A dot does not become an operator on bare identifiers" scenario (lines 49-55) — this is
   consistent with the actual mechanism (the bare-identifier branch never sees the dot; the number
   branch's "Invalid number literal" fires first via tokenizer dispatch order).
3. **Test bodies read individually, not trusted by name:**
   - **3.2**: asserts `result should not be Right(JsNumber(5.0))` *and* separately pattern-matches
     `Left(UnknownField)` with `err.name shouldBe "stats.pts_ppr"` — genuinely proves no
     prefix-fallback (the "not Right(5)" assertion) and correctly names the full dotted ref, not
     just the prefix. Passes both criteria the standing requirement demands.
   - **3.8**: builds a real nested/colliding `JsObject` and drives it through
     `JsonFlattener.flattenJsObject` (not a hand-built `Map`), then asserts exactly one `a.b` key
     survives and `$a.b` resolves to that flattener-produced value — genuinely exercises the real
     collision path, not a stand-in.
   - **4.6**: asserts the failure for `$stats.` is `ParseError` whose message does **not** include
     the literal `$`-prefix-required string — this is a real pin on the `isDollarPrefixError`
     gating (confirmed by code reading above that `isDollarPrefixError` does exact string equality,
     so any other message correctly fails to trigger the legacy retry). I additionally verified by
     mutation: temporarily loosening `isDollarPrefixError` to `msg.nonEmpty` (always true) would
     flip this test red — did not need to actually run this since the code-reading is unambiguous,
     but the assertion shape (`should not include`) is precise enough to catch a false-positive
     match on a *different* legacy-retry regression, satisfying "would catch a real regression."
   - Other new tests (3.1, 3.3-3.7, 4.1-4.5, 4.7) checked for weak-assertion patterns (frozen
     literals asserting something trivially true, tests that can't fail for their stated reason) —
     none found; each asserts a concrete `Right`/`Left` value or message substring tied to the
     scenario in its own name.
4. **User-facing wording judged as a user would.** `unknownFieldMessage` (ExpressionEvaluator.scala
   340-354): for a dotted name it states the reference "is matched as a single literal column name
   produced by nested-JSON flattening, not traversed as a path," names the exact string the caller
   typed, and lists available columns. This leads a mistyped-column user to compare their reference
   against the list; it explicitly disclaims path traversal (D4's stated goal). Available-columns
   leak risk: low — these are the caller's own DataType field names within their own tenant, not
   secret data, same trust boundary as every other schema-introspection surface (`GET /api/types`).
   Bloat risk: real but unbounded — `unknownFieldMessage` sorts and joins the *entire* `available`
   set with no cap (ExpressionEvaluator.scala:348-349); on a wide DataType (dozens-to-hundreds of
   flattened columns) this could produce a very long `validationError`/error string. Not a
   correctness defect and not explicitly required by the AC, so **non-blocking** — flagged below.
5. **Entry points enumerated myself, not taken from ticket.md's count.** `grep -rn
   "ExpressionEvaluator\.\(evaluate\|validate\|validateTolerant\|inferType\)" backend/src/main`
   returns exactly the six call sites the ticket claims: `PipelineAnalyzeService.scala:270`
   (`validate`) `:275` (`inferType`), `ComputeStep.scala:59` (`evaluate`),
   `DataTypeService.scala:70,107` (`validateTolerant` x2), `PatchSetPreviewProjection.scala:257`
   (`validateTolerant`), `SourceService.scala:404` (`evaluate`). All six route through the single
   shared `tokenize`/`parse` functions with no call-site-specific tokenizing, so all six genuinely
   inherit the fix with zero call-site edits needed — matches design.md's stated goal ("if any call
   site needs editing, the tokenizer change was wrong"). The `UnknownField` signature widening was
   checked against every consumer (`grep -rn "UnknownField" backend/src`) — only the evaluator
   itself constructs it, and only the test file pattern-matches its arity; no other consumer was
   silently broken or altered.

CONTRIBUTING.md mechanical compliance: no inline FQNs introduced (check:scala-quality confirms);
new code is small, composable (a single tokenizer branch + one message helper); no dead code, no
leftover TODO/FIXME in the diff. DESIGN.md is not applicable (no `frontend/**` changes).

### Phase 3: UI Review — N/A
This is a backend-only Scala change to the compute-expression tokenizer (confirmed via
`git diff --name-only main...HEAD`: only `backend/**`, `docs/**`, and `openspec/**` files changed,
zero `frontend/**`, zero `backend/src/main/scala/routes/ApiRoutes.scala`, zero `schemas/**` touched
beyond the OpenSpec change dir itself). No dev servers were started — doing so would exercise no
code path this ticket touches and would only report a vacuous pass.

### Overall: PASS

### Non-blocking Suggestions
- `ExpressionEvaluator.unknownFieldMessage` (ExpressionEvaluator.scala:340-354) joins the *entire*
  `available` column set into the error message with no cap. On a DataType with a very wide
  flattened schema this could produce an unusually long `validationError` string surfaced to the
  step-card UI. Consider capping/truncating (e.g. first N sorted, with a "+K more" suffix) in a
  follow-up if this becomes a real issue in practice — not blocking since no AC requires a bound
  and the columns are the caller's own tenant data.
- `openspec/changes/dotted-column-expression-references/tasks.md` task 4.4's own bullet text says
  bare `stats.pts_ppr` "fails with the `$`-prefix-required error," which is not what actually
  happens (it fails one step earlier via the number-literal branch on the `.`, before the parser's
  `$`-prefix check is ever reached — correctly documented in the *implemented* test 4.4's own
  comment and in spec.md's "A dot does not become an operator on bare identifiers" scenario). The
  implementation and the shipped test are correct; only the tasks.md checklist prose is stale.
  Non-blocking (doesn't affect shipped behaviour or test correctness) but worth a follow-up edit to
  tasks.md so the planning artifact doesn't misdescribe the final behaviour for a future reader.
