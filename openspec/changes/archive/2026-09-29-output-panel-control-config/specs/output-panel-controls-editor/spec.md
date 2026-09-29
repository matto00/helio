## Purpose
Defines the author-facing editor surface on an `output` panel's config for adding, auto-binding,
rebinding, and removing date-range/dropdown/numeric-range/text controls, and the client-side
mirror of HEL-1188's contract-eligibility rule that decides which control kinds are offered.

## ADDED Requirements

### Requirement: A control is added in two clicks, auto-bound to a compatible column
The `output` panel's config surface SHALL offer a "Controls" section listing its current controls
and an "Add control" affordance. Activating "Add control" (click 1) and choosing a kind from the
offered set (click 2) SHALL create a control immediately, auto-bound to a compatible column chosen
per the auto-bind rule below, with no further required step before it appears in the list.

#### Scenario: Adding a date-range control takes two clicks
- **WHEN** an author, viewing an `output` panel bound to an Output with a `timestamp` column,
  clicks "Add control" and then clicks "Date range"
- **THEN** a date-range control appears in the list, auto-bound to that Output's date/timestamp
  column, with no further step required

### Requirement: The auto-bind rule for a newly added control
Adding a control SHALL bind it to the first column, in the Output's declared schema order, that is
eligible for the chosen kind per the current capability contract. For `date-range`, "first" means
the first `timestamp` column (schema order) that the contract reports as `gte`+`lte`-eligible.

#### Scenario: Multiple date/timestamp columns — first in schema order wins
- **WHEN** an Output's schema declares two `timestamp` columns, `created_at` before
  `updated_at`, both `gte`/`lte`-eligible
- **THEN** adding a date-range control binds it to `created_at`

### Requirement: Offered control kinds exactly match the Output's capability contract
The "Add control" affordance SHALL offer a kind if and only if at least one of the Output's
declared schema columns is currently eligible for that kind per HEL-1188's `filter-capabilities`
contract (paired with the Output's declared schema type, per the eligibility rule in
`output-panel-placement`). A kind with no eligible column SHALL NOT appear in the list at all — it
is never offered and then rejected on save.

#### Scenario: Two Outputs with the same column types but different filterability offer different kinds
- **WHEN** Output A's `region` column is eq/in-eligible (low cardinality) and Output B's
  identically-typed `region` column is not
- **THEN** Output A's "Add control" list includes Dropdown; Output B's does not

#### Scenario: A kind with no eligible column is never offered
- **WHEN** an Output has no column currently eq/in-eligible
- **THEN** "Add control" does not list Dropdown at all

### Requirement: An author can rebind or remove a control
The controls list SHALL let the author change a control's bound column to any other column
currently eligible for that control's kind, or remove the control entirely. Rebinding or removing
SHALL take effect on save, subject to the same contract validation as add.

#### Scenario: Rebinding to an ineligible column is rejected before save
- **WHEN** an author attempts to rebind a `dropdown` control to a column that is not currently
  eq/in-eligible
- **THEN** the column is not offered as a rebind target

#### Scenario: Removing a control drops it from the panel
- **WHEN** an author removes a control and saves
- **THEN** the panel's persisted `controls` list no longer contains that entry

### Requirement: Every control-editor affordance is keyboard-operable, labelled, and announced
Every interactive element the controls editor introduces (Add control, kind choice, column
rebind, default-value input, label input, remove) SHALL be reachable and operable by keyboard
alone, SHALL carry a programmatically-associated label, and SHALL announce state changes (a
control added, rebound, or removed) to assistive technology via a live region or equivalent.

#### Scenario: Adding a control by keyboard alone
- **WHEN** an author tabs to "Add control", activates it with Enter/Space, and selects a kind via
  arrow keys and Enter
- **THEN** the control is added with no pointer interaction required

#### Scenario: Removal is announced
- **WHEN** an author removes a control
- **THEN** the removal is announced to assistive technology (e.g. via an ARIA live region)

### Requirement: An orphaned control is visibly distinguished in the editor
When a control is orphaned (per `output-panel-placement`'s drift requirement), the editor SHALL
show it as orphaned rather than rendering it identically to an eligible control, and SHALL let the
author rebind it to a currently-eligible column or remove it.

#### Scenario: An orphaned control is visually and programmatically distinguished
- **WHEN** the controls list includes a control whose bound column no longer exists on the Output
- **THEN** that entry is shown with a distinct, non-color-only orphaned indicator, and offers
  rebind/remove
