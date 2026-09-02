## REMOVED Requirements

### Requirement: Every route is escapable via the tab bar
**Reason**: The tab-bar destination set shrinks from including Data Types/Metrics to the new five-entry set; rewritten wholesale against the new set rather than incrementally modified, since the original scenarios enumerate the old destination set implicitly via the registry it derived from.
**Migration**: See the new "Every one of the five current routes is escapable via the tab bar" requirement (this same change), which preserves this requirement's trapped-route/scroll-clearance behavior unchanged.

## ADDED Requirements

### Requirement: Every one of the five current routes is escapable via the tab bar
The bottom tab bar SHALL render exactly the five current nav destinations (Dashboards, Data Sources, Data Pipelines, Connectors, Assistant); no tab exists for the retired Data Types or Metrics routes. Every route remains reachable from the tab bar with no trapped route; content continues to scroll clear of the floating bar and clearance stays in sync with bar geometry, exactly as before this change.

#### Scenario: Five tabs, no retired destinations
- **WHEN** the bottom tab bar renders on phone
- **THEN** exactly five tabs are shown, matching the nav-section-registry's five entries

#### Scenario: No trapped route
- **WHEN** the user is on any of the five routes
- **THEN** the tab bar offers a path to every other route with no dead end

#### Scenario: Content scrolls clear of the floating bar
- **WHEN** a page's content is taller than the viewport
- **THEN** scrolling content never renders underneath the floating tab bar
