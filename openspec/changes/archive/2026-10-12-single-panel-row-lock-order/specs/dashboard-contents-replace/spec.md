## ADDED Requirements

### Requirement: Contents replace never overwrites a layout it did not read
A contents replace SHALL lock the dashboard's panel rows and then the dashboard row before deleting or inserting
panels, SHALL write only the layout it computed for the supplied panel set (never a layout read earlier and written
back), and SHALL respond with the dashboard as stored after the replace, including its current layout version.

#### Scenario: Concurrent panel create during a replace
- **WHEN** a panel is created on the dashboard while a contents replace of that dashboard is in flight
- **THEN** both requests complete without error and, afterwards, every panel on the dashboard has an item in every
  layout breakpoint and every layout item belongs to a panel on the dashboard

#### Scenario: Response carries the current layout version
- **WHEN** a contents replace succeeds
- **THEN** the returned dashboard's layout version equals the stored layout version
