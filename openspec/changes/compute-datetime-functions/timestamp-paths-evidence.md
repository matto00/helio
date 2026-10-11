# Timestamp-typed field paths into compute (tasks.md 3.2)

Question (design D4): does any path deliver a JSON number to a compute step in a field whose analyze type is `timestamp`?
Method: grep of every producer of a `timestamp` projected type, then a throwaway probe spec
(`/home/matt/Development/helio/.concertino/runs/HEL-1314/evidence/HEL1314TimestampPathsProbeSpec.scala.probe`,
output in `probe-timestamp-paths.txt` in the same dir; removed from the tree).

| Path | Run-time value of a `timestamp`-typed field | Delivers a number? |
|---|---|---|
| `cast` to `timestamp`/`date` (`CastStep.castValue`) | the original value's `toString` (always `String`) | no |
| `datebucket` output (`ReshapeSchemaInference.inferDateBucket`) | `"yyyy-MM-dd"` string or null | no |
| JSON/REST/SQL schema inference (`SchemaInferenceEngine.inferJsonType`) | `timestamp` only from a `JsString`; a number is `integer`/`float`; a mixed column widens to `string` (`widenJson`). Sample-bound: a later row outside the sample could differ | no (sample caveat) |
| Dataset declared schema (`DatasetRowValidator.validateValue`) | `TimestampType` accepts only `JsString`; and `staticColumnRuntimeType` reports measured kinds (`string`/`float`), falling back to the declared type only for an all-null column | no |
| SQL `java.sql.Timestamp` | `PipelineRowJson.anyToJsValue` catch-all `toString` | no |
| Pass-through ops (filter/sort/limit/dedupe/select/rename/window lag-lead/pivot index/join/lookup secondary columns) | the upstream value, unchanged | inherits the producer |
| **`fillnull` with `mean`/`median`** | `StepSchemaInference` projects `fillnull` as identity (`timestamp` stays). `computeMean`/`computeMedian` coerce through `PipelineRowJson.toDouble`, which reads numeric strings. A `cast ... timestamp` keeps an epoch string (`"1771286400"`), so a mean/median fill writes a `Double` into the column | **YES** |
| **`union` of lanes** | `inferUnion`: "parent lane's own type wins on a name collision". A secondary lane whose same-named field is numeric supplies number values under the parent's `timestamp` | **YES** |

## Probe transcript (`probe-timestamp-paths.txt`)

```
after cast: List(1771286400, 1771286460, null) classes=List(Some(String), Some(String), None)
after fillnull mean: List(1771286400, 1771286460, 1.77128643E9) classes=List(Some(String), Some(String), Some(Double))
fillnull projection: Vector(SchemaField(ts,timestamp)) err=None
compute sees: 1.77128643E+9          (a JsNumber)
union projection: Vector(SchemaField(ts,timestamp))
```

## Conclusion

Two paths deliver a JSON number to compute under a `timestamp` projection (`fillnull` mean/median over epoch-valued timestamp
strings, and `union` with a numeric same-named field). Both fall under the standing instruction "if any path delivers a JSON number,
STOP and escalate", so the `+` inference change (tasks 3.3) has NOT been made. See the escalation raised with this file.

## Resolution (2026-10-11)

The owner ruled **A-ship-document-spinoffs** (escalation.answered in the run's events.jsonl): the `+` timestamp→string inference shipped as designed, the two residual paths are documented in `docs/compute-expression-grammar.md` ("Known limitation"), and both are tracked as spinoff HEL-1491.
