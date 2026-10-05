## MODIFIED Requirements

### Requirement: A changed breakpoint must be valid or the whole write is rejected

For every layout write that carries caller-supplied breakpoints (REST `PATCH /api/dashboards/:id` and `PATCH /api/dashboards/:id/update`, MCP layout tools, proposal apply, contents replace, auto-layout), each supplied breakpoint that is not identical to the stored breakpoint SHALL be validated. If any is invalid the server SHALL respond `400` with a message naming the breakpoint and the offending panel ids (overlapping pairs, out-of-bounds items) and SHALL persist nothing, including breakpoints that were valid. The server SHALL NOT clamp, reflow or otherwise alter a caller-supplied breakpoint. Dashboard import is the one exception: an imported breakpoint that is invalid SHALL be stored repaired (see "Import stores bad breakpoints repaired") rather than rejected.

#### Scenario: Overlap at xs is rejected
- **WHEN** a PATCH sets `xs` with two panels at the same cell
- **THEN** the response is `400`, the message names `xs` and both panel ids, and the stored layout is unchanged

#### Scenario: Out-of-bounds at xs is rejected
- **WHEN** a PATCH sets `xs` with a panel `x=1, w=2`
- **THEN** the response is `400` naming `xs` and that panel id, and nothing is saved

#### Scenario: One bad breakpoint rejects the whole write
- **WHEN** a PATCH sets a valid `lg` and an invalid `xs`
- **THEN** the response is `400` and `lg` is not saved either

## ADDED Requirements

### Requirement: Import stores bad breakpoints repaired

`POST /api/dashboards/import` SHALL store each invalid breakpoint of the snapshot repaired: valid under the HEL-1071
contract and holding exactly the same panels as the snapshot's breakpoint (no panel dropped or added). Valid
breakpoints SHALL be stored exactly as supplied. A layout entry that references no snapshot panel SHALL still be
rejected with `400`.

#### Scenario: Exported bad dashboard imports
- **WHEN** a snapshot whose `xs` has two panels at the same cell is imported
- **THEN** the import succeeds, the stored `xs` is valid and holds both panels, and `lg`/`md`/`sm` are stored as supplied

#### Scenario: Out-of-bounds breakpoint imports
- **WHEN** a snapshot's `md` holds an item with `x + w = 12`
- **THEN** the import succeeds and the stored `md` is within 10 columns
