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

## The sole-config trap (HEL-814)

When declaring whether a step's config field is **required**, a field being the
_sole or principal_ config of its step kind is a **red flag prompting a spec
check — not evidence that the field is required**. "The step does nothing
without it" reads true and is wrong surprisingly often: HEL-814 enumerated
every field across all 23 step kinds and found **eight** where a shipped
capability spec explicitly blesses the empty or absent value.

Get this wrong in the "required" direction and you break a config a user
legitimately saved — including the unconfigured drafts the step editor's
add-then-configure flow creates, which exist in production right now.

**The eight, with the spec line that governs each:**

| Field                   | Governing statement                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `limit.count`           | `pipeline-limit-op` — missing, zero or negative returns all rows (safe no-op)                                  |
| `sort.sortBy`           | `pipeline-sort-op` — an empty `sortBy` is a no-op                                                              |
| `cast.casts`            | `pipeline-cast-op` — an empty casts map is a no-op                                                             |
| `rename.renames`        | `pipeline-rename-op` — an empty renames map is a no-op                                                         |
| `filter.conditions`     | `pipeline-filter-op` — an empty `conditions` array passes all rows                                             |
| **`select.fields`**     | `pipeline-select-op` — an empty fields list produces **empty rows**                                            |
| **`dedupe.keys`**       | `pipeline-dedupe-op` — empty means **whole-row distinct**                                                      |
| **`unpivot.valueVars`** | `pipeline-unpivot-op` — output row count is `(input rows) x (valueVars length)`, so empty yields **zero rows** |

**The three in bold are the dangerous ones.** For the other five an empty value
is _inert_ — a no-op or a pass-through — so mis-marking them required produces a
spurious failure, which is loud and quickly caught. For `select.fields`,
`dedupe.keys` and `unpivot.valueVars` an empty value is **behaviour-defining**:
it selects a different, fully-specified algorithm. Mis-marking one of those
required does not fail loudly — it silently changes what the pipeline computes,
which is the exact class of defect HEL-814 exists to close.

**So: start from the field and go find its spec, not from a pattern and hope it
matches.** HEL-814 needed four distinct grep vocabularies to find these, and
each new vocabulary found guarantees the previous one had missed — tolerance is
written as `defaults to` / `falls back`, as `no-op` / `SHALL return all`, as
`empty <X> map/array`, and as `when <X> is empty`. Pattern-matching the specs is
not a completeness check. Reading the requirement text for the specific field
you are about to mark required is.

**Two step kinds have no capability spec at all — `groupby` and `join`**
(23 step kinds, 21 `pipeline-*-op` specs). For those, requiredness currently
rests on no governing statement; see HEL-900. Prefer the conservative
(optional) reading there until a spec exists, and record that you did so.
