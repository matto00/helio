## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Diff scope**: `git diff main...HEAD --stat` on commit `124ef2ad` — backend-only
  (`ExpressionEvaluator.scala`, 3 spec files, `docs/compute-expression-grammar.md`,
  openspec artifacts). Zero files under `frontend/`. Confirms the ticket's own framing
  that no UI verification applies here.

- **Full source diff of `ExpressionEvaluator.scala`** read directly (not summarized).
  Confirmed the `$`-ref scan's dot-consuming `while` loop, the untouched bare-identifier
  scan, the new `unknownFieldMessage` helper, and the `UnknownField` default-parameter
  change.

- **`UnknownField(name, availableColumns = Set.empty)` call-site enumeration** —
  `grep -rn "UnknownField(" backend/src/main/scala backend/src/test` found exactly one
  other reference besides the definition: a test at
  `ExpressionEvaluatorSpec.scala:320` using a wildcard-matched case class pattern
  (`UnknownField("missing_field", _)`), which is unaffected by the new default. There is
  no production call site silently keeping the default empty set — the single production
  construction site (`ExpressionEvaluator.scala` FieldRef evaluation) was itself updated
  in this diff to pass `row.keySet`. No site produces a worse "no columns are available"
  message for a case where columns actually exist.

- **Adversarial lexer probe**, run directly against the shipped code via a throwaway
  ScalaTest spec (`ProbeSpec.scala`, added and removed, `sbt testOnly`), not read from
  prose:
  - `$a.1` → `Right(())` — single-digit dotted segment accepted, matches the shipped
    grammar-doc regex `(\.[A-Za-z0-9_]+)*` (digit-leading segments are explicitly
    permitted by the documented regex, not merely a lexer accident).
  - `$1.a` → `Left(Expected an identifier after '$')` — correctly rejected (first
    segment must start with letter/`_`).
  - `$a._b`, `$_a.b`, `$a.1a` → all `Right(())`, consistent with the documented regex.
  - `$a.b+$c.d` (no spaces) → `Right(())` — `+` correctly terminates the ref scan;
    no cross-contamination between adjacent dotted refs.
  - `$a.b(1)` → `Left(Unexpected token after expression)` — a dotted ref is never
    treated as callable; no surprising function-call lexing.
  - `$a.b*.5` → `Right(())` — the `*` cleanly separates the dotted ref from the
    `.5` number literal; no ambiguity with the number branch.
  - `$a.b.5` → `Left(Unknown field: a.b.5 — ...)` — the trailing digit segment `.5`
    is swallowed whole into the ref (`"a.b.5"`), not split into `$a.b` and a separate
    `.5` number literal. This is surprising on first look but is exactly what the
    committed grammar doc's regex documents (segments may be digit-only), and it is
    unambiguous (no operator between the ref and the digits, so there is no
    alternative valid parse to prefer). Not a defect.
  - `$a..b` → `Left(Invalid number literal: ..)`, `$a.b.` / `$stats.` →
    `Left(Invalid number literal: .)` — doubled/trailing dots do become parse
    errors as documented (`docs/compute-expression-grammar.md:27-28`,
    spec.md "Trailing dot in a reference is a parse error" scenario, which only
    commits to "returns a parse error", not to specific wording). Checked whether
    this message quality is a *regression*: the number-literal branch is untouched
    by this diff (confirmed in the diff), and a trailing/doubled dot after a `$`-ref
    fell into this same branch before this ticket too (the pre-existing tokenizer
    never consumed dots at all, so any dot after a ref immediately hit the number
    branch). Not introduced by HEL-867, not covered by any promise in design.md/spec.md
    beyond "is a parse error" — out of scope, not a blocking defect, but flagged below
    as a non-blocking note since design D4 talks generally about wording quality.

- **Multi-dot claim ($a.b.c)**: code comment "D2" says "admit a single interior dot"
  but the `while` loop is unbounded and consumes every subsequent `.segment`, i.e. it
  admits *multiple* interior dots — confirmed by test 3.6
  (`ExpressionEvaluatorSpec.scala:417-420`, `$a.b.c` against row keyed `"a.b.c"`,
  passing) and by the grammar doc's own regex, which correctly says "one or more
  ... segments ... joined by interior dots" (plural, correct). The code comment's
  "a single interior dot" wording is imprecise relative to the actual/tested/documented
  multi-dot behavior — a prose-vs-code mismatch inside the implementation comment
  itself (not the shipped user-facing doc, which is accurate). Non-blocking (see notes).

- **Real call-path exercise, not isolated unit calls**: `PipelineAnalyzeServiceSpec`
  diff adds a test that goes through `PipelineAnalyzeService.analyze` — the actual
  compute-step `validate`/`inferType` seam a real request hits — and asserts the
  user-facing `validationError` string contains `"stats.pts_ppr"`, `"literal"`, and
  `"not traversed as a path"`. `ExpressionEvaluatorSpec` 3.7 exercises `evaluate`
  against a row produced by the real `JsonFlattener.flattenJsObject`, not a
  hand-built map — the actual `SourceService.applyComputedFields` seam. Both are
  genuine end-to-end assertions, not vacuous re-statements of the implementation.

- **`FilterStepSpec.scala` (new file)**: verified `FilterStep.apply` resolves
  `FilterCondition.field` by literal exact-key lookup (`row.getOrElse(field, null)`,
  confirmed by reading `FilterStep.scala`), independent of `ExpressionEvaluator` — the
  ticket's premise correction that filter already worked with dotted columns is
  accurate, and the added characterization test is real (asserts a specific filtered
  row set, not just "no exception").

- **Legacy-fallback gate unaffected**: `isDollarPrefixError` is an exact string
  match against `DollarPrefixRequiredMsg`; the dot-admitting change never touches this
  gate. Confirmed by reading `evaluate`/`validateTolerant`'s fallback logic
  (lines 457-466, 381-387) — dotted-ref parse failures produce a different message
  and therefore never reach `parseLegacy`, exactly what test 4.6 asserts and what I
  independently reproduced (`$stats.` → `ParseError(Invalid number literal: .)`, not
  routed through legacy).

- **Ran the full affected test suite myself**, not trusting evaluation-1.md's
  attestation: `sbt "testOnly com.helio.domain.engine.* com.helio.domain.steps.*"` →
  `Tests: succeeded 548, failed 0`. Also compiled clean (`sbt compile`). Reproduced
  twice (once scoped to the 3 changed spec files: 168/168 passing).

- **Doc/spec/code triangulation**: `docs/compute-expression-grammar.md`'s regex,
  the "Dotted references name one flattened column" section, and
  `specs/compute-expression-language/spec.md`'s Requirement text and scenarios were
  each checked against the actual lexer/evaluator behavior above; all match. The
  D3 no-traversal/no-splitting claim was independently probed (test 3.8 exercises
  the real `JsonFlattener`, not a hand-built ambiguous map) and holds.

- Confirmed the environment note is accurate: `node_modules` is absent
  (`git diff main...HEAD --stat -- frontend/` is empty; no jest/tsc run attempted,
  consistent with instructions — this is genuinely backend-only Scala).

### Verdict: CONFIRM

### Non-blocking notes

1. `ExpressionEvaluator.scala` (the `$`-ref scan, "design D2" comment) says "admit a
   single interior dot" — the actual/tested/documented behavior is that the loop
   admits any number of interior dots (`$a.b.c`, etc., per test 3.6 and the
   grammar-doc regex). Worth a one-line comment fix so a future reader isn't misled
   by the implementation comment itself (the shipped user-facing docs are already
   correct).
2. A trailing/doubled dot immediately after a `$`-ref (e.g. `$stats.`, `$a..b`)
   surfaces as `Invalid number literal: .` / `..` rather than any dotted-reference-
   specific wording — confusing for a user who typos a dotted reference mid-edit.
   This is pre-existing tokenizer behavior (the number-literal branch is untouched
   by this diff) and is technically within the letter of what design.md/spec.md
   promise ("is a parse error"), so it is not a regression this ticket introduced
   and not required by the ticket's own acceptance criteria. Worth a follow-up
   ticket if the team wants dotted-typo UX polish, but not a blocker here.
