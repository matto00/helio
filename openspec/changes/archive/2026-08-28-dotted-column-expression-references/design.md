## Context

See proposal.md — Why. Ground truth established by tracing (evidence/premise-validation.md):

- `tokenize` (ExpressionEvaluator.scala:85) is the single lexer. Its `case '$'` branch (:127-133) reads
  `isLetterOrDigit || '_'`. Its number branch (:135-142) fires on `d.isDigit || d == '.'`. Its bare-identifier
  branch (:144-151) is the legacy/function-name path.
- The three branches are dispatched by first character and are mutually disjoint: the number branch is only ever
  entered when a token *starts* with a digit or dot, and the bare-identifier branch only when it starts with a
  letter or `_`. Neither can be entered from inside a `$`-reference scan.
- `evaluate` takes `row: Map[String, JsValue]` (:419) — flat. `ComputeStep.scala:59` passes
  `PipelineRowJson.rowToJsMap(row)`; `SourceService.scala:404` passes `obj.fields` of an already-flattened row
  (:355) or of inherently-flat JDBC rows (:329).
- `JsonFlattener` deduplicates a literal-vs-nested collision to one column inside `leaves` (:24-33).
- Six entry points, five files, all funnelling through this one tokenizer — enumerated in ticket.md correction 2.

## Goals / Non-Goals

Goal: `$stats.pts_ppr` resolves on every one of the six entry points, with the legacy path and number literals
provably untouched. Non-goals are listed in proposal.md; the design-level addition is that no call site changes —
if any call site needs editing, the tokenizer change was wrong.

## Decisions

**D1 — Admit dots in the `$`-reference branch only, not in the shared identifier scan.**
The `$` branch and the bare-identifier branch currently run character-identical scan loops. The tempting move is
to extract one shared `scanIdentifier` helper and let both gain dots. Rejected: the bare-identifier branch feeds
`Token.Ident`, consumed by the frozen `LegacyParser`, and also feeds `Token.FnName`. Widening it would change the
frozen legacy grammar's accepted language (`a.b` would become one legacy ref instead of a parse error) — exactly
the backwards-compatibility surface the ticket says must not move. Chosen: duplicate the scan with dot support in
the `$` branch alone. The mild duplication is the point; the two scans are no longer the same rule and should not
be forced to share code.

**D2 — Interior dots only; a dotted reference is one opaque literal name.**
Scan `[A-Za-z0-9_]` runs separated by single dots, and accept a dot only when the *next* character is an
identifier character. Consequences: `$a.` errors (dot not consumed, then hits the number branch or EOF), `$.a`
errors already at the existing "Expected an identifier after '$'" guard, `$a..b` errors. Alternative rejected:
"consume any run of `[A-Za-z0-9_.]`", which would silently accept `$a.` as the column `a.` and `$a..b` as `a..b`
— names the flattener can never produce, turning a typo into an unknown-field error at row time instead of a
parse error at validation time.

**D3 — Exact-match resolution. No splitting, no traversal, no prefix fallback. This is the ticket's ambiguity
decision, and the honest answer is that the race does not exist at evaluation time.**
The ticket asks how `$a.b` resolves when both a literal column `a.b` and a nested path could match. Tracing shows
it cannot arise: by the time any expression runs, `JsonFlattener` has already collapsed `{"a.b": 1, "a": {"b": 2}}`
to exactly one `a.b` column (last-in-original-walk-order, deduplicated inside `leaves`, JsonFlattener.scala:24-33).
The row is a flat `Map[String, JsValue]`; there is no nested value left to traverse and no second candidate to
prefer. So the correct rule is not a new tie-break invented here — it is to *inherit* the flattener's existing
decision and state it normatively: a dotted reference is one literal key, matched exactly.
This is deliberate rather than incidental. The alternative — try the literal column, else split and traverse —
was rejected on three grounds: it would need a nested row shape that no call site provides; it would make the same
expression mean different things depending on whether flattening had run; and it would reintroduce as an
evaluator concern an ambiguity the flattener already resolves once, centrally, for both rows and schema.
The prefix-fallback variant (`$a.b` → column `a` when `a.b` is absent) is rejected outright: it turns a typo into
a silently wrong number, which is the failure mode this epic has been most burned by.

**D4 — Error wording is behaviour (standing requirement 4).**
`UnknownField(name)` currently yields `Unknown field: stats.pts_ppr`. A user who wrote that reference is most
likely looking at an unflattened source, a `rename` that already stripped the prefix, or a mistyped segment — and
"Unknown field" leads none of them to the fix. When the unresolved name contains a dot, the message must say that
the reference is matched as a whole literal column name produced by flattening, not as a path, and point at the
available columns. The message must not imply traversal was attempted, or it will send users to look for a nested
value that no longer exists at that point.

**D5 — Number literals are safe by construction, and this must be tested behaviourally, not argued.**
`.5` and `1.05` enter the number branch because they start with `.` or a digit; a `$` reference never reaches it.
The design claim is a disjointness argument, and a disjointness argument is exactly the kind of prose this epic
has repeatedly found to be false. So it is discharged by test, not by this paragraph: `.5`, `1.05`, `$a * .5`,
and `1.2.3` (still `Invalid number literal`) are asserted directly.

**D6 — Spark divergence is acknowledged, not fixed.**
`SparkJobSubmitter.scala:177-178` hands the same stored string to Spark SQL `F.expr`, a different grammar where
`$` is not a column sigil and a dotted name means struct access unless backtick-quoted. Compute expressions are
therefore already broken under Spark before this change (`$price * $qty` is not valid Spark SQL), so this change
does not regress it. It does add a second way for the two paths to disagree. Out of scope; to be filed as a
follow-up rather than half-fixed here.

## Risks / Trade-offs

- [The disjointness claim in D5 is wrong somewhere I did not trace] → discharged by behavioural tests over the
  number-literal and legacy paths, plus red-on-revert evidence, not by the argument itself.
- [Widening `$`-refs changes what the legacy fallback is *offered*] → `isDollarPrefixError` only triggers the
  legacy retry on the specific `$`-prefix-required message; a dotted-reference parse failure produces a different
  message and so must not trigger it. Asserted directly rather than assumed.
- [Two near-identical scan loops invite a future "cleanup" that re-merges them] → D1's rationale is recorded in a
  code comment at both scan sites, not only here, since the next reader will be in the file and not in this doc.
- [Unicode drift: `isLetter` accepts `$café` while docs say ASCII] → pre-existing, untouched, explicitly a
  non-goal; the new dot rule is specified over `[A-Za-z0-9_]` segments so it does not widen that drift further.

## Migration Plan

None. Pure grammar widening: every expression valid before remains valid and evaluates identically. Nothing is
persisted differently, no data migration, no rollout coordination. Rollback is reverting the commit.

## Planner Notes

Self-approved: the tokenizer-only approach, interior-dot rule, exact-match resolution, and the decision to
document rather than re-litigate the flattener's collision rule. Escalation-worthy scope (new dependency,
breaking change, architectural change) is absent — no call site, wire format, or persisted shape changes.

Three corrections to the ticket's own text were made during planning and are recorded in ticket.md rather than
silently applied: `filter` is not an affected surface, there are six entry points rather than two, and the
literal-vs-nested ambiguity is already decided upstream. One correction was to my own reasoning: an apparent
flattened/unflattened asymmetry between the two `applyComputedFields` call sites is not real — the unflattened
one carries JDBC rows, which are inherently flat.
