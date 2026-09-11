## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- **HEL-1074/1073 shipped shape matches the design's description.** `DataSourceRepository.scala:329-346`
  `insertDatasetSource(source, declaredColumns: Vector[SchemaField], rows: Vector[Vector[JsValue]], inferredSchema, user)`
  and `:359-380` `replaceDatasetRows(...)` both write `dataset_schema` as `declaredColumns.toJson` and rows
  as positional `JsArray`, in one transaction. `readDatasetRows` (`:392-409`) returns the raw
  `dataset_schema` JSON as `columns`. The only service callers are `DataSourceService.createStatic`
  (`:148`) and `applyStaticRefresh` (`:727`). Correct.
- **DataFieldType** (`model.scala:667-750`): 7 canonical values; helpers are actually named
  `canonicalizeLegacy`, `validateAndCanonicalize`, `fromString`, `asString`, `CanonicalWireValues`.
  Design Decision 2 cites a "`fromString` (canonicalizing)" that does not exist in that form — minor.
- **HEL-1077 scope-out is correct** — no row write route in proposal/tasks; validator is a pure entry point.
- **Wire request shape today:** `StaticColumnPayload(name, type)` only (`DataSourceProtocol.scala:238`).
  There is no field anywhere through which a caller can declare `required` or `default`.
- **Existing callers of the create path** that the new strict validation will now gate:
  `DataSourceRoutes.scala:162`, `PipelineProposalService.scala:378`, `PipelineService.scala:765`,
  `PatchSetApplyForward.scala:71` (agent-authored inline sources), plus refresh.
- **Current frontend encoding** (`StaticSourceForm.tsx:99-107`): integer -> `parseInt` (non-numeric -> NaN
  -> serialized `null`), float -> `parseFloat`, boolean -> `cell === "true"`, empty numeric -> `null`,
  **timestamp/string-body/binary-ref -> raw string**.
- **Existing tests pin declared-vs-cell disagreement as accepted behavior:** `DataSourceServiceSpec.scala:276-296`
  creates a static source with a `date` (->`timestamp`) column holding `JsString("2026-01-01")` and a `long`
  column holding `JsNumber(3)`; `PipelineRowJson.staticColumnRuntimeType` + HEL-893 D2 exist precisely
  because declared type "could disagree with every cell". v0.8 design spec
  (`docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md:53-55,114-115,162-163`)
  requires authoritative validation but says nothing about null/timestamp encoding.

### Verdict: REFUTE

The direction is right and the HEL-1077 boundary is clean, but the validation contract — the entire
substance of this ticket — is under-specified at exactly the points an implementer must decide, and
the plan does not account for turning a currently-permissive create/refresh path strict.

### Change Requests
1. **Define the per-type JSON acceptance table (design.md + spec.md).** For each of the 7 types state
   exactly which `JsValue`s pass: `integer` — is `JsNumber(12.0)` accepted, `12.5` rejected? `float` — is
   `JsNumber(3)` accepted? `timestamp` — any `JsString`, or must it parse (ISO-8601 date and/or
   date-time? `"2026-01-01"` is already in an existing test fixture)? `string-body` — any `JsString`?
   `binary-ref` — a `JsObject` of what shape (`BinaryRef`)? `boolean` — `JsBoolean` only? Add a spec
   scenario per non-obvious case (at minimum integer-vs-whole-float and timestamp).
2. **Define "missing" for a positional row and the semantics of `JsNull`.** Rows are positional arrays:
   is "missing" a short/ragged row (index absent), a `JsNull` at the index, or both? Is `JsNull` in a
   `required: true` field a reject, and in an optional field an accept? Does `default` fill `JsNull` or
   only an absent index? What about a row *longer* than the declaration (extra cells) — reject? The
   frontend sends `null` for every empty numeric cell and `NaN`->`null` for non-numeric input, so this
   decides real behavior. Add scenarios for each.
3. **Resolve how `required`/`default` reach the declaration on any live path.** `StaticColumnPayload`
   carries only `name`/`type`; tasks 4.1 is conditional ("If ... exposed"). As written, every persisted
   field is `required: false, default: None`, so AC-2 ("a write missing a required field is rejected")
   is reachable only through the pure unit test. Decide explicitly: either (a) extend
   `StaticColumnPayload` with optional `required`/`default` now (and make 4.1 unconditional: `schemas/`,
   `openspec/` OpenAPI, frontend `StaticColumn` type, absent-key normalization test), or (b) state that
   declaration input is HEL-1077's/a follow-up's job and that AC-2 is satisfied at the validator
   boundary only — and say so in the proposal so the evaluator does not have to guess. Also validate a
   declared `default` against its own `type` at declaration time (currently only described in spec prose
   "whose JSON shape matches type", no task, no scenario).
4. **Account for the behavior change on existing create/refresh callers.** Today `createStatic`/refresh
   accept cells that disagree with the declared type (HEL-893 D2). Wiring strict validation in will start
   returning 400s from `POST /api/data-sources/static`, refresh, and the three agent-authored inline-source
   paths (`PipelineProposalService:378`, `PipelineService:765`, `PatchSetApplyForward:71`). The design must:
   (a) enumerate these callers; (b) state the error contract (HTTP status, body shape carrying the
   field-level errors — task 2.2 leaves the wire shape "if surfaced", but it *will* be surfaced through
   create/refresh 400s, so it must be defined, including row index + field name); (c) identify existing
   tests/fixtures whose payloads will now be rejected (e.g. `DataSourceServiceSpec.scala:276-296`) and state
   that they are updated only where the fixture was genuinely invalid under the new contract, not
   weakened to pass; (d) confirm the frontend form's encoding (`StaticSourceForm.tsx:99-107`) produces
   accepted values for all 7 types, or scope the needed frontend change; (e) spec delta for
   `static-data-connector` / create-refresh if its requirement text describes accepting these payloads —
   proposal currently asserts "no existing requirement text changes" without evidence; verify and record.
5. **Make the failable probe concrete (task 3.3).** Name both mutations: (i) the validator's type-check arm
   replaced with `Right` -> unit scenario goes red; (ii) the `DatasetRowValidator.validate` call removed
   from `createStatic` and from `applyStaticRefresh` -> a service/route-level test asserting 400 **and**
   zero `dataset_rows` for that source goes red. One probe per writer, since there are two wiring sites.
6. **Correct Decision 2's helper names** to the real API (`validateAndCanonicalize` / `canonicalizeLegacy` /
   `asString`), and state what the codec does with an *unrecognized* type string read back from storage
   (fail loud vs. passthrough) — `SchemaField` currently enforces canonical values via `require`.

### Non-blocking notes
- Refresh re-sends `columns` wholesale, so refresh already *is* a declaration replacement; worth one line in
  design.md noting rows are validated against the new (incoming) declaration, which sidesteps the deferred
  "mutation when rows exist" question for this ticket.
- `readDatasetRows`' `columns` output will gain `required`/`default` keys; `parseStaticRows`, Spark's
  `StructType` builder, and `previewStatic` consume it — confirm they tolerate extra keys (they appear to
  read only `name`/`type`) and cover with the existing `DatasetRowsReaderBehaviorPreservingSpec`.
