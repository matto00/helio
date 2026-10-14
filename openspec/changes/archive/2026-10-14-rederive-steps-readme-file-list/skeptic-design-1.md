## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 574a589d81576ad4b057cfcc4d3e02666242430b (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/rederive-steps-readme-list/HEL-1590`.
- README current state (`cat -n backend/src/main/scala/com/helio/domain/steps/README.md`): lines 3-9 list 23 `*Step` names, "one file per step type", "plus `StepCodecUtil`". Matches the design's Context.
- `ls backend/src/main/scala/com/helio/domain/steps/*Step.scala | wc -l` = 27; the four missing names (`AnalyzeWithAiStep`, `ConvertFormatStep`, `GenerateTextStep`, `UpsertSourceStep`) are present in `ls`. Confirmed.
- `sed -n '/val Registry/,/^  )/p' .../PipelineStep.scala | grep -c -- '->'` = 27. Confirmed.
- D3 command output: `AnalyzeWithAiConfig ConvertFormatConfig GenerateTextConfig JoinColumnNaming SecondaryInput StepCodecUtil UpsertSourceConfig UpsertTargetCheck WindowRolling` — exactly the nine the design names. Confirmed.
- HEL-1451 precedent: `services/pipelines/README.md:5` reads "This list is a snapshot of the directory at HEL-1451, not a completeness claim; re-derive it with:" + fenced `ls ... | xargs -n1 basename | sed` command. D1 wording shape matches.
- `.openspec.yaml` has `skip_specs: true`; no contract/schema change is in play, so no spec delta is missing.
- Column-collision section references still resolve: `MultiInputSchemaInference.inferLookup` (engine/MultiInputSchemaInference.scala:26), `LookupStep.evaluate` (LookupStep.scala:80), `JoinColumnNaming.resolveWithKey` (JoinColumnNaming.scala:35).
- `domain/shapes` exists and holds `ShapeStepExpansion.scala` etc. — the "Does not belong here" clause is true.
- AC coverage: AC1 (re-derived list + command in README) -> D1/task 1.1-1.2; AC2 (no completeness claim) -> D1/D2/D3; AC3 (other sentences truthful, nothing HEL-1467 removed returns) -> D4/tasks 1.3, 1.5; AC4 (docs only) -> proposal Non-goals, task 2.2. No scope drift beyond D3, which is justified in Planner Notes.

### Finding that blocks

README line 11, "**Belongs here:** individual step config types and their apply/infer logic", is not true of the tree for "infer":
- `grep -lE 'def (infer|inferSchema|outputSchema)' backend/src/main/scala/com/helio/domain/steps/*.scala | wc -l` = 0.
- Per-op schema inference lives in `domain/engine/StepSchemaInference.scala:14-15` ("per-op schema inference dispatch", `private[engine] object StepSchemaInference`) plus `ColumnSchemaInference`, `MultiInputSchemaInference`, `ReshapeSchemaInference`, `TextSchemaInference` in `domain/engine/`. The README's own line 102 already says lookup's analyze lives in `MultiInputSchemaInference`.
- By contrast apply/runtime logic is here: `grep -lE 'def (apply|evaluate|run)\b' .../*Step.scala | wc -l` = 27.

D4 states the "Belongs here / Does not belong here" lines were "re-verified (`domain/shapes` exists and holds shape expansion) and kept unless false", but the only check it names covers the "Does not belong here" clause. Read literally, an implementer runs that check, finds it true, and keeps line 11 — leaving a false sentence directly under the new introduction, which violates AC3 ("Every other sentence in the README stays truthful"). The design already has the answer available and should state it rather than leave it to a check it under-specifies.

### Verdict: REFUTE

### Change Requests

1. design.md D4 (and tasks.md 1.3): name the "Belongs here" sentence as false-as-written for "infer" (evidence above) and specify the fix — e.g. "step config types and their runtime (apply/evaluate) logic; per-op schema inference lives in `domain.engine` (`StepSchemaInference` and siblings)", with the verifying commands (`grep -lE 'def (infer|inferSchema|outputSchema)' .../steps/*.scala` -> 0; `grep -n 'object StepSchemaInference' backend/src/main/scala/com/helio/domain/engine/StepSchemaInference.scala`) recorded in `evidence/claims.md`. Replace the current "re-verified (`domain/shapes` ...)" wording, which claims a verification of the whole pair that was only done for half of it.
2. tasks.md 1.3: require a per-clause check of both lines 11-13 (each noun phrase: "config types", "apply", "infer", "shape-level expansion ... `domain.shapes`") with command + output in `evidence/claims.md`, not just "keep unless false".

### Non-blocking notes

- D2's example phrase "mostly one `*Step` file per step kind" implies a name correspondence the design itself says is unchecked ("Do not claim the two counts ... correspond by name"). Consider dropping "per step kind" entirely, or verify the 27 file-to-kind mapping by name in evidence.
- D3's grep `grep -v 'Step\.scala$'` would also exclude any future non-step file whose name ends in `Step.scala`; harmless today, fine as a snapshot command.
- tasks.md has an empty "## Standing Constraints" heading; harmless.
