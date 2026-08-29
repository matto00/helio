## 1. Tokenizer

- [x] 1.1 In `ExpressionEvaluator.tokenize`'s `case '$'` branch, extend the reference scan to accept interior
      dots per design D1/D2: consume `[A-Za-z0-9_]` runs joined by single dots, accepting a `.` only when the
      following character is an identifier character. Leave the bare-identifier branch (:144-151) and the
      number branch (:135-142) byte-for-byte unchanged.
- [x] 1.2 Add a code comment at BOTH scan sites recording design D1 — why the `$` scan and the bare-identifier
      scan are deliberately not shared, and that widening the bare scan would move the frozen legacy grammar.

## 2. Reference-resolution error wording (design D4)

- [x] 2.1 Make the unresolved-reference error distinguish a dotted reference: state that the reference is matched
      as one whole literal column name produced by nested-JSON flattening, not traversed as a path, and surface
      the available column names. Do not imply traversal was attempted.
- [x] 2.2 Verify the wording end-to-end on the surface a user actually reads — the analyze/step-card
      `validationError` (PipelineAnalyzeService.scala:270) — not only at the evaluator's return value.

## 3. Tests — new capability

- [x] 3.1 `evaluate`: `$stats.pts_ppr * 2` over `{"stats.pts_ppr": 12}` returns `24`.
- [x] 3.2 `evaluate`: `$stats.pts_ppr` over `{"stats": 5}` returns an unknown-field error naming
      `stats.pts_ppr` — asserting it does NOT fall back to the prefix column and does not return `5`.
- [x] 3.3 `validate` (strict) accepts `$stats.pts_ppr + 1` against field names `["stats.pts_ppr"]`.
- [x] 3.4 `inferType` returns `"number"` for `$stats.pts_ppr * 2` against `{"stats.pts_ppr": "number"}`.
- [x] 3.5 `validateTolerant` accepts `$stats.pts_ppr` against `["stats.pts_ppr"]`.
- [x] 3.6 Multi-segment: `$a.b.c` resolves against a row keyed `a.b.c`.
- [x] 3.7 Source computed fields: `SourceService.applyComputedFields` (or its narrowest testable seam) computes
      `$stats.pts_ppr * 2` to `24` over a flattened row and reports no eval error.
- [x] 3.8 Collision case, driven through the real flattener rather than a hand-built row: flatten
      `{"a.b": 1, "a": {"b": 2}}`, assert exactly one `a.b` column, then assert `$a.b` evaluates to that single
      deduplicated value. This is the ticket's ambiguity criterion — it must exercise `JsonFlattener`, not a
      literal `Map("a.b" -> ...)`, or it proves nothing about the interaction.

## 4. Tests — regression, proving what must NOT change

- [x] 4.1 `.5` and `1.05` still lex as number literals; `$amount * .5` over `{"amount": 100}` returns `50`.
- [x] 4.2 `1.2.3` still fails with `Invalid number literal: 1.2.3`.
- [x] 4.3 Legacy bare-identifier `price * quantity` still evaluates to `6` over `{"price":2,"quantity":3}`.
- [x] 4.4 Bare `stats.pts_ppr` (no `$`) still fails to parse — in fact via the number-literal branch on the `.`, one step before the parser's `$`-prefix check is reached. A dot must not have
      become an operator, and the legacy parser must not have gained dotted refs.
- [x] 4.5 `$stats.` and `$a..b` are parse errors (design D2).
- [x] 4.6 A dotted-reference parse failure does NOT trigger the legacy fallback — assert `isDollarPrefixError`
      gating still holds, so only the `$`-prefix-required message retries (design D1 risk row).
- [x] 4.7 Filter characterisation test: a `FilterStep` condition on field `stats.pts_ppr` retains only the
      matching row. Names the test as characterising already-shipped behaviour, not new behaviour.

## 5. Documentation (normative, both files)

- [x] 5.1 `docs/compute-expression-grammar.md`: update the identifier rule at :22-26 to the dotted form, and add
      the exact-match / no-traversal / no-prefix-fallback resolution rule with the reason it is unambiguous
      (flattening already deduplicated the collision). Fix the stale evaluator path at :3 while in the file.
- [x] 5.2 Confirm the shipped `openspec/specs/compute-expression-language/spec.md` delta matches the implemented
      behaviour exactly — including the trailing-dot and no-prefix-fallback scenarios.

## 6. Verification

- [x] 6.1 Confirm `backend/` compiles and `sbt "testOnly com.helio.domain.engine.ExpressionEvaluatorSpec"` passes,
      then the full `sbt test`.
- [x] 6.2 Capture red-on-revert evidence by BEHAVIOURAL mutation, not compile-error revert: restore the original
      one-line scan condition in the `$` branch and record the specific failures. A revert that fails to compile
      proves only that the tests reference a new API. Recapture if any test changes afterwards; do not recapture
      for comment- or name-only edits.
- [x] 6.3 Before trusting any frontend gate: confirm `node_modules` exists in the worktree, and confirm
      `jest --listTests` returns a NON-EMPTY set from inside the worktree (HEL-880: the root jest config's
      unanchored `/.claude/worktrees/` ignore pattern makes a green root-jest line meaningless here).
- [x] 6.4 Write `files-modified.md` with exactly one full backtick-quoted path per `^-` bullet.
