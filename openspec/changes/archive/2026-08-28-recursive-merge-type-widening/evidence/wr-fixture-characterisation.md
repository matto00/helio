# WR-only fixture characterisation — HEL-858 task 3.10

Field-by-field comparison of `backend/src/test/resources/hel599/sleeper-wr-projections-slice.json`'s
inferred schema, pre-fix (`SchemaInferenceEngine.mergeObjects`) vs post-fix
(`SchemaInferenceEngine.inferFromObjects`). Produced by dumping both schemas (name/type/nullable,
sorted by name) from the same fixture under each version of the source, via the same
stash/run/pop procedure used for `evidence/red-verification.md`.

Field-name set is **identical** on both sides (63 fields, no additions or removals) — this is a
single-shape source with no cross-row leaf-vs-subtree collision (design D5), so the recursion fix
does not change which columns exist here. Two fields differ in `nullable`:

| Field | Pre-fix | Post-fix | Type change? |
|---|---|---|---|
| `player.injury_body_part` | `StringType`, `nullable = false` | `StringType`, `nullable = true` | No |
| `player.injury_status` | `StringType`, `nullable = false` | `StringType`, `nullable = true` | No |

Two more fields differ in `dataType` (legitimate widening, unrelated to the above):

| Field | Pre-fix | Post-fix |
|---|---|---|
| `stats.pts_half_ppr` | `IntegerType` | `FloatType` |
| `stats.rec_fd` | `IntegerType` | `FloatType` |

No other field changes name, type, or nullability.

## Classification

**`stats.pts_half_ppr` / `stats.rec_fd` (integer → float): legitimate widening.** The fixture's 3
elements carry both integral and fractional values at these paths across different rows; the D3
lattice correctly widens to `FloatType` once all 3 rows are examined per-path instead of only the
first row's value. Not a narrowing, not a defect — this is the ticket's own fix working as
intended on a single-shape source.

**`player.injury_body_part` / `player.injury_status` (nullable false → true): NEITHER legitimate
widening NOR a D7 null-rule flip.** It is the unchanged D2 nullability rule ("explicit `JsNull`
anywhere ⇒ nullable") reaching a *nested* path for the first time — an inseparable consequence of
fixing defect 1 (the non-recursive merge), not a change to the rule itself.

- Fixture data: element 0 has `player.injury_body_part = "Undisclosed"`, element 1 has `"Knee"`,
  element 2 has `null` (same pattern for `player.injury_status`: `"Questionable"`,
  `"Questionable"`, `null`).
- Pre-fix: `mergeObjects` merges only top-level keys, first-non-null-wins. `player` is a
  `JsObject`, never itself `JsNull`, so element 0's whole `player` subtree wins wholesale. The
  `withNulls` second pass only ever writes `JsNull` at a *top-level* key — it never looks inside
  `player` — so element 2's nested null at `player.injury_body_part` is invisible. Result:
  `nullable = false`.
- Post-fix: `inferFromObjects` unions leaf paths (via `JsonFlattener.leaves`) across every
  element, so element 2's explicit `JsNull` at `player.injury_body_part` is seen directly at its
  own path. Result: `nullable = true`.
- The inferred *type* (`StringType`) is unchanged in both directions — this is not a D7 case (D7
  is specifically a type change, `string → numeric`, triggered by `JsNull` no longer forcing
  `StringType` when non-null values elsewhere are numeric).
- Direction is `false → true`: strictly more accurate, never a silent loss of nullability
  information. A consumer that previously assumed this column was never null was already wrong;
  it now sees the truth.

This is pinned in code by
`backend/src/test/scala/com/helio/domain/engine/SchemaInferenceEngineSpec.scala`'s "characterise
the existing WR-only fixture's inferred schema field-by-field" test (task 3.10), which asserts
both flipped fields' `nullable = true` directly, so a future regression on this exact behaviour
fails loudly rather than requiring another manual diff.

See also `design.md` D2, which now states this consequence normatively rather than claiming
nullability is unchanged in every respect.
