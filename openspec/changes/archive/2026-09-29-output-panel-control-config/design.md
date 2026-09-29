## Context

`OutputPanelConfig(outputId: OutputId)` (`backend/.../domain/panels/OutputPanel.scala`) is the
entire persisted config for an `output` panel today; `outputId` lives in its own typed `output_id`
column on `panels` (`PanelRowMapper.scala`). HEL-1188 shipped `OutputFilterCapability`
(`services/pipelines/OutputFilterCapability.scala`): `staticOperatorsFor(DataFieldType)` gives
`Contains` for `string`/`boolean`, `Contains+Gte+Lte` for `integer`/`float`/`timestamp`; `Eq`/`In`
are a SEPARATE cardinality gate (`MaxDropdownCardinality=50`) added to whichever static set applies,
for ANY Structured column — not reserved to one type. The `/filter-capabilities` response
(`OutputFilterCapabilitiesResponse`, `columns: [{column, operators}]`) carries no column type;
`GET /api/outputs/:id` already returns `schema: [{name, type}]` in declared order
(`OutputProtocol.outputResponseFrom`), which is the only source of column type/order. See
proposal.md for motivation; see the two spec deltas for full requirements.

Precedent: `FormPanelConfig`/`FormFieldSpec` (`domain/panels/FormPanel.scala`) is the closest
existing shape — a variable-length, kind-per-entry list with a closed attribute set, strict
decode, and a fitness matrix (`FittingControls: Map[DataFieldType, Vector[String]]`) mirrored on
the frontend and drift-guarded by a test. This change follows that shape, not a JSON-Schema-only
approach — there is no other precedent for a persisted "list of typed, kind-discriminated specs"
in this codebase.

## Goals / Non-Goals

**Goals:** persisted control model; contract-validated create/update; defined orphan behavior;
two-click authoring UI; client/server eligibility parity.

**Non-Goals:** rendering/applying controls to a read (leaf 3, HEL-1190); MCP (leaf 5, HEL-1193);
caching the capability contract (HEL-1194, separate ticket — not folded in, this change calls
`/filter-capabilities` directly per validation/editor-open); the OutputService/NodeSnapshotRepository
split (HEL-1187, explicitly deferred).

## Decisions

**D1 — New `output_controls JSONB NULL` column, not reuse of `output_id`'s row shape.**
`OutputPanelConfig` gains `controls: Vector[OutputControlSpec] = Vector.empty`, but only `controls`
is persisted to a NEW column (migration V112, mirroring V108's `form_config` addition exactly:
same `NO FORCE`/`FORCE ROW LEVEL SECURITY` bracket — `panels_output` policies are `missing_ok`-safe
and this is pure DDL). `output_id` keeps its existing typed column unchanged. Alternative
considered: a hypothetical generic `config` JSONB column — rejected, no such column exists;
`output_id` is typed specifically (HEL-904), and retrofitting it touches far more call sites.

**D2 — `OutputControlSpec` mirrors `FormFieldSpec`'s closed-set/strict-decode shape.**
`final case class OutputControlSpec(id: String, kind: String, column: String, label: String,
defaultValue: Option[JsValue])`. `AllowedKeys` closed set; unknown key is a decode failure (matches
`FormFieldSpec`/`FormPanelConfig`, not a silent drop). Mirrors nothing in `FormFieldSpec` (which has
no id) because form fields are keyed by `sourceField` uniqueness; controls have no such natural key
(`column` is NOT unique — two controls, e.g. a numeric-range and a dropdown, can legitimately bind
the same column). `ValidKinds = Set("date-range", "dropdown", "numeric-range", "text")`.

`id` is CLIENT-generated (UUID v4, `crypto.randomUUID()`) at "Add control" time, sent from its very
first PATCH — the server never mints/rewrites it (skeptic round 2 CR1: "server-assigned" had no
stated round-trip, which D4's id-diff needs). Departs from `PanelId` (server-minted at INSERT, a
top-level resource with one creation instant) because D7's two-click AC needs the new control to
appear in local editor state before any round-trip. The server treats an incoming `id` with no match
in the persisted list as new (D4) and persists it verbatim; a forged/colliding id can't bypass
validation — D4 separately checks `kind`/`column` regardless of whether `id` was judged new.

`defaultValue`'s internal JSON shape (skeptic round 1 CR2 — never server-validated, like
`FormFieldSpec.initialValue`, but genuinely ambiguous here unlike that single-scalar precedent) is
fixed per kind, stated once so the executor, the editor (D7), and HEL-1190's later viewer agree
without guessing: `text`/`dropdown` → a single JSON string; `numeric-range` →
`{"min": <number|null>, "max": <number|null>}`; `date-range` → `{"from": <ISO-8601 date
string|null>, "to": <ISO-8601 date string|null>}` — symmetric with `numeric-range`'s pair shape,
since both kinds are "`Gte`+`Lte`, differentiated only by type" per D3 (an earlier draft gave
`date-range` a single anchor date, an unexplained asymmetry the skeptic flagged). Either half of a
range pair may be `null` (open-ended).

**D3 — Kind eligibility is derived from the operator set, not a fixed type→kind table.** Per
OutputFilterCapability's actual semantics (Context above), a column's eligible kinds are: `text`
iff `Contains` present; `dropdown` iff `Eq`+`In` present (any type); `numeric-range` iff `Gte`+`Lte`
present AND declared type ∈ {integer, float}; `date-range` iff `Gte`+`Lte` present AND declared
type = timestamp. This function (`OutputControlEligibility.kindsFor(column, operators, fieldType)`)
is the SINGLE source of truth, called by both the server validator (D4) and mirrored on the
frontend (D6) — exactly the "shared logic, not a parallel copy" discipline `OutputFilterCapability`
itself documents. Rejected alternative: a static `Map[DataFieldType, Set[kind]]` like
`FormFieldSpec.FittingControls` — wrong here because `dropdown`/`text` eligibility is
cardinality-driven (per-Output, per-column data), not purely type-driven; a static map would offer
`dropdown` on every string column regardless of actual eligibility, violating the AC's two-Outputs
scenario.

**D4 — Server validation only covers ADDED or CHANGED controls, identified by `id`-diff against
the currently-persisted list — NOT `rejectInconsistentForm`'s "revalidate everything
unconditionally" shape.** (Revised after skeptic round 1 CR1: mirroring `rejectInconsistentForm`
literally re-rejects *every* future write once any control drifts, even one only touching the title
or an unrelated control — contradicting D5 and the AC's "defined, **visible**" (non-blocking)
framing. `FormFieldSpec` has no orphan concept, so that precedent didn't actually apply here.)

Corrected rule: `rejectInvalidControls(configOpt, existing: Vector[OutputControlSpec], user)` diffs
the incoming `controls` (when the patch touches `controls` at all; an update omitting `controls`
is unaffected, like every other `Patch` field) against `existing` **by `id`**:
- `id` not in `existing` (a genuine add) → validated;
- `id` in `existing` but `kind`/`column` differ from the persisted entry (rebind/kind change) → validated;
- `id`, `kind`, `column` unchanged from `existing` (only `label`/`defaultValue` edited, or
  genuinely untouched, including a currently-orphaned entry) → NOT re-validated — carries its
  current eligibility forward unexamined;
- a persisted `id` absent from the incoming list is simply removed — no validation needed.
Only the first two bullets can produce the spec's defined 400: an author always saves an unrelated
edit — a different control, title, appearance — without an already-orphaned control locking the
panel, while rebinding/changing-kind on an entry still gets a real, current rejection if invalid.
Wired into `buildForCreate` alongside `rejectMissingOutput`/`rejectInconsistentForm`, and into
`PanelService.update` (line 560 already holds `existing`, the pre-patch persisted panel, to diff
against — confirmed by reading the file directly).

**D5 — Orphan is a read-time classification, not a write-time rejection.** A column removed/retyped
after a control was saved is NOT deleted or write-rejected — D4 says precisely which writes CAN
reject a control (only one that itself adds/rebinds/changes-kind that entry); an untouched orphaned
entry never blocks an unrelated write. `OutputResponse`'s control-list projection (or a lightweight
sibling used by the editor) computes `orphaned: Boolean` per control at READ time via the same
`OutputControlEligibility.kindsFor` check, using the Output's CURRENT schema/contract — independent
of D4's write-time check, since eligibility can drift between reads with zero writes in between.
Matches the precedent in `OutputFilterCapability` itself ("a Content-category or undeclared column
is omitted entirely" is also read-time-derived) and avoids a background cleanup job. `defaultValue`
and `column` are left untouched on drift — losing the author's config silently would be "silent."

**D6 — Frontend mirrors D3 via a dedicated fetch, not a cached copy.** `outputService.ts` gains
`getFilterCapabilities(outputId)`; the new `OutputControlsEditor` component (sibling to
`OutputPanelSection` in `PanelDetailModal.tsx`) fetches it once per editor-open (same D6 cost model
`OutputFilterCapability.scala`'s own header comment states for the endpoint: "called once per panel
load/config-open, not the hot path") and combines it with the already-fetched `output.schema`
(`useOutputMeta`) to compute offered kinds/columns — same `kindsFor` logic, hand-ported to
TypeScript and drift-guarded by a test that parses the Scala literal, exactly mirroring
`FittingControls`/`CONTROL_FITNESS`'s existing C4 drift-guard convention.

**D7 — Editor UI shape.** A new "Controls" section in `OutputPanelSection`
(`PanelDetailModal.tsx`), using the shared `Select` component (`shared/ui/Select.tsx`) for kind and
column pickers and plain labelled text/number/date inputs (styled via `shared/ui/inputs.css`
tokens) for `label`/`defaultValue` — no new date-range-picker/number-range-input primitive is
built; author-time default entry is a plain value per kind, per D2's wire shape (a from/to date
pair for date-range, a min/max number pair for numeric-range, one string for text/dropdown), not
the live viewer control (that richer widget is leaf 3's concern). "Add control" is a `Select`-backed kind picker
populated from D6's eligible-kinds computation; choosing a kind immediately calls
`accumulatePanelUpdate` with the new control appended and auto-bound (D3's first-in-schema-order
rule) — satisfying the two-click AC without an intermediate confirm step.

## Risks / Trade-offs

- [Two independent eligibility implementations (Scala D3, TypeScript D6) drift] → same C4-style
  drift-guard test pattern `FormFieldSpec`/`CONTROL_FITNESS` already uses in this codebase; server
  validation (D4) is authoritative regardless, so drift fails closed (editor might over/under-offer,
  server still rejects correctly).
- [Re-fetching the full capability contract on every panel save is the documented O(columns ×
  row-count) cost `OutputFilterCapability.buildContract`'s own header accepts] → unchanged by this
  ticket; HEL-1194 (caching) is the tracked follow-up, deliberately not folded in.
- [`id`-less legacy controls after a partial rollout] → not applicable, new column, no existing rows.

## Migration Plan

V112 adds `output_controls JSONB NULL` (mirrors V108 exactly: `NO FORCE`/`FORCE ROW LEVEL SECURITY`
bracket, no backfill needed — NULL/absent decodes to empty list). No rollback beyond a standard
down-migration; no data migration since the column starts empty for every existing panel.
