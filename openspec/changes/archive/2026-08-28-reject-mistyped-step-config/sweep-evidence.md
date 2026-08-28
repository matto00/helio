# Task 5.1 — silent-drop sweep: raw unabridged enumeration

Captured at commit `a97431e4`, 2026-08-28.

AC4 was **corrected inline during planning** (standing requirement 4). The original wording — "a re-run of
the sweep finds no remaining instances" — is unsignable, because the design gate refuted the premise it
rested on. The corrected AC requires: enumerate every file, record the raw output, classify every hit, and
record the unaddressed hits as known-remaining with a follow-up ticket.

**The ticket's "exactly two files" premise was FALSE.** The tolerant-decode pattern is present in
essentially every step decoder, because read-path tolerance is a documented, deliberate contract
(`PipelineStep.Companion.decodeConfig`). The fix here is bounded by the ticket, not by the pattern's extent.
Follow-up: **HEL-871**.

## Command

```bash
cd backend/src/main/scala/com/helio/domain/steps
for f in *.scala; do
  echo "### $f"
  awk '/def decode\(raw: String\)/,/^  }$/' "$f" \
    | grep -n 'getOrElse\|case _\|collect\|flatMap\|toOption\|stringOr\|intOr'
done
```

24 `.scala` files in `domain/steps/`: 23 step files, each with its own `decode`, plus `StepCodecUtil.scala`
(the shared helper, which has no decoder of its own and correctly produces no hits).

## Raw output, all 24 files, unabridged

```
### AggregateStep.scala
    5:        items.flatMap(it => Try(it.convertTo[AggregateField]).toOption)
    6:      case _ => Vector.empty[AggregateField]
    10:        items.flatMap(it => Try(it.convertTo[Aggregation]).toOption)
    11:      case _ => Vector.empty[Aggregation]
### AssertStep.scala
    5:      case _                    => Vector.empty[AssertRule]
### CastStep.scala
    4:      case Some(o: JsObject) => Try(o.convertTo[Map[String, String]]).getOrElse(Map.empty)
    5:      case _                 => Map.empty[String, String]
### ChunkByTokenCountStep.scala
    3:    val field            = StepCodecUtil.stringOr(obj, "field", "")
    4:    val targetTokenCount = StepCodecUtil.intOr(obj, "targetTokenCount", 500)
    5:    val encodingRaw      = StepCodecUtil.stringOr(obj, "encoding", "o200k_base")
    7:    val indexField       = StepCodecUtil.stringOr(obj, "indexField", "chunkIndex")
    8:    val tokenCountField  = StepCodecUtil.stringOr(obj, "tokenCountField", "tokenCount")
### ComputeStep.scala
    3:    val column     = StepCodecUtil.stringOr(obj, "column", "")
    4:    val expression = StepCodecUtil.stringOr(obj, "expression", "")
    7:      case _                 => None
### DateBucketStep.scala
    3:    val field       = StepCodecUtil.stringOr(obj, "field", "")
    4:    val granularity = StepCodecUtil.stringOr(obj, "granularity", "")
    7:      case _                 => None
### DedupeStep.scala
    4:      case Some(JsArray(items)) => items.collect { case JsString(s) => s }
    5:      case _                    => Vector.empty[String]
    9:    val keep = if (StepCodecUtil.stringOr(obj, "keep", "first") == "last") "last" else "first"
### ExtractHeadingsStep.scala
    3:    val field      = StepCodecUtil.stringOr(obj, "field", "")
    4:    val indexField = StepCodecUtil.stringOr(obj, "indexField", "headingIndex")
    5:    val levelField = StepCodecUtil.stringOr(obj, "levelField", "headingLevel")
### FillNullStep.scala
    4:      case Some(JsArray(items)) => items.collect { case JsString(s) => s }
    5:      case _                    => Vector.empty[String]
    7:    val strategy = StepCodecUtil.stringOr(obj, "strategy", "")
    8:    val value    = obj.fields.get("value").collect { case JsString(s) => s }
### FilterStep.scala
    3:    val combinator = StepCodecUtil.stringOr(obj, "combinator", "AND")
    6:        items.flatMap(it => Try(it.convertTo[FilterCondition]).toOption)
    7:      case _ => Vector.empty[FilterCondition]
### GroupByStep.scala
    4:      case Some(JsArray(items)) => items.collect { case JsString(s) => s }
    5:      case _                    => Vector.empty[String]
    7:    val aggColumn   = StepCodecUtil.stringOr(obj, "aggColumn", "")
    8:    val aggFunction = StepCodecUtil.stringOr(obj, "aggFunction", "sum")
### JoinStep.scala
    3:    val rId  = StepCodecUtil.stringOr(obj, "rightDataSourceId", "")
    4:    val key  = StepCodecUtil.stringOr(obj, "joinKey", "")
    5:    val jt   = StepCodecUtil.stringOr(obj, "joinType", "inner")
### LimitStep.scala
    4:      case Some(JsNumber(n)) => Try(n.toIntExact).getOrElse(0)
    5:      case _                 => 0
### LookupStep.scala
    3:    val refId = StepCodecUtil.stringOr(obj, "referenceDataSourceId", "")
    4:    val srcKey = StepCodecUtil.stringOr(obj, "sourceKey", "")
    5:    val lookupKey = StepCodecUtil.stringOr(obj, "lookupKey", "")
    7:      case Some(JsArray(items)) => items.collect { case JsString(s) => s }
    8:      case _                    => Vector.empty[String]
### PivotStep.scala
    4:      case Some(JsArray(items)) => items.collect { case JsString(s) => s }
    5:      case _                    => Vector.empty[String]
    7:    val column = StepCodecUtil.stringOr(obj, "column", "")
    8:    val values = StepCodecUtil.stringOr(obj, "values", "")
    9:    val agg    = StepCodecUtil.stringOr(obj, "agg", "")
### RenameStep.scala
    4:      case Some(o: JsObject) => Try(o.convertTo[Map[String, String]]).getOrElse(Map.empty)
    5:      case _                 => Map.empty[String, String]
### SelectStep.scala
    4:      case Some(JsArray(items)) => items.collect { case JsString(s) => s }
    5:      case _                    => Vector.empty[String]
### SortStep.scala
    5:        items.flatMap(it => Try(it.convertTo[SortKey]).toOption)
    6:      case _ => Vector.empty[SortKey]
### SplitTextStep.scala
    3:    val field        = StepCodecUtil.stringOr(obj, "field", "")
    4:    val mode         = StepCodecUtil.stringOr(obj, "mode", "paragraph")
    5:    val headingLevel = StepCodecUtil.intOr(obj, "headingLevel", 1)
    6:    val indexField   = StepCodecUtil.stringOr(obj, "indexField", "segmentIndex")
### StepCodecUtil.scala
### StringOpsStep.scala
    3:    val operation     = StepCodecUtil.stringOr(obj, "operation", "")
    4:    val field         = StepCodecUtil.stringOr(obj, "field", "")
    5:    val outputColumn  = StepCodecUtil.stringOr(obj, "outputColumn", "")
    6:    val pattern       = obj.fields.get("pattern").collect { case JsString(s) => s }
    7:    val separator     = obj.fields.get("separator").collect { case JsString(s) => s }
    9:      case Some(JsNumber(n)) => Try(n.toIntExact).toOption
    10:      case _                 => None
    13:      case Some(JsArray(items)) => Some(items.collect { case JsString(s) => s })
    14:      case _                    => None
### UnionStep.scala
    3:    val dsId = StepCodecUtil.stringOr(obj, "otherDataSourceId", "")
    4:    val mode = StepCodecUtil.stringOr(obj, "mode", "byPosition")
### UnpivotStep.scala
    4:      case Some(JsArray(items)) => items.collect { case JsString(s) => s }
    5:      case _                    => Vector.empty[String]
    8:      case Some(JsArray(items)) => items.collect { case JsString(s) => s }
    9:      case _                    => Vector.empty[String]
    11:    val varName   = StepCodecUtil.stringOr(obj, "varName", "variable")
    12:    val valueName = StepCodecUtil.stringOr(obj, "valueName", "value")
### WindowStep.scala
    4:      case Some(JsArray(items)) => items.collect { case JsString(s) => s }
    5:      case _                    => Vector.empty[String]
    8:      case Some(JsArray(items)) => items.flatMap(it => Try(it.convertTo[SortKey]).toOption)
    9:      case _                    => Vector.empty[SortKey]
    11:    val function     = StepCodecUtil.stringOr(obj, "function", "")
    12:    val field        = obj.fields.get("field").collect { case JsString(s) => s }
    13:    val outputColumn = StepCodecUtil.stringOr(obj, "outputColumn", "")
    15:      case Some(JsNumber(n)) => Try(n.toIntExact).toOption
    16:      case _                 => None
```

## Classification

**Fixed by this change (2 files)** — the two the field report caught:
- `CastStep.scala:22-26` — `casts`
- `RenameStep.scala:22-26` — `renames`

**Known-remaining, tracked in HEL-871 (21 files).** Grouped by shape:
- Non-array value collapses to `Vector.empty` via `items.collect { case JsString(s) => s }`:
  `SelectStep`, `GroupByStep`, `DedupeStep`, `FillNullStep`, `LookupStep`, `PivotStep`, `UnpivotStep` (x2),
  `WindowStep`
- Per-element `Try(...).toOption` swallow (drops the bad element, keeps the rest — a partial config that
  looks complete): `AggregateStep` (x2), `FilterStep`, `SortStep`, `WindowStep`
- `stringOr`/`intOr` substituting a default for a wrong-typed value: `ChunkByTokenCountStep`, `ComputeStep`,
  `DateBucketStep`, `DedupeStep`, `ExtractHeadingsStep`, `FillNullStep`, `FilterStep`, `GroupByStep`,
  `JoinStep`, `LookupStep`, `PivotStep`, `SplitTextStep`, `StringOpsStep`, `UnionStep`, `UnpivotStep`,
  `WindowStep`
- Wrong-typed optional scalar to `None`: `StringOpsStep` (`pattern`, `separator`), `FillNullStep` (`value`),
  `WindowStep` (`field`)
- `AssertStep:50-73` — its own tier: a non-object rule element degrades to an **all-defaults rule**, i.e. a
  rule is silently *invented* rather than dropped.

**Highest-severity known-remaining: `GroupByStep`.** `{"groupBy":"region"}` — the obvious shape for a single
grouping column — is not a `JsArray`, so it hits `case _ => Vector.empty`. Every row then maps to the same
empty key AND the grouping column vanishes from the output: "revenue by region" returns one untagged total.
That is strictly worse than the `cast`/`rename` no-ops fixed here, which are at least inert; this computes a
different, plausible answer. Prioritised first in HEL-871.

**No hits (1 file):** `StepCodecUtil.scala` — the helper itself, no decoder.
