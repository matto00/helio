## Context

The `PipelineStep` ADT (`backend/src/main/scala/com/helio/domain/PipelineStep.scala`) is a per-file
registry: each kind owns a `*Config`, a `*Step` case class implementing `evaluate`, a JSON codec, and a
`Companion` registered in `PipelineStep.Registry`. Adding a kind touches ~10 files beyond the new step
module itself (confirmed by grepping every `LookupStep`/`LookupConfig` reference, the most recently
added kind, and re-verified below): `domain/package.scala` (type aliases),
`api/protocols/PipelineStepConfigCodec.scala` (encode/extractConfig match arms),
`api/protocols/PipelineStepProtocol.scala` (per-step response case class + wire read/write dispatch),
`api/protocols/PipelineAnalyzeProtocol.scala` (per-step **analyze** response case class
`*AnalyzeStepResponse extends AnalyzeStepResponse`, its `jsonFormat6` instance, and its arm in both the
sealed `analyzeStepResponseFormat.write` and `.read` dispatch — a distinct file/type from
`PipelineStepProtocol.scala`'s ordinary step response; found only on a second, targeted grep after the
design gate's first pass missed it — see the round-1 skeptic report), `infrastructure/PipelineStepRepository.scala`
(DB row → step), `services/PatchSetPreviewProjectionSteps.scala` (position-copy + config-update match
arms), `services/PipelineService.scala` (constructs the analyze response defined in
`PipelineAnalyzeProtocol.scala` — construction only, not declaration), `domain/PipelineAnalyzeService.scala`
(schema-inference dispatch), the Flyway `pipeline_steps_op_check` migration, and the frontend
(`types/pipelineStep.ts`, `stepNarrowing.ts`, `useStepCardState.ts`, `StepCard.tsx`, the new editor).
`assert` is purely local (no `DataSourceRepository` access), so — unlike `join`/`union`/`lookup` — it
needs no ACL pre-flight in `PipelineService.scala` and no async `Future` machinery beyond the required
`Future.successful` wrapper `evaluate` always returns.

## Goals / Non-Goals

**Goals:**
- Land the `assert` step scaffolding end-to-end (persist → analyze → edit) as an identity pass-through.
- Match the existing per-step-file ADT pattern exactly — no new abstractions.

**Non-Goals:**
- Rule evaluation, pass/fail results, or per-run persistence (419-B).
- Fail-policy / blocking behavior (419-C).
- `add_pipeline_step` MCP tool wiring (419-F) — out of this ticket's scope per the epic's own dependency
  order.

## Decisions

**1. `AssertConfig` is a one-field case class (`AssertConfig(rules: Vector[AssertRule])`), not a bare
`Vector[AssertRule]` type alias.** The ticket text says "`AssertConfig` = `Vector[AssertRule]`", read
here as "AssertConfig's sole payload is a rule vector" — the same sense `SelectConfig`'s payload is a
`Vector[String]` (`SelectConfig(fields: Vector[String])`), not literally "no wrapping case class."
Every existing config is a JSON *object* on the wire, and the API/DB plumbing this ADT sits on is typed
against that assumption: `StepCodecUtil.asObject` returns `JsObject.empty` for any non-object top-level
value, and `PipelineStepConfigCodec.encodeJsObject(kind: String, configJson: JsObject)` — the
create/update path's validation entry point — is typed `JsObject`, not `JsValue`. A bare-array config
would need bespoke handling at both boundaries for no benefit. Wire shape: `{"rules": [...]}`.
*Alternative considered*: a raw-array wire shape — rejected as inconsistent with every sibling config
and the JsObject-typed plumbing, for zero behavioral gain.

**2. `AssertRule.decode` is per-field-lenient, not `Try(_.convertTo[AssertRule]).toOption`-per-item.**
`FilterConfig.decode`'s precedent drops a malformed `FilterCondition` entry entirely via
`Try(...).toOption`. Applying that same idiom to `AssertRule` would drop a rule whenever any one
required field (`kind: String`, `params: JsObject`, `severity: String` — none `Option`) is absent,
which is harsher than needed for a first-ticket-in-an-epic step type without a mature editor's write
discipline yet. Instead, `AssertConfig.decode` maps each array element through per-field defaults
(`kind` → `""` if missing/non-string, `field` → `None`, `params` → `JsObject.empty`, `severity` →
`"warn"`), never dropping an item and never throwing — directly satisfying the acceptance criterion
"`AssertConfig.decode` tolerates partial/legacy configs ... without throwing." The canonical
`encodeConfig`/`writeToWire` path still uses an ordinary derived `jsonFormat4[AssertRule]` for
well-formed round-tripping (decode is the only hand-rolled-tolerant side, matching
`FilterConfig.format`'s split of "strict encode, tolerant decode").

**3. Decode-tolerance default severity (`"warn"`) is deliberately different from the editor's
new-rule default (`"error"`).** These serve different concerns: `"warn"` on decode is the safe fallback
for corrupted/partial persisted data (this step doesn't gate anything yet, so it costs nothing to be
conservative); `"error"` as the UI's default for a freshly-authored rule matches the ordinary meaning of
adding an assertion — a rule a user explicitly writes should default to blocking once 419-C ships.

**4. Field-requiring vs. dataset-level rule kinds.** `notNull` / `unique` / `range` / `regex` require
`field` (and validate it against the input schema); `rowCountMin` / `rowCountMax` are dataset-level and
never check `field` — this mapping is used identically by `PipelineAnalyzeService.inferAssert` (backend
validation) and `AssertConfig.tsx` (field picker shown/hidden per kind). No shared constant is
introduced between backend and frontend for this — every existing per-kind allow-list in this codebase
(e.g. `WINDOW_FUNCTIONS` in `WindowConfig.tsx`, `"string-body"` in `inferSplitText`) is duplicated
per-layer rather than shared cross-language, so this follows the same precedent.

**5. `inferAssert` gets its own dispatch case, not the blanket identity group.** `filter`/`limit`/
`sort`/`dedupe`/`fillnull`/`union` share one dispatch arm because they never produce a
`validationError`. `assert` always returns `inputSchema` unchanged but *can* emit a `validationError`
(invalid `kind`, invalid `severity`, or a field-requiring rule whose `field` is absent from
`inputSchema`), so it needs a dedicated case, closer in shape to `pivot`/`unpivot`'s
validate-but-stay-identity pattern than to `splittext`'s validate-and-reshape pattern. All problems
across all rules are aggregated into one `validationError` message (matching `inferPivot`/
`inferUnpivot`'s multi-field aggregation), not short-circuited on the first bad rule.

**6. No `params` shape validation in `inferAssert`.** The ticket's acceptance criteria call out only
"unknown field" and "invalid `kind`/`severity`" as `validationError` triggers — not "range" missing
both `min`/`max`, or "regex" missing `pattern`. Deeper shape validation is naturally 419-B's job (real
rule evaluation); adding it here would be scope creep the ticket doesn't ask for.

**7. Migration number resolved at execution time.** Per the ticket, main is at V81 as of scheduling;
the executor must re-check `backend/src/main/resources/db/migration/` immediately before writing the
migration file rather than trust this document's snapshot, since sibling epic tickets may land
migrations concurrently.

## Risks / Trade-offs

- [Ten-plus touch points for one new op] → mechanical but error-prone; `PipelineStepSpec`'s
  `PipelineStepKind.All` parity test and its sealed-trait-style exhaustiveness match are the safety net
  — both fail loudly (test failure / compile error) if a touch point is missed.
- [Tolerant per-field decode (Decision 2) is more code than `Try(...).toOption`] → accepted; the
  acceptance criterion explicitly requires never-throws behavior, and per-field defaults are more
  informative than silently dropping a rule the user is mid-editing.

## Planner Notes

- Self-approved Decision 1 (config wrapped in a case class rather than a bare type alias) — it resolves
  an ambiguity in the ticket's shorthand notation in favor of consistency with every sibling step's wire
  shape and the JsObject-typed codec plumbing; it changes no existing behavior and stays inside the
  ticket's stated scope, so it does not rise to "major architectural change" or "breaking API change."
- Self-approved Decisions 2-6 as ordinary implementation judgment calls of the kind every prior op's
  design.md already makes (see `datebucket`'s blank-outputColumn-omission rule, `stringops`'s
  append-or-replace family choice, etc.) — each is grounded in an existing precedent in this file's
  Context section, not invented from scratch.
