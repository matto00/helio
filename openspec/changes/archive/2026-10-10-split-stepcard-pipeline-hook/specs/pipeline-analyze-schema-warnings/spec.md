## ADDED Requirements

### Requirement: Lookup warnings use the lookup editor's field labels
Every analyze warning message emitted for a `lookup` step that names the step's `sourceKey` or `lookupKey` SHALL refer to them with the lookup editor's own labels: the `sourceKey` as the "match field" and the `lookupKey` as the "reference match field". Such messages SHALL NOT use the phrases "source key" or "lookup key". The warning `code` values and every non-lookup warning message are unchanged.

#### Scenario: Key type mismatch names the editor's labels
- **WHEN** a lookup's `sourceKey` `customer_id` is `string` on the input and its `lookupKey` `id` is `integer` on the secondary input
- **THEN** the `join-key-type-mismatch` warning message starts with `lookup:`, contains `match field 'customer_id'` and `reference match field 'id'`, and contains neither `source key` nor `lookup key`

#### Scenario: Missing reference key names the editor's label
- **WHEN** a lookup's `lookupKey` `cust_id` is absent from its resolved secondary schema
- **THEN** the `field-not-in-input-schema` warning message starts with `lookup:` and contains `reference match field 'cust_id'`

#### Scenario: Missing match field names the editor's label
- **WHEN** a lookup's `sourceKey` `cust` is absent from its name-complete input schema
- **THEN** the `field-not-in-input-schema` warning message starts with `lookup: match field 'cust' not found` and does not contain `source key`

#### Scenario: Join wording is unchanged
- **WHEN** a join's key is absent from its secondary schema
- **THEN** the warning message is byte-identical to the message emitted before this change
