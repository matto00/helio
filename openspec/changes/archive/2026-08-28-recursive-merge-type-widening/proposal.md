## Why

`SchemaInferenceEngine.mergeObjects` merges sampled JSON rows non-recursively and keeps the first
non-null value it sees for each key. So a nested object from row 0 wins wholesale (later rows'
sub-keys never join the schema) and a column whose first value is integral is typed `IntegerType`
forever (later fractional values truncate). The inferred schema therefore depends on result
*ordering*, not on the data: the live Sleeper projections endpoint drops the entire `stats.rec*`
family — the single most important column set for a PPR fantasy tool — purely because a QB sorted
first. The same URL can infer differently between two refreshes.

## What Changes

- Replace the object-level merge with a merge over the *dotted leaf paths* `JsonFlattener.leaves`
  already produces (HEL-599 shipped that traversal and explicitly reserved this move for HEL-858).
  Unioning path sets makes the recursion requirement fall out structurally rather than being
  reimplemented as a second recursive walk that could drift from the flattener.
- Introduce an explicit, documented type-widening lattice for JSON, deliberately DIVERGING from the
  order-sensitive widening the CSV path uses (which would type a mixed number/boolean column as
  boolean and break order-independence), replacing first-value-wins. Any fractional value in a column ⇒ `FloatType`; genuinely mixed scalar kinds
  fall back to `StringType`.
- Preserve today's null-tracking semantics exactly: a path is `nullable` iff some sampled object
  carries `JsNull` at it. Key *absence* continues not to imply nullability.
- Make the inferred schema provably order-independent, and keep the schema projection and the row
  projection in agreement under adversarial input (colliding dotted keys, dots inside keys,
  unicode/empty keys, nulls, heterogeneous rows, depth-bound objects).

Schemas change for heterogeneous sources — that is the fix, not a regression. One change also reaches
single-shape sources and must not be understated: today a single `JsNull` anywhere in a sampled column
forces it to `StringType`, so any column with a null re-infers as a nullable numeric/boolean/timestamp
instead. That is a NARROWING, it is deliberate (design D7), and a panel bound to such a column
expecting a string is the real exposure. No persisted DataType is rewritten; the flip occurs only when
a source is re-inferred.

## Non-goals

- Changing `JsonFlattener` itself. Its traversal, depth bound, array-as-leaf rule and duplicate-path
  resolution are all correct for this ticket and stay untouched.
- Sampling more rows, capping rows sampled, or any change to how many rows reach inference. The
  field report's "reads only the first row" diagnosis is wrong; row count is not the defect.
- Array index expansion, schema migration of already-persisted DataTypes, or re-inference of
  existing sources.
- Treating an absent key as nullable (deliberately deferred; see design).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `schema-inference`: JSON inference over an array of objects becomes a union-and-widen over leaf
  paths — order-independent, recursive through nested objects, with a specified widening lattice —
  instead of a non-recursive first-value-wins object merge.

## Impact

- `backend/src/main/scala/com/helio/domain/engine/SchemaInferenceEngine.scala` (`fromJson`,
  `mergeObjects` removed/replaced, `flattenObject`, `inferJsonType`, widening helper).
- Read-only consumers of the resulting schema: `SourceService` preview, DataType creation from REST
  sources, and every downstream panel binding. No API or wire-shape change.
- `backend/src/test/.../SchemaInferenceEngineSpec`, `NestedJsonFlatteningSymmetrySpec`, plus a new
  mixed-position Sleeper fixture captured from the live endpoint.
