## MODIFIED Requirements

### Requirement: Partial update of the caller's preferences

`PATCH /api/users/me/preferences` SHALL accept any subset of `{contextListWidth, contextListCollapsed, dashboardTabs}`, store only the
fields present, leave every other stored preference unchanged (including `accentColor`), and return the caller's full
preferences. `contextListWidth` SHALL be an integer in 200..400 and `contextListCollapsed` a boolean. `dashboardTabs`
SHALL be `{tabs: [{id, lastViewedAt, ownWriteAt?}], activeId}` and replaces the stored tab set as a whole: at most 20 tabs, each `id` a
non-empty string of at most 64 characters, ids unique, `lastViewedAt` an ISO-8601 instant or `null`, optional `ownWriteAt` an ISO-8601 instant or `null`, and `activeId` either
`null` or one of the tab ids. Any other value or unknown field SHALL be rejected with `400` and change nothing; an invalid
stored value is treated as never set when read. Unauthenticated calls SHALL get `401`. Contracts:
`schemas/auth/user-preferences.schema.json` and `schemas/auth/update-user-preferences-request.schema.json`.

#### Scenario: Partial updates accumulate

- **WHEN** the caller PATCHes `{contextListWidth: 320}` and then `{contextListCollapsed: true}`
- **THEN** the caller's preferences hold width 320, collapsed true, and the unchanged accent colour

#### Scenario: Out-of-range width rejected

- **WHEN** the caller PATCHes `{contextListWidth: 1000}`
- **THEN** the response is 400 and the stored width is unchanged

#### Scenario: Changing the accent keeps shell preferences

- **WHEN** the caller saves width 320 and then changes the accent colour via `PATCH /api/users/me/update`
- **THEN** the stored width is still 320

#### Scenario: Tabs saved without touching other keys

- **WHEN** the caller with width 320 PATCHes `{dashboardTabs: {tabs: [{id: "d1", lastViewedAt: null}], activeId: "d1"}}`
- **THEN** the preferences hold that tab set and width 320

#### Scenario: Invalid tab sets rejected

- **WHEN** the caller PATCHes 21 tabs, a duplicate id, or an `activeId` not among the tabs
- **THEN** the response is 400 and the stored tab set is unchanged
