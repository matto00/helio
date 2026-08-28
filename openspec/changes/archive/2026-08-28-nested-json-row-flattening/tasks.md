# Tasks — HEL-599

## 1. Shared traversal

- [x] 1.1 Add `JsonFlattener` to `com.helio.domain.engine` with `MaxDepth = 10` and
      `leaves(obj: JsObject): Seq[(String, JsValue)]` returning `(dotted path, leaf JsValue)` pairs sorted by
      path. Objects recurse; arrays and all non-objects are leaves; an object at `MaxDepth` is a leaf. No type
      inference and no value conversion inside it — structure only (design D1).
- [x] 1.2 Scaladoc the contract: why it exists (the two paths must not drift), array-as-leaf and its rejected
      alternative, the depth bound's degrade-not-fail behaviour, collision ordering, and the note that it is
      per-object with no merge policy so HEL-858 can merge over paths (design D2, D3, D4, D8).

## 2. Wire schema inference to it

- [x] 2.1 Reimplement `SchemaInferenceEngine.flattenObject` as a projection of `JsonFlattener.leaves` through
      the existing `inferJsonType`/`displayName`. Do not move typing logic into the flattener.
- [x] 2.2 Confirm `mergeObjects` is untouched — first-non-null-wins stays exactly as-is (design D8; HEL-858
      owns it). No widening, no recursive merge in this change.

## 3. Wire row materialisation to it

- [x] 3.1 Reimplement `PipelineRowJson.jsRowToRow`'s `JsObject` branch as a projection of
      `JsonFlattener.leaves` through the existing `jsValueToAny`.
- [x] 3.2 Leave the non-object fallback (`Map("value" -> ...)`) unchanged.
- [x] 3.3 Leave `anyToJsValue`'s `Map` case unchanged and add a test pinning it — the image connector's HEL-216
      `content` BinaryRef depends on it and does not flow through `jsRowToRow` (design D6).
- [x] 3.4 Leave `parseStaticRows` unchanged (static columns are declared, never inferred).
- [x] 3.5 Add `JsonFlattener.flattenJsObject(obj: JsObject): JsObject` (leaves → flat `JsObject`) and apply it
      to `SourceService.previewRest`'s rows before `applyComputedFields`, so preview, the advertised schema, and
      the executed rows all agree (design D6). Preview is the surface a user checks a `rootSelector` against;
      leaving it unflattened would create a new divergence rather than remove one.

## 4. Curated selector error

- [x] 4.1 Add `RestApiConnectorDriver.toRowsEither(json, rootSelector): Either[String, Vector[JsValue]]`.
      `Left` only for a supplied selector whose walk fails (missing segment, or descending through a
      non-object); every other outcome including a genuinely empty array is `Right`.
- [x] 4.2 Curated message names the selector and the failing segment only — no response body, no header, no
      credential. Keep the existing server-side warn log.
- [x] 4.3 Keep `toRows` as the unset-selector wrapper so the byte-identical criterion is verifiable against an
      unchanged function.
- [x] 4.4 Thread `Left` through all **four** call sites (`inferSchema` :320, row fetch :325,
      `inferSchemaEphemeral` :387, and `SourceService.previewRest` `SourceService.scala:342`). The first three
      land in the existing `fetchError` envelope; `previewRest` returns `ServiceError.BadGateway(err)` reusing
      the HEL-311 curated pass-through already at `SourceService.scala:336-340`. Verify
      `InProcessPipelineEngine.loadRows` fails the run on `Left` rather than yielding zero rows.

## 5. Tests

- [x] 5.1 `JsonFlattener` unit tests: nested object → dotted leaves and no parent key; multi-level; top-level
      scalars unchanged; empty nested object contributes nothing; array-of-scalars and array-of-objects each a
      single leaf with no index paths; array nested inside an object; object at `MaxDepth` becomes a leaf; input
      far beyond the bound does not error and drops no top-level column; dotted-key collision is deterministic
      and stable.
- [x] 5.2 **Symmetry regression test** (the criterion): assert `inferredFieldNames(rowObj) ==
      materialisedColumnKeys(rowObj)` **per row object**, over several genuinely nested inputs. Scope this
      per-object deliberately: cross-row merge (`mergeObjects`) legitimately under-reports nested sub-keys today
      (design D8 residual, HEL-858's territory), so a whole-array symmetry assertion would fail against a
      *correct* implementation and misdiagnose the fix. Confirm the test fails on the pre-fix code before
      relying on it (design D7.1).
- [x] 5.3 **Negative control**: assert the old shape is gone — no column holding JSON text beginning with `{`,
      and no `stats` column coexisting with `stats.pts_ppr` (design D7.2).
- [x] 5.4 Capture a verbatim slice of the live Sleeper projections response as a test resource (a few players,
      values unmodified) and drive 5.2/5.3 from it — 5.2 row-by-row (per 5.2's per-object scoping), 5.3/5.5 over
      the whole slice. Keep the third-level `player.metadata` key in the trimmed slice so multi-level nesting is
      exercised by real data. Do not hand-write it (design D7.3).
- [x] 5.5 Type-correctness test: `stats.pts_ppr` materialises as a number matching the `float` the schema
      advertises, and `player.first_name` as its string — not as text.
- [x] 5.6 Selector tests: nested-key selection produces expected rows; unset selector byte-identical to today;
      missing segment → curated `fetchError`; non-object mid-walk → curated `fetchError`; selector resolving to
      a genuinely empty array → success with zero rows, NOT an error; curated message leaks no body or
      credential.
- [x] 5.7 Flat-row regression: a REST/SQL response with no nested object materialises identically to before.
- [x] 5.8 `select` with `stats.pts_ppr` retains the column (the field report's failing case).
- [x] 5.9 Preview test: `previewRest` over a nested response returns flat dotted keys matching the inferred
      schema; and a broken `rootSelector` returns `BadGateway` with the curated message, not a 200 with zero rows.

## 6. Live verification

- [x] 6.1 Run the live probe against
      `https://api.sleeper.app/projections/nfl/2026?season_type=regular&order_by=pts_ppr&position[]=WR`:
      create the source, run a pipeline, read rows back, and confirm dotted columns are populated and typed.
- [x] 6.2 Persist the transcript as run evidence. Do NOT add a network-dependent test to the commit gate
      (design D7.4).

## 7. Documentation

- [x] 7.1 Document array-as-leaf, the depth bound, and the collision rule where a source author will find them
      (the `rest-api-connector` / connector docs surface).
- [x] 7.2 Document the dotted-columns-in-expressions limitation and the `rename`-step workaround, naming BOTH
      affected surfaces: pipeline `compute`/`filter` steps and source computed fields (design D9).

## 8. Gates

- [x] 8.1 `sbt test` green; backend code-quality check green; pre-commit hooks pass.
- [x] 8.2 `openspec validate nested-json-row-flattening --strict` exits zero (note: `--change` is not a valid flag).
- [x] 8.3 Write `files-modified.md` for the delivery squash.
