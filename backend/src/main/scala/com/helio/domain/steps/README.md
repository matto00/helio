# Domain: Steps

Pipeline transform step definitions — one file per step type (`AggregateStep`,
`AssertStep`, `CastStep`, `ChunkByTokenCountStep`, `ComputeStep`,
`DateBucketStep`, `DedupeStep`, `ExtractHeadingsStep`, `FillNullStep`,
`FilterStep`, `GroupByStep`, `JoinStep`, `LimitStep`, `LookupStep`,
`PivotStep`, `RenameStep`, `SelectStep`, `SortStep`, `SplitTextStep`,
`StringOpsStep`, `UnionStep`, `UnpivotStep`, `WindowStep`), plus
`StepCodecUtil` (shared codec helpers).

**Belongs here:** individual step config types and their apply/infer logic.
**Does not belong here:** shape-level expansion into a sequence of steps,
which lives in `domain.shapes`.
