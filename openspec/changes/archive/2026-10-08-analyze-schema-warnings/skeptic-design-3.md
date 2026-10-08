## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 9fbdd4267a517f9a91554cadafe853165b44e1a2 (the planning artifacts are untracked in the worktree).

### What I verified (with evidence)

- **cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/analyze-schema-warnings/hel-1235`.
- **Round-2 CR1 (pivot name-incompleteness) is addressed.**
  - D3a now has condition 3b covering pivot plus any other op task 1.2 finds with data-derived names.
  - The spec's "Missing referenced field warns" lists pivot and adds the "Reference to a pivoted column does not warn" scenario. Task 2.1 adds negative (g).
  - I grepped `PipelineAnalyzeService.scala` for "not enumerated|runtime data|dynamic". The only hit is the pivot doc at :866-868. Pivot is currently the only op that documents data-derived names. Task 1.2 still re-checks this.
- **Round-2 CR2 (type-completeness) is addressed with the positive form I recommended.**
  - D3a defines a TYPE-TRUSTED allow-list. aggregate, groupby, window, pivot, unpivot, union, unresolved join/lookup, AI/text ops and unknown ops are explicitly untrusted, with no reset.
  - Task 1.3 requires each allow-list entry to be confirmed against its runtime step, and any entry that is not confirmed is dropped.
  - The spec adds the "Informational aggregate group-by type does not warn" scenario. Task 2.1 adds negative (h).
- **Round-2 CR3 is addressed.** proposal.md "What Changes" and "Impact" now name `domain/engine/AnalyzeSchemaWarnings.scala` and list `PipelineAnalyzeService.scala` as visibility-only. Impact also lists the protocols, `PipelineService.scala`, the three schemas, helio-mcp types/descriptions and the frontend types. This matches D2 and task 2.2.
- **Driver claims, checked against the design:**
  - Non-blocking: warnings are a separate function output (D2/D6), with guard tests (a) through (d) and mutation-failability required (task 4.1). The HEL-1279 guard is unmodified (task 4.2).
  - Evidence-based wording: D7 and the spec's "not found in the step's inferred input schema" requirement.
  - Minimal `PipelineAnalyzeService.scala` edits: D2 and task 2.2.
- **Anchors exist in code:**
  - `AnalyzedStep` is at `PipelineAnalyzeService.scala:115`.
  - `ConciseAnalyzeNode` is at `PipelineAnalyzeProtocol.scala:279`, the target of D8.
  - JoinStep indexes the right side with `rightRows.groupBy(_.getOrElse(joinKey, null))` at `JoinStep.scala:62`, which supports the D4 runtime-equality premise.
  - CastStep yields `null` on a conversion failure (`CastStep.scala:28-31, 74-77`). That makes `cast` a credible allow-list entry.
- **AC coverage:** AC1 → D1/D2/D8, tasks 3.x. AC2 → D6, tasks 4.x. AC3 → D7. AC4 → D9, tasks 5.x. AC5 → tasks 2.1/3.3. No scope drift. Non-goals are explicit: no rendering, no workspace-context surfacing, no lookup key type check, nothing from HEL-1403.
- **No placeholders block implementation.** The "verify"/probe items (D3 exclusion list, D4 type families, task 1.3 allow-list) are bounded probes with a fail-quiet default (unknown means no warning). They are not open design decisions.

### Verdict: CONFIRM

### Non-blocking notes

- **Task 1.3 allow-list confirmation: two entries are likely to fail, so check them deliberately.**
  - `fillnull` with strategy `constant` writes the raw fill string with no coercion. `mean`/`median` write a `Double` (`FillNullStep.scala`, class doc). A filled key column can therefore carry values of a different class from its projected type. Dropping `fillnull` from TYPE-TRUSTED, or trusting it only when its `columns` exclude the key, is the conservative outcome.
  - When `ExpressionEvaluator.inferType` returns `None`, `compute` falls back to the user's wire `type` (`PipelineAnalyzeService.scala:563-564`), which is a hint and not a materialized type. Either treat that output column as type-incomplete or confirm the evaluator's runtime class.
  - Both cases are caught by the "drop any entry not confirmed" rule. They are named here so the executor does not rationalize them through.
- **The round-2 note is still open.** D3a's `join-column-renamed` sentence still contains the parenthetical "(the rename list may be partial but never wrong ...)" next to "emitted only when both sides are name-complete". The spec states the binding rule (both inputs name-complete), so implement the spec. The parenthetical is dead text.
- **D4 integer families:** the probe should cover `Int` (from `cast` "integer") vs `Long` vs `BigDecimal` (JSON-sourced numbers) under `groupBy` hashing, not only `==`. Hash consistency of cooperative equality is what JoinStep relies on.
