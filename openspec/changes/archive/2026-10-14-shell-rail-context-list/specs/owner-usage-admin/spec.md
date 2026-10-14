## ADDED Requirements

### Requirement: Desktop Usage entry lives in the avatar menu
Above 768px, the owner-only Usage page SHALL be reached from a "Usage" item in the avatar menu and SHALL NOT be
a rail (primary nav) item. Non-owners SHALL see no Usage item in the menu. On phones, Usage stays in the bottom nav for owners as today.

#### Scenario: Owner opens Usage from the avatar menu
- **WHEN** an owner opens the avatar menu at 1280px and chooses Usage
- **THEN** the browser navigates to `/admin/usage`, and no rail item links there

#### Scenario: Non-owner menu has no Usage
- **WHEN** a free-tier user opens the avatar menu
- **THEN** no Usage item is present
