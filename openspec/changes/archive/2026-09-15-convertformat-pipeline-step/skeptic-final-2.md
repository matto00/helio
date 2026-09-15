## Skeptic Report — final gate (round 2, skeptic-final-2.md)

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/convertformat-pipeline-step/HEL-1105`.
- **Review base**: `resolve-review-base.sh` returned `04d8b59090d695c33b2b5e4c522af9433c62795d`; `git rev-parse HEAD` = `edbf71a7f1ce6424786748eef67aa51ad378c111`, matching the gate's stated head.
- **Full diff read** (`git diff 04d8b590...HEAD --stat`): 30 files, 1799 insertions / 42 deletions. Zero `frontend/**` files, zero `db/migration/**` files. `grep -n "ClaudeClient"` in the two new production files matches only a doc-comment stating `ConvertFormatStep` uses none. This confirms the scope constraints (no frontend change, no migration, no AI hooks) hold.
- **AC6 / design.md §6**: diffed the design doc; `convertformat` is no longer grouped with the two `ClaudeClient` steps, and the `AiOps` comment now reads `HEL-1106/1107` (`PipelineCostEstimator.scala:22`). AC6 satisfied.
- **AC4/D7**: `PipelineCostEstimator.scala` has its own `ContentConversionOps = Set("convertformat")` (line 38), checked distinctly from `AiOps`. `AiOps` set unchanged (`Set("analyzewithai", "generatetext")`). AC4 satisfied.
- **AC3 wiring**: read `PipelineStep.scala` (Registry entry + `PipelineStepKind.ConvertFormat`), `PipelineStepConfigCodec.scala`, `PipelineStepRepository.scala` (`rowToDomain` case), `PipelineAnalyzeService.scala` (`inferConvertFormat` dispatch), `PipelineAnalyzeProtocol.scala`/`PipelineStepProtocol.scala` (response types), `PipelineService.scala` (`toAnalyzeStepResponse` case), schema delta (`content-conversion` enum value). All present. `PipelineAnalyzeConvertFormatSpec` exercises the real route (`service.addStep` → real Postgres persist → `service.analyze`) and asserts `200`, `ConvertFormatAnalyzeStepResponse` present, `validationError` `None`, plus (cycle 2) `costVerdict.autoRunnable shouldBe false` and a `content-conversion` reason naming the step id — this is a genuine end-to-end (persist → analyze route) test, not a unit stand-in.
- **AC5**: `PipelineCostEstimatorSpec`'s unregistered-op stand-in is `"notarealop"`; `PipelineCreateTransactionalSpec`'s rejection loop is `Seq("analyzewithai", "generatetext")` with a separate "accept a convertformat step" case. Confirmed by `grep`.
- **AC7**: `openspec/changes/convertformat-pipeline-step/specs/pipeline-convertformat-op/spec.md` exists with ADDED requirements/scenarios covering config validation, 1:1 row shape, CSV/JSON round trip, text/Markdown round trip, named failures, and analyze inference.
- **AC8**: no migration in the diff; `docs`/design confirm V107 already admits the op; no StepCard added (frontend untouched — the unsupported-op fallback renders it safely, consistent with `design.md`'s stated rationale).
- **Baseline test run** (fresh, this session): `sbt testOnly com.helio.domain.steps.ConvertFormatStepSpec` → 61/61 passed, exit 0 (pasted output captured).

### Mutation attack (fresh, this session, not reproducing files-modified.md's own mutation log)

All mutations applied to a saved-and-restored copy of `ConvertFormatStep.scala`; `git status --short` confirmed the tree was clean (byte-identical) after every revert.

1. **Punctuation set drops `&`**: green (61/61). Traced why — `#` is still escaped, so a literal `&#32;` in text always encodes as `&\#32\;` (the `#` escape breaks the literal `&#32;` substring before the unescaped-`&` case can matter). Not a live defect.
2. **Punctuation set drops `!`**: green (61/61). `markdownToText` never treats `!` specially (no image-syntax rule), so dropping it from the escape set is inert given the current decoder. Not a live defect, though it does mean the escape set is broader than the decoder currently requires.
3. **Markdown→text scan reordered so `&#32;`/`&#9;` checks run before the backslash-escape checks**: green (61/61). Traced why — the two rules are triggered by disjoint lead characters (`&` vs `\`); an unescaped `&#32;`/`&#9;` token and a backslash-escaped character never compete for the same scan position given `&` is (correctly) always escaped on the encode side. Reordering these two specific branches is a no-op in this implementation. Not a live defect (the ordering *does* matter for other pairs in the chain, e.g. escape-before-structural-markers, which the existing test suite already covers via the "Markdown-significant characters survive" test).
4. **`json->csv` header-key source changed from `objs.head.fields.keys.toVector` to `.sorted`** (line 149): **green (61/61)**. Every existing test's JSON fixtures happen to use already-alphabetical keys (`a`/`b`, `x`/`y`, `note`). I then wrote a standalone probe test (not part of the shipped suite, removed after use) asserting `{"b":"1","a":"2"}` round-trips to CSV header `b,a` (per D4: "order taken from the first object" and the openspec spec's own "same key order" scenario). **Run against the real, unmutated code, this probe FAILED**: the actual header came out `a,b` — alphabetically sorted, not first-object order.
   ```
   [info] - should preserves first-object key insertion order, not alphabetical *** FAILED ***
   [info]   "[a,b
   [info]   2,1]" was not equal to "[b,a
   [info]   1,2]" (ProbeKeyOrderSpec.scala:14)
   ```
   A follow-up probe with three distinctly-ordered keys (`{"z":"1","m":"2","a":"3"}`) confirmed the header is always alphabetical (`a,m,z`), regardless of the JSON's actual key order. Root cause: `JsObject.fields` (spray-json) is a `scala.collection.immutable.Map`, whose iteration/construction order the parser does not preserve as source-text order; `.keys.toVector` at `ConvertFormatStep.scala:149` silently inherits whatever order that map produces, not "first object" order as `design.md` D4 and the op's own capability spec (`specs/pipeline-convertformat-op/spec.md`, "JSON survives a round trip" scenario: "the result has the same keys, **key order**, and string values") both explicitly claim. Every shipped test's fixtures use keys that happen to already be alphabetical, so this is invisible to the existing suite (not merely a mutation-testing gap — the real code, unmutated, fails the documented contract).

### AC1 status

CSV<->JSON value-level round trip holds (verified via the passing suite and my own probes above). **Key-order preservation does not** — this is a distinct, explicitly-documented part of AC1/D4's "lossless" definition and the capability spec's own scenario text, and it is false as shipped.

### Non-blocking observations

- No test exercises a *fully persisted, DB-backed* pipeline run (`PipelineRunService.submit`, via `pipeline_runs.errorLog`) with an unconvertible `convertformat` input — coverage stops at the `InProcessPipelineEngine.execute` unit level (`ConvertFormatStepSpec` "the engine" test) plus the generic `StepExecutionException`→`errorLog` mechanism proven elsewhere (`PipelineRunServiceSpec`, via `stringops`). This matches the codebase's existing convention for the other content-field op (`splittext`, cited as this ticket's own wiring precedent) which also has no DB-persisted real-run test — not a regression introduced by this ticket, and not blocking, but worth naming since the design's "engine failures" contract is technically demonstrated end-to-end only via a generic other-op fixture, not `convertformat` itself.
- Route-level rejection (400) of a `from==to`/cross-pair `convertformat` config through the actual create/update HTTP-adjacent `service.create`/`service.addStep` path is untested — only `ConvertFormatConfig.pairError`'s unit-level behavior and the *accepting* route-level case are. This mirrors `UpsertSourceConfig`'s own existing test depth for the same kind of check, so it is consistent with project convention, not a new gap.
- Punctuation-escape set includes characters (`!`, and arguably others) the decoder never treats structurally — harmless today, but a reader could mistake the full set for load-bearing; a comment noting which characters are decode-load-bearing vs. defense-in-depth would help future maintenance (not required for this ticket).

### Verdict: REFUTE

### Change Requests

1. **Fix `json->csv` header key ordering to match the documented contract, or correct the documentation to match reality.** `ConvertFormatStep.scala:149` (`val keys = objs.head.fields.keys.toVector`) does not reproduce "first object" order — spray-json's `JsObject.fields` does not preserve JSON source-text key order. Either (a) parse with an order-preserving structure (e.g. iterate the raw parsed `JsObject`'s underlying representation if spray-json exposes one, or re-derive order from the original text) so the header genuinely reflects "the first object," or (b) if source-order preservation is infeasible with spray-json, revise `design.md` D4 and `specs/pipeline-convertformat-op/spec.md`'s "JSON survives a round trip" scenario to state the true, weaker guarantee (e.g. "same key **set**, not order") and update `AC1`'s wording in `ticket.md` accordingly — a deliberate, documented scope reduction is acceptable, but the current combination of code + spec + AC text is internally contradicted by the actual shipped behavior. Whichever path is chosen, add a regression test using non-alphabetically-ordered JSON keys (e.g. `{"z":..., "a":...}`) to the `ConvertFormatStepSpec` "JSON <-> CSV round trip" block — every existing fixture happens to use pre-sorted keys, which is why this shipped invisibly.

### Non-blocking notes

(see "Non-blocking observations" above — DB-persisted real-run coverage and route-level pair-rejection coverage, both consistent with existing project convention and not required to block this gate.)
