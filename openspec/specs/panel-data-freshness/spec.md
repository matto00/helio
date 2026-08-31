# panel-data-freshness Specification

## Purpose
Displays a "Data as of [relative time]" freshness indicator on panels bound to a DataType, sourced from the most recent successful pipeline run that writes to that DataType.

## Requirements

### Requirement: Frontend panel displays freshness indicator when dataAsOf is non-null
The panel card (in the dashboard grid) SHALL render a "Data as of [relative time]" indicator below the panel title when `panel.dataAsOf` is a non-null, non-empty string. The relative time SHALL be computed using the existing `formatRelativeTime` utility. The indicator SHALL be hidden (not rendered) when `panel.dataAsOf` is `null` or `undefined`.

#### Scenario: Bound panel with run shows freshness indicator
- **WHEN** a panel with `dataAsOf` set to a valid ISO timestamp is rendered in the panel grid
- **THEN** a "Data as of [relative time]" label is visible below the panel title (e.g. "Data as of 2 hours ago")

#### Scenario: Unbound panel hides freshness indicator
- **WHEN** a panel with `dataAsOf: null` is rendered in the panel grid
- **THEN** no "Data as of" label is rendered

#### Scenario: Panel with never-run pipeline hides freshness indicator
- **WHEN** a panel with `dataAsOf: null` (pipeline has never run) is rendered in the panel grid
- **THEN** no "Data as of" label is rendered

### Requirement: PanelBase TypeScript interface includes dataAsOf
The `PanelBase` interface in `panel.ts` SHALL include `dataAsOf?: string | null` as an optional field. All panel discriminated union members inherit this field via `PanelBase`. Existing fixtures and test factories that do not set `dataAsOf` remain valid (the field is optional).

#### Scenario: Panel hydrated from API carries dataAsOf
- **WHEN** the Redux store normalizes an API panel response that includes `"dataAsOf": "2026-05-11T10:00:00Z"`
- **THEN** `panel.dataAsOf` equals `"2026-05-11T10:00:00Z"` in the Redux state

#### Scenario: Panel hydrated without dataAsOf defaults to undefined/null
- **WHEN** the Redux store normalizes an API panel response where `dataAsOf` is `null`
- **THEN** `panel.dataAsOf` is `null` in the Redux state
