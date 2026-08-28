# HEL-599: Nested JSON: flatten to dotted columns in rows, not just in the inferred schema

## Description

Schema inference and row materialisation disagree about nesting, so a `rest_api` (or `sql`) source over nested JSON produces a DataType advertising dotted columns that the rows never carry.

- `SchemaInferenceEngine.flattenObject` (`SchemaInferenceEngine.scala:101`) **recurses** into nested objects, emitting correctly-typed dotted fields — `stats.pts_ppr` as `float`, `player.first_name` as `string`.
- `PipelineRowJson.jsRowToRow` (`PipelineRowJson.scala:87`) is a **one-level** map. A nested `JsObject` value falls through `jsValueToAny`'s `case other => other.compactPrint` and lands as a raw JSON **string** under the top-level key.

Every consumer of a dotted column silently receives `null`. Found in field testing against the live Sleeper NFL API (`/home/matt/Development/fantasy/docs/helio-issues.md`, issue #1); it forced abandoning the pipeline approach entirely in favour of pre-flattening to CSV outside Helio. Urgent blocker leaf of epic HEL-857 (agent-authored external-API ingestion), v1.7.

### Observed

```json
{ "player_id": "8800", "team": "DAL",
  "player": "{\"first_name\":\"Malik\",\"last_name\":\"Davis\",...}",
  "stats":  "{\"adp_ppr\":999.0,\"pts_ppr\":33.7,\"rec\":6.0,...}" }
```

…against a DataType whose fields include `player.first_name` and `stats.pts_ppr`.

### Expected

Rows carry the dotted columns the inferred schema promises, populated and correctly typed.

### No pipeline step can work around it

All four candidates were tested in the field and none reach the nested data: `lookup` with a nested `columns` entry returns null; `select` with dotted `fields` silently drops them; `compute` with `expression: "stats.pts_ppr"` errors; `stringops` regex over the JSON string validates clean then 422s at run time.

## Scope correction from premise validation (2026-08-28)

The ticket text carries a "Root selection (original scope, retained)" bullet written before sibling **HEL-826** merged. Verified on the base branch: `RestApiConfig.rootSelector` / `EphemeralRestConfig.rootSelector` (`model.scala:522,566`) and `RestApiConnectorDriver.toRows(json, rootSelector)` (`RestApiConnectorDriver.scala:236`) already exist and work. `toRows`' own comment states the hand-off explicitly: a missing/invalid path "yields `Vector.empty` (curated-empty, not a 500) plus a server-side warn log — HEL-599 owns the real user-facing error envelope."

So the selector implementation is **not** rebuilt here. What remains of that sub-scope is the curated-error criterion only; the two already-satisfied selector criteria are held by regression tests that pin the shipped behaviour against drift from this change.

## Sibling boundary — HEL-858

HEL-858 (recursive schema-inference merge with type widening) is delivered immediately after this and touches the same nested traversal. Today `SchemaInferenceEngine.mergeObjects` keeps the first non-null value per key, so nested sub-keys present only in later rows are never merged — the field report's issue #2. The shared traversal helper extracted here must be shaped so 858 can add widening inside it. **858's widening is explicitly not implemented here.**

## Acceptance criteria

- [ ] A nested-JSON source produces rows whose dotted columns are populated and typed as the DataType advertises — verified against genuinely nested data, and against the live Sleeper projections endpoint (`https://api.sleeper.app/projections/nfl/2026?season_type=regular&order_by=pts_ppr&position[]=WR`), not only a fixture.
- [ ] Schema and rows are generated through shared traversal logic, so a nested field appearing in one necessarily appears in the other; a regression test asserts this symmetry directly, over nested input.
- [ ] Nested-array behaviour (array-of-scalars vs array-of-objects) is deliberately decided, documented, and covered by tests.
- [ ] Flattening depth is bounded, and the bound's behaviour at the limit is defined and tested.
- [ ] A response with rows under a nested key is located via the selector and produces the expected rows (regression pin over already-shipped HEL-826 behaviour).
- [ ] An unset selector reproduces today's `toRows` behaviour exactly for existing REST sources (regression pin).
- [ ] A missing/invalid selector path yields a curated `fetchError` (HEL-468 envelope), not a 500 and not a silent empty success.
- [ ] Existing non-nested REST/SQL rows are byte-identical to today — no top-level key changes shape.
- [ ] The image connector's nested `content` `Map` row value (HEL-216) is unaffected; `PipelineRowJson.anyToJsValue`'s `Map` case keeps working.
- [ ] ScalaTest covering nested flatten, array handling, depth bound, schema/row symmetry, nested selection, curated selector error, and the unset default.

## Out of scope

- Pagination, OAuth2, rate-limit (own tickets).
- HEL-858's recursive/type-widening inference merge.
- A general-purpose transform language (that is the pipeline layer's job).

## Verification trap to avoid

A passing test over a fixture proves nothing if the fixture is already flat. Every flatten assertion must run over genuinely nested input, and the live-endpoint check is a required acceptance criterion, not an optional extra.
