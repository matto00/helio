## Why

`LookupStep` merges `leftRow ++ brought`; when a requested `columns` name equals a left column, the brought value silently overwrites the left value (on a no-match row, a `null` overwrites it). Analyze-time `inferLookup` mirrors this (`filterNot` + `:+`). HEL-1236 fixed the same defect for `join`; the owner ruled lookup follows the identical rule: auto-prefix, never error, never drop a value.

## What Changes

- `LookupStep.evaluate` and `PipelineAnalyzeService.inferLookup` both derive output names from the shared `JoinColumnNaming` rule (HEL-1236), so a requested column clashing with a left column is exposed as `right_<name>` (then `right_<name>_2`, ...), in sorted-name order. The left column keeps its name and value.
- Lookup's "key" semantics (see design): the duplicate-key drop applies only when `sourceKey == lookupKey` and that name is a requested column and a left column; otherwise a requested column is an ordinary column.
- `JoinColumnNaming` gains a small shared core taking an optional dropped-key so `join` and `lookup` run through the same prefixing code; `resolve` keeps its signature and behavior.
- BREAKING (owner-accepted): existing pipelines with a colliding lookup column now expose the looked-up value under `right_<name>`, and the original name reads the left/base value.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-lookup-op`: collision requirement replaced (prefix, not overwrite); analyze-inference requirement updated to the same naming.

## Impact

`backend/.../steps/JoinColumnNaming.scala`, `LookupStep.scala`, `PipelineAnalyzeService.inferLookup`, steps README, tests (`LookupColumnCollisionSpec`, helper spec, existing lookup tests asserting overwrite), PR body notes. No Spark change (no lookup there), no migration.
