## REMOVED Requirements

### Requirement: Detail modal presents a collection editor
**Reason**: There is no collection-specific editor in the panel detail modal. `collection` is an Output kind and is edited in the Output editor sheet (`OutputKindConfigCard.tsx`), which offers three item field-mapping slots, a Format select and conditional formats, and no base-type, DataType-binding or layout control. `baseType`/`itemOptions` were removed from the config (V117), and the collection card has no literal label/unit fields (the bound-or-literal label/unit pattern is on the metric card).
**Migration**: See "The Output editor sheet presents collection fields".

### Requirement: Saving the collection editor issues one config PATCH
**Reason**: Its scenario ("Layout change patches only layout") names a layout control that does not exist. The single-patch, absent-vs-null behaviour it describes now belongs to the Output editor sheet's edit-mode Save.
**Migration**: See "Editing a collection Output sends only the changed config keys".

### Requirement: Collection editor controls meet mobile touch-target size
**Reason**: It covers controls (layout segmented control, base-type control, DataType field-mapping inputs) of a detail-modal collection editor that no longer renders; the `PanelDetailModal` collection CSS rules that remain (`.panel-detail-modal__segmented*`) are referenced by no component, only by a CSS-lock test.
**Migration**: None: the Output editor sheet's own touch-target rules are not specific to collection.

## ADDED Requirements

### Requirement: The Output editor sheet presents collection fields
For a `collection` Output the Output editor sheet SHALL present three item field-mapping slots (`value`, `label`,
`unit`, each a column select), a `Format` select (options `number`, `integer`, `currency`, `percent`, `duration`, `durationMs`, labelled Number, Integer, Currency ($), Percent (%), Duration, Duration (ms)), and the
conditional-formats rules editor. It SHALL NOT present a base-type or layout control. Creating a collection Output SHALL
write `layout: "grid"`.

#### Scenario: Collection kind shows item fields, format and conditional formats
- **WHEN** the Output editor sheet is open with kind `Collection`
- **THEN** it shows the Value, Label and Unit item field selects, a Format select and the conditional formats editor, and no layout or base-type control

#### Scenario: A new collection Output is created with the grid layout
- **WHEN** the user chooses kind Collection in a new Output and saves
- **THEN** the create request's `config.layout` is `"grid"`

### Requirement: Editing a collection Output sends only the changed config keys
Edit-mode Save of a collection Output SHALL send one `PATCH /api/outputs/:id` whose `config` carries only the keys the
user changed (an explicit `null` clears a key), because the server shallow-merges `config`. A stored `layout` the sheet
has no control for SHALL therefore survive an edit.

#### Scenario: Format change patches only format
- **WHEN** the user opens a collection Output stored with `layout: "list"`, changes only the Format, and saves
- **THEN** the PATCH `config` is `{ format: "<chosen>" }` and the stored `layout` remains `"list"`
