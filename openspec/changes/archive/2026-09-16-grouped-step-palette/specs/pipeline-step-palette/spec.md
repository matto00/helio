## Purpose

Defines the add-step palette in the pipeline editor: a filterable, server-grouped chooser that lets a user
find a transformation step by description rather than by knowing op names, and that is fully operable from the
keyboard.

## ADDED Requirements

### Requirement: The palette renders categories purely from server catalog data

The palette SHALL derive its categories, their order, each step's group membership, each step's label, and
each step's description from the step catalog API. The client SHALL NOT contain its own mapping from step kind
to group, nor its own table of group display order. Presentation-only assets that cannot cross the wire (for
example an icon component chosen per kind) are not group data and MAY remain client-side.

#### Scenario: No client-side group mapping exists

- **WHEN** the palette is rendered
- **THEN** every category shown, and its position among the categories, comes from the catalog response

#### Scenario: A newly grouped kind moves category without a client change

- **WHEN** a kind's declared group changes on the backend
- **THEN** the palette shows it under the new category with no client-side change

### Requirement: The palette offers an "All" overview and per-category views

The palette SHALL offer an "All" view that lists every authorable step in the catalog. A step that declares no
group SHALL appear in the "All" view and in no category. A step that is reported unauthorable SHALL NOT be
offered as a selectable choice anywhere in the palette, so the palette never presents a choice that cannot be
completed.

A failable check SHALL exist that goes red if an authorable catalog entry is missing from the "All" view, and
that goes red if an ungrouped entry appears within any category. A newly registered step SHALL NOT be able to
vanish silently from the palette.

#### Scenario: All view lists every authorable step

- **WHEN** the palette is opened
- **THEN** the "All" view lists every authorable entry in the catalog

#### Scenario: An ungrouped step appears only in All

- **WHEN** the catalog contains an entry with no group
- **THEN** that step appears in the "All" view and appears in no category

#### Scenario: An unauthorable step is not offered

- **WHEN** the catalog reports an entry as unauthorable
- **THEN** the palette does not present it as a selectable choice

#### Scenario: A missing authorable step fails the check

- **WHEN** an authorable catalog entry is absent from the "All" view
- **THEN** the failable check reports a failure

### Requirement: Filtering narrows results live and flattens across groups

The palette SHALL provide a filter input that receives focus when the palette opens. Typing SHALL narrow the
visible steps live, matching against at least each step's label and description. While a filter is active the
results SHALL be presented as a single flat list rather than remaining partitioned into categories, because a
filtering user is looking for a step, not browsing a structure. When the filter matches nothing, the palette
SHALL show an empty state rather than an empty region.

#### Scenario: Filter input is focused on open

- **WHEN** the palette opens
- **THEN** the filter input holds focus and typing goes to it without any further pointer or key action

#### Scenario: Filtering narrows results live

- **WHEN** the user types text matching a subset of steps
- **THEN** only matching steps remain visible, updating as each character is typed

#### Scenario: A description match is found

- **WHEN** the user types text that appears in a step's description but not in its label
- **THEN** that step remains visible

#### Scenario: Filtered results are flat

- **WHEN** a filter is active
- **THEN** the matching steps are presented as one flat list, not grouped into categories

#### Scenario: No matches shows an empty state

- **WHEN** the filter matches no steps
- **THEN** an empty state is shown explaining that nothing matched

### Requirement: The palette is fully operable from the keyboard

The palette SHALL be operable without a pointer. Arrow keys SHALL move the active selection across the
currently visible results, traversing group boundaries as one continuous sequence so that no visible result is
unreachable. Enter SHALL select the active result and insert that step. Escape SHALL close the palette without
selecting and SHALL return focus to the control that opened it. Opening the palette SHALL place the user
somewhere they can immediately type or navigate, never on an unreachable list.

#### Scenario: Arrow keys traverse group boundaries

- **WHEN** the active result is the last entry of one category and the user presses the down arrow
- **THEN** the active result becomes the first entry of the next visible category

#### Scenario: Enter selects the active result

- **WHEN** a result is active and the user presses Enter
- **THEN** that step is inserted and the palette closes

#### Scenario: Escape closes and restores focus

- **WHEN** the palette is open and the user presses Escape
- **THEN** the palette closes, no step is inserted, and focus returns to the control that opened the palette

#### Scenario: Keyboard-only add-step works end to end

- **WHEN** a user activates an add-step control by keyboard, types to filter, arrows to a result, and
  presses Enter
- **THEN** the chosen step is inserted, using only the keyboard throughout

### Requirement: Every add-step entry point keeps its own insert position

The palette SHALL be openable from each add-step control the editor offers, and selecting a step SHALL insert
it at the position belonging to the control that opened the palette — appending where the control appends, and
inserting at that gap's index where the control inserts at a gap. Opening the palette from one control SHALL
NOT change where another control would insert.

#### Scenario: A gap control inserts at that gap

- **WHEN** the palette is opened from a gap affordance and a step is chosen
- **THEN** the step is inserted at that gap's index

#### Scenario: An appending control appends

- **WHEN** the palette is opened from an appending add-step control and a step is chosen
- **THEN** the step is appended

#### Scenario: A branch control branches

- **WHEN** the palette is opened from the branch affordance and a step is chosen
- **THEN** the step is created as that control's branch rather than at another control's position
