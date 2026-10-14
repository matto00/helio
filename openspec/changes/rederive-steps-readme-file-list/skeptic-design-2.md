## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 574a589d81576ad4b057cfcc4d3e02666242430b (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/rederive-steps-readme-list/HEL-1590`.
- README current state (`cat -n .../domain/steps/README.md`): lines 3-9 list 23 `*Step` names + "one file per step type" + "plus `StepCodecUtil`"; line 11 "apply/infer logic"; lines 12-13 `domain.shapes`. Matches design Context.
- Round-1 CR1 (line 11 "infer" false, fix specified): design.md D4 now states line 11 is false and gives the reword. Re-verified cold:
  - `grep -rn -i 'def infer' .../domain/steps/` -> 0 hits; broader `grep -lE 'def (infer|inferSchema|outputSchema|schema)' .../steps/*.scala | wc -l` -> 0.
  - `domain/engine/` holds `StepSchemaInference.scala` (line 14 scaladoc "per-op schema inference dispatch", line 15 `private[engine] object StepSchemaInference`) and `Column/MultiInput/Reshape/Text/ExpressionType SchemaInference.scala`. The proposed "per-step schema inference lives in `domain.engine`" is true.
  - `grep -LE 'def (apply|evaluate|run)\b' .../steps/*Step.scala` -> empty, i.e. all 27 `*Step` files define apply/evaluate/run; "runtime (apply/evaluate) logic" is true.
  - "config types": e.g. `FilterStep.scala:23 final case class FilterConfig`; four `*Step` files keep their config in a separate `*Config.scala` in the same directory — still true at directory level.
  - The misleading "re-verified (domain/shapes ...)" wording from round 1 is gone; D4 now requires each of lines 11-13 to be checked.
- Round-1 CR2 (per-clause check in tasks): tasks.md 1.3 now reads "Check lines 11-13 phrase by phrase per D4 (command + output each in `evidence/claims.md`); reword line 11's false 'infer'". Addressed.
- Round-1 non-blocking note (D2 "mostly one per step kind"): D2 now forbids "one per"/"mostly one per" and any name-correspondence claim between the 27 files and 27 kinds. Addressed.
- Lines 12-13: `ls domain/shapes/` -> `ShapeStepExpansion.scala`, `PipelineShape.scala`, etc. True.
- Counts re-checked: 27 `*Step.scala`; Registry `->` count 27 (per round 1; D1/D3 commands unchanged).
- HEL-1467-removed claims (`git show 5074b6937 -- .../steps/README.md`): removed "all 23 step kinds", "Two step kinds have no capability spec at all — `groupby` and `join`", "(23 step kinds, 21 `pipeline-*-op` specs)", "rests on no governing statement". D4 forbids the first two explicitly; the other two live only in sections the plan does not edit (proposal Non-goals, D4 "sole-config-trap and column-collision sections are not edited").
- Placeholders/contradictions: none found. Proposal, design D1-D5 and tasks 1.1-2.2 agree; `.openspec.yaml` `skip_specs: true` and no contract change, so no missing spec delta.
- AC coverage: AC1 -> D1/tasks 1.1-1.2; AC2 -> D1-D3; AC3 -> D4/tasks 1.3-1.5; AC4 -> Non-goals/task 2.2.

### Verdict: CONFIRM

### Non-blocking notes

- Task 1.5's grep list could also include "21 `pipeline-" and "no governing statement" (the other two HEL-1467 removals) for a complete zero-hit record; cheap to add.
- The new introduction should not state a bare count like "27 step kinds"/"27 step files" outside the snapshot label; that is the same shape as HEL-1467's removed "all 23 step kinds".
- Some files in `domain/steps/` hold helpers shared with inference (`JoinColumnNaming` scaladoc line 4; `ConvertFormatStep.scala:43`; `GroupByStep.scala:62`). "Per-step schema inference lives in `domain.engine`" stays true, but the executor should not phrase it as "nothing inference-related lives here".
