## ADDED Requirements

### Requirement: Image caption binding is out of scope

The image panel caption SHALL remain **static free text only** (the `config.caption` string). Sourcing the
image caption from a bound DataType field SHALL NOT be supported until image panels gain DataType-binding
infrastructure. Image panels today are unbound — their config is `{ imageUrl, imageFit, caption }` with no
`dataTypeId`/`fieldMapping` and no data-fetch path — so a bound caption would require adding the full binding
stack (config shape, fetch wiring, editor binding UI, and query path) to a panel type that has no other
reason to be bound. Adding that stack is the binding-infrastructure prerequisite for the field-or-literal
pattern (`panel-config-field-or-literal-pattern`), which image panels do not yet meet. The static caption
behavior is unchanged.

#### Scenario: Image caption remains static text

- **WHEN** a user edits an image panel's caption
- **THEN** the caption is stored as fixed text in `config.caption`, with no option to bind it to a DataType
  field

#### Scenario: Static image caption behavior is unchanged

- **WHEN** an image panel has `config.caption: "Hero photo — Reuters"`
- **THEN** the panel renders the caption strip exactly as before, and the caption round-trips through
  create/PATCH/read/duplicate unchanged
