## Context

See proposal.md. File at ecaa1a53: `PipelineAnalyzeService.scala`, 1201 lines. Top-level `final case class SchemaField`
(13-36, with doc), then `object PipelineAnalyzeService` (39-1201). Callers use only `StepConfigInvalidCode`,
`stepConfigProblem`, `schemaFieldJsonFormat`, `PipelineStepInput`, `AnalyzedStep`, `analyze`, `NodeStepInput`,
`analyzeNodes` (both overloads), `sourceDependencyOf`, plus the `private[engine]` `laneDependencyOf` and
`inferOutputSchema` (the latter called by `PipelineAnalyzeServiceSpec`'s registry-vs-dispatch coverage guard through
`import PipelineAnalyzeService._`). Scala 2.13.15.

Live guards with zero-test-edit pressure: `PipelineAnalyzeServiceSpec` (incl. the coverage guard, line ~1468),
`StepEnumWriteValidationSpec`, `AutoRunTriggerServiceSpec`, `FireTimeRunConfigGateSpec`, `PipelineAnalyze*Spec`,
`AutoRunGuard*Spec`, `SchemaField*Spec`, `Join/LookupColumnCollisionSpec`. Known flake: `AutoRunGuardBurstProofSpec`
(HEL-1439) - re-run once and note; twice red means investigate.

## Goals / Non-Goals

Goals: concern-focused files under ~250 lines where the seams allow; identical behaviour; zero test-source diff except
the nit import sort; reviewers can tell moves from edits. Non-goals: see proposal.md.

## Decisions

**D1 - Entry point keeps name, package, public API.** `PipelineAnalyzeService.scala` keeps verbatim: `log`,
`StepConfigInvalidCode`, `stepConfigProblem`, `schemaFieldJsonFormat`, `PipelineStepInput`, `AnalyzedStep`, `analyze`,
`NodeStepInput`, `DefaultRootKey`, `laneDependencyOf`, `sourceDependencyOf`, both `analyzeNodes`, with their comments.
`stepConfigProblem` body becomes `StepConfigValidation.validateStepConfig(op, rawConfig)`; its doc and signature are
unchanged. `analyze`/`analyzeNodes` reach `validateStepConfig` unqualified through a named import
`import StepConfigValidation.validateStepConfig` (no same-named member remains in the object, so no ambiguity).
`inferOutputSchema` is NOT imported anywhere in this file: a `private[engine] def inferOutputSchema` forwarder with the
identical signature (including `secondarySchema: Option[Vector[SchemaField]] = None`) stays in the object, its body is
the fully receiver-qualified `StepSchemaInference.inferOutputSchema(op, config, inputSchema, secondarySchema)` (an
unqualified body would call itself), and the call sites at base lines 148 and 304 resolve to that forwarder unchanged.
The coverage guard compiles unchanged through `import PipelineAnalyzeService._`.
HEL-872 comment (base 464-469): it stays in the entry point, above the forwarder, verbatim, since it explains the
forwarder's `private[engine]` and the guard still calls it. It is assigned to D1, not D2. The moved dispatch in
`StepSchemaInference` (base 470-515) gets a one-line new comment saying it is `private[engine]` so the entry-point
forwarder can call it (allow-listed D3 "scaffolding comment").

**D2 - Destinations (same package, each `private[engine] object`).** Ranges at ecaa1a53, including doc comments.
- `SchemaField.scala` - `SchemaField` case class (13-36). Top-level, so public as before.
- `StepConfigValidation.scala` - `validateStepConfig` and the eight `validate*` helpers (331-461).
- `StepSchemaInference.scala` - `inferOutputSchema` dispatch (470-515; 464-469's HEL-872 comment stays in D1) and
  `parseConfig` (1137-1153).
- `ColumnSchemaInference.scala` - select, rename, cast, compute, `canonicalizeLegacyType`, aggregate (518-649);
  groupby, `aggregateResultType`, `aggResultType` (1154-1200).
- `TextSchemaInference.scala` - convertformat, analyzewithai, generatetext, splittext, extractheadings,
  chunkbytokencount (650-850, contiguous; the splittext doc at 650-657 stays where it is in the block).
- `ReshapeSchemaInference.scala` - datebucket, pivot, window, unpivot, stringops (851-996); assert and its two rule-kind
  sets (1078-1136).
- `MultiInputSchemaInference.scala` - lookup, union, join (997-1077).
Lines no member claims (1-12 package/imports, 37-39, 462-463, 516-517, 1201 closing brace) are allow-listed
scaffolding/blank lines in the inventory. Names are self-approved. The executor may move a member elsewhere only if a cross-family call forces it, recorded in
evidence.

**D3 - Bodies move byte-identical.** Members keep their 2-space object-body indentation. Cross-object calls keep their
unqualified text through named imports (`import StepSchemaInference.parseConfig`, etc.). Allowed non-move lines only:
package/imports, object scaffolding, `private` -> `private[engine]` on members now called across objects, the D1
delegation and forwarder, the logger line (D4), and positional words in comments that the move made false. Inline FQNs
inside moved code (`scala.util.Try` in `inferJoin`) MAY become a top-of-file import plus the short name; each instance is
listed in evidence. The kept `laneDependencyOf`/`sourceDependencyOf`/`analyzeNodes` FQNs are left untouched (not moved
code). `check:scala-quality` must pass and every `s"${...}"` in new files is eyeballed (the guard is blind there).

**D4 - Logger name.** All 12 moved `log` sites (base lines 575 compute, 646 aggregate, 692 convertformat, 724
analyzewithai, 753 generatetext, 776 splittext, 810 extractheadings, 847 chunkbytokencount, 903 pivot, plus the
unpivot, assert and `parseConfig` sites; the executor lists all 12 by base line in evidence) keep logger name
`com.helio.domain.engine.PipelineAnalyzeService$`. The ONLY permitted form is
`private val log = LoggerFactory.getLogger(PipelineAnalyzeService.getClass)` in each new object that logs. The entry
point's `log` keeps its exact `private` visibility (widening it would add a public `log()` to
`PipelineAnalyzeService$` and break D6b).

**D5 - Initialisation.** New objects hold only `def`s, the two assert `Set` vals, and possibly a logger; no val reads
another object's val at init except the logger, so no cycle can observe a null.

**D6 - Evidence (in this change dir; scripts in the scratchpad).**
(a) `move-evidence.md`: inventory assigning every member of the original file to exactly one destination; a checker
that is forward (each member's base text byte-equals its new text, modulo D3's listed edits) and positional reverse
(every line of the eight resulting files is claimed by exactly one member span or one allow-listed non-move line tagged
with its D3 category). Red runs on scratch copies: one token changed in a moved body (forward fails); a copied
existing line inserted outside any member (reverse fails). Plus a `git diff --color-moved=plain` summary.
(b) `api-evidence.md`: `javap -public` of `PipelineAnalyzeService`, `PipelineAnalyzeService$`, `SchemaField`,
`SchemaField$`, and the nested `PipelineStepInput`, `AnalyzedStep`, `NodeStepInput` (class and companion) before vs
after, filtered to drop compiler synthetics (`$anonfun$`, `$deserializeLambda$`, names containing `$$`). Filtered diff
must be empty. Red run: temporarily change a default or a parameter type on a kept public member, rebuild, show a
non-empty diff, revert.
(c) Logger: grep showing every new logger resolves to `PipelineAnalyzeService`'s name; red run: temporarily use the
new object's own `getClass`, show the grep/check fails, revert.
(d) `test-count-evidence.md`: baseline `nice -n 19 sbt testFull` on the unmodified worktree (total and per-suite counts
for the suites listed in Context); the after run matches and passes. `git diff <base>...HEAD -- backend/src/test`
shows only `AutoRunTriggerServiceSpec.scala` import-line changes.
(e) Nits: `git diff --word-diff` (or a token comparison) of the two reflowed comments shows identical word sequences;
the spec's import lines before vs after compare equal as a sorted multiset of imported names, and no non-import line
changed. Comments in OTHER files that name moved members as `PipelineAnalyzeService.inferX` etc. are NOT edited
(they still resolve conceptually through the entry point; editing them is out of scope). The suite outlives one Bash call: run it
backgrounded to a scratchpad log, poll with `scripts/concertino/await-sentinel.sh` or bounded waits.

**D7 - Nits.** `AutoRunTriggerServiceSpec.scala`: sort import selectors alphabetically within the existing import groups (do not merge or reorder groups), no other change.
`PipelineAnalyzeProtocol.scala:237` and `AutoRunTriggerService.scala:122`: reflow the comment so every line is <= 120
characters, words unchanged.

## Risks / Trade-offs

- [Forwarder default arg drift] -> D6b javap catches a missing `inferOutputSchema$default$4`.
- [Entry point still ~300 lines] -> mostly doc comments of the DAG walk; accepted, splitting the walk itself would
  separate `analyze` from `analyzeNodes` for no reader gain.
- [Widened `private[engine]` members] -> package-only; accepted, as in the earlier PipelineRunService split (archive 2026-10-08-split-pipeline-run-service).
- [Concurrent HEL-1393] -> no shared file; second to merge reconciles if that changes.

## Planner Notes

- Self-approved: seven destination files rather than the ticket's three seams, because inference alone is ~690 lines.
- Self-approved: dropping the ticket's "cost/canRun" seam (not in this file; see ticket.md premise notes).
