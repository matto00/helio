# HEL-1590 evidence (run in worktree)

### D1 *Step list (re-derive command output; matches README snapshot)
```
$ ls backend/src/main/scala/com/helio/domain/steps/*Step.scala | xargs -n1 basename | sed 's/\.scala$//'
AggregateStep
AnalyzeWithAiStep
AssertStep
CastStep
ChunkByTokenCountStep
ComputeStep
ConvertFormatStep
DateBucketStep
DedupeStep
ExtractHeadingsStep
FillNullStep
FilterStep
GenerateTextStep
GroupByStep
JoinStep
LimitStep
LookupStep
PivotStep
RenameStep
SelectStep
SortStep
SplitTextStep
StringOpsStep
UnionStep
UnpivotStep
UpsertSourceStep
WindowStep
[exit 0]
```

### D3 other files (matches README snapshot)
```
$ ls backend/src/main/scala/com/helio/domain/steps/*.scala | grep -v 'Step\.scala$' | xargs -n1 basename | sed 's/\.scala$//'
AnalyzeWithAiConfig
ConvertFormatConfig
GenerateTextConfig
JoinColumnNaming
SecondaryInput
StepCodecUtil
UpsertSourceConfig
UpsertTargetCheck
WindowRolling
[exit 0]
```

### Claim: README lists exactly the command output (A)
```
$ diff <(ls backend/src/main/scala/com/helio/domain/steps/*Step.scala | xargs -n1 basename | sed 's/\.scala$//') <(sed -n '/^Snapshot at HEL-1590: .Aggregate/p' backend/src/main/scala/com/helio/domain/steps/README.md | sed 's/^Snapshot at HEL-1590: //; s/\.$//' | tr ',' '\n' | tr -d ' `') && echo IDENTICAL
IDENTICAL
[exit 0]
```

### Claim: README support list matches (B)
```
$ diff <(ls backend/src/main/scala/com/helio/domain/steps/*.scala | grep -v 'Step\.scala$' | xargs -n1 basename | sed 's/\.scala$//') <(sed -n '/^Snapshot at HEL-1590: .AnalyzeWithAiConfig/p' backend/src/main/scala/com/helio/domain/steps/README.md | sed 's/^Snapshot at HEL-1590: //; s/\.$//' | tr ',' '\n' | tr -d ' `') && echo IDENTICAL
IDENTICAL
[exit 0]
```

### Claim: each *Step file declares a Step object/class/trait (transform step definitions); files lacking one
```
$ grep -LE '(object|class|trait) [A-Za-z]*Step\b' backend/src/main/scala/com/helio/domain/steps/*Step.scala; echo '(empty above = all declare one)'
(empty above = all declare one)
[exit 0]
```

### Claim: 'config types' exist (4 kinds keep config in *Config.scala; others in-file)
```
$ grep -nE 'case class [A-Za-z]*Config' backend/src/main/scala/com/helio/domain/steps/AnalyzeWithAiConfig.scala backend/src/main/scala/com/helio/domain/steps/ConvertFormatConfig.scala backend/src/main/scala/com/helio/domain/steps/GenerateTextConfig.scala backend/src/main/scala/com/helio/domain/steps/UpsertSourceConfig.scala backend/src/main/scala/com/helio/domain/steps/FilterStep.scala
backend/src/main/scala/com/helio/domain/steps/AnalyzeWithAiConfig.scala:21:final case class AnalyzeWithAiConfig(inputField: String, instruction: String, outputSchema: Vector[AnalyzeWithAiOutputField])
backend/src/main/scala/com/helio/domain/steps/ConvertFormatConfig.scala:15:final case class ConvertFormatConfig(field: String, from: String, to: String, outputField: String)
backend/src/main/scala/com/helio/domain/steps/GenerateTextConfig.scala:17:final case class GenerateTextConfig(inputField: String, instruction: String, outputField: String)
backend/src/main/scala/com/helio/domain/steps/UpsertSourceConfig.scala:147:final case class UpsertSourceConfig(target: UpsertTarget, mode: String)
backend/src/main/scala/com/helio/domain/steps/FilterStep.scala:23:final case class FilterConfig(combinator: String, conditions: Vector[FilterCondition])
[exit 0]
```

### Claim: runtime apply/evaluate/run defined in every *Step file (files lacking)
```
$ grep -LE 'def (apply|evaluate|run)\b' backend/src/main/scala/com/helio/domain/steps/*Step.scala; echo '(empty = all define)'
(empty = all define)
[exit 0]
```

### Claim (old 'infer' false): no def infer in steps/
```
$ grep -rn -i 'def infer' backend/src/main/scala/com/helio/domain/steps/ | wc -l
0
[exit 0]
```

### Claim: no def infer/inferSchema/outputSchema in steps/*.scala (files)
```
$ grep -lE 'def (infer|inferSchema|outputSchema)' backend/src/main/scala/com/helio/domain/steps/*.scala | wc -l
0
[exit 0]
```

### Claim: per-step schema inference lives in domain.engine
```
$ ls backend/src/main/scala/com/helio/domain/engine | grep SchemaInference; grep -n 'object StepSchemaInference' backend/src/main/scala/com/helio/domain/engine/StepSchemaInference.scala
ColumnSchemaInference.scala
MultiInputSchemaInference.scala
ReshapeSchemaInference.scala
SchemaInferenceEngine.scala
StepSchemaInference.scala
TextSchemaInference.scala
15:private[engine] object StepSchemaInference {
[exit 0]
```

### Claim: shape-level expansion lives in domain.shapes
```
$ ls backend/src/main/scala/com/helio/domain/shapes; grep -n 'def expand' backend/src/main/scala/com/helio/domain/shapes/PipelineShape.scala
OutputContract.scala
PassthroughShape.scala
PipelineShape.scala
PivotMatrixShape.scala
README.md
ShapeParamDescriptor.scala
ShapeStepExpansion.scala
SingleRowShape.scala
TimeSeriesShape.scala
TopNShape.scala
34:  def expand(params: JsObject): Either[String, Vector[ShapeStepExpansion]]
[exit 0]
```

### Claim: no HEL-1467-removed phrase, no 'one file per', no bare count in edited intro (lines 1-25)
```
$ sed -n 1,25p backend/src/main/scala/com/helio/domain/steps/README.md | grep -n -i -E 'all 23 step kinds|Two step kinds have no capability spec|21 .pipeline-|no governing statement|one file per|one per|[0-9]+ step|bless'; echo '[grep hits above; none = zero]'
[grep hits above; none = zero]
[exit 0]
```

### Claim: intro makes no 'nothing inference-related here' claim (C2)
```
$ sed -n 1,25p backend/src/main/scala/com/helio/domain/steps/README.md | grep -n -i 'infer'
23:(apply/evaluate) logic; per-step schema inference lives in `domain.engine`.
[exit 0]
```

### Gate: prettier
```
$ npx prettier --check backend/src/main/scala/com/helio/domain/steps/README.md
Checking formatting...
All matched files use Prettier code style!
[exit 0]
```
