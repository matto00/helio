# HEL-1189: Output panel control config: author adds date/dropdown/numeric/text controls, auto-bound with override

## Description

Leaf 2 of HEL-915 (re-scoped 2026-09-29 with the owner, see the epic).

### Why

Owner rulings: controls are **per output panel** (not dashboard-wide), **set up by the author** in panel config, of four kinds (**date range, dropdown, numeric range, free text**), and **auto-bound to a compatible column with a per-panel override**. The kinds and columns offered must come from HEL-1188's capability contract for that Output, never from column type alone.

## Scope

* A control model persisted on `output` panels (config, not a new panel kind: spec decision 6, "output controls parameterize the read, not the panel"): a list of controls, each with kind, bound column, author default value, and a label.
* **Auto-bind:** adding a control binds it to a compatible column the contract allows. Date range picks the Output's date/timestamp column, the first one if there are several (state the rule). The author can rebind or remove it. If there's no compatible column, the control kind isn't offered at all (not offered-then-broken).
* The editor UI for adding, configuring and removing controls in the panel's config surface (DESIGN.md tokens, shared components, both themes).
* Validation on both client and server: a saved control whose column/operator the contract doesn't allow is rejected with a defined error. Decide how a control behaves when the Output's schema later changes and its column disappears or changes type (defined, non-silent).
* Schemas/openspec updated in the same change. Remember the enumeration sites a panel config change touches (see memory/MISTAKES.md on panel kinds).

## Acceptance criteria

* An author adds a date-range control to an Output panel in **two clicks**, auto-bound to its date column.
* The control kinds offered for a given Output exactly match what HEL-1188's contract allows. Test two Outputs with the same column types but different filterability.
* The server rejects an invalid control config (contract violation) with a defined 400.
* A schema drift that orphans a control has defined, visible behaviour.
* a11y (inline, v0.8 rule): every new editor control is keyboard-operable, labelled, and announced.

## Out of scope

Rendering controls for viewers and applying them to the read (leaf 3), MCP (leaf 5).

## Relations

- Parent: HEL-915 (epic: Dashboard variables and parameterized outputs)
- Blocked by: HEL-1188 (merged, c740775e) — Output filter capability contract
- Blocks: HEL-1190 (viewer control bar), HEL-1193 (MCP + proposal surface for output panel controls)
- Related to: HEL-1192 (dashboard variables, layer over per-panel controls)

## Driver notes (verified during premise validation — see premise-validation.md)

- HEL-1188 shipped `GET /api/outputs/:id/filter-capabilities` and `GET /api/outputs/:id/distinct-values?column=`. Domain contract: `backend/src/main/scala/com/helio/services/pipelines/OutputFilterCapability.scala`.
- CORRECTED mapping (driver's stated kind->operator table was imprecise): `staticOperatorsFor` gives StringType/BooleanType only `Contains`; IntegerType/FloatType/TimestampType get `Contains+Gte+Lte`. `Eq`/`In` are a SEPARATE cardinality gate (<=50 distinct values, `MaxDropdownCardinality`) added on top of whichever static set applies, to ANY Structured column regardless of type. A low-cardinality string column is both free-text and dropdown eligible; a date column can be both range- and dropdown-eligible.
- Gap to settle in design: `ColumnCapability(column, operators)` carries no column type. Date range vs numeric range (both offer gte/lte) must be disambiguated using `Output.schema`'s `DataFieldType` (TimestampType vs Integer/FloatType), paired with the capability contract by column name. State this pairing rule explicitly in design.md.
- HEL-1194 (open, capability-contract caching) — do not fold in unless design needs it; escalate if so.
- HEL-1187 (open, OutputService/NodeSnapshotRepository/OutputRoutes split) — do not do that refactor here; keep additions from making those files materially worse.
- Migrations: V111 is latest on main, V112 is free. Confirmed via `backend/src/main/resources/db/migration/`.
- Panel config changes touch several enumeration sites (see MISTAKES.md, HEL-1082 form-panel batch's "four enumeration sites" lesson). Keep schemas/ and openspec in the same change.
- HEL-350 cross-filtering (9e1f7998) and HEL-1027 server-side filter (a4dbd83c) already exist on main — reuse their filter shapes rather than inventing a parallel one.
