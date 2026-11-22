## ADDED Requirements

### Requirement: The document never scrolls on an authenticated desktop route
At viewport widths above 768px, on every route rendered behind sign-in (every route inside `AppShell`, plus the
`/connect/mcp` consent page), the document SHALL NOT be a scroll container: `document.documentElement.scrollHeight`
SHALL NOT exceed `window.innerHeight` and `window.scrollY` SHALL stay 0, regardless of how long the page content or the
context list is. Vertical scrolling SHALL belong to the page's own inner regions. A Playwright guard SHALL enforce this
at 1440x900 and 1280x800, and its route list SHALL be checked against the router so a new authenticated route is
covered or the guard fails.

#### Scenario: Every authenticated route fits at both desktop viewports
- **WHEN** a signed-in user with a 30+ item pipeline list, a pipeline with a long step list and a pipeline with a short
  step list opens each authenticated route at 1440x900 and at 1280x800, the long content is actually rendered (30+
  context-list items, the seeded dashboard panels, the long pipeline's inner region overflowing its height) and no
  request was rate-limited
- **THEN** on every route `document.documentElement.scrollHeight` is at most `window.innerHeight` and `window.scrollY`
  is 0

#### Scenario: Wheel over the step spine scrolls only the inner region
- **WHEN** the user wheel-scrolls down over the step spine of a pipeline with a long step list at 1440x900
- **THEN** `window.scrollY` stays 0 and the shell (command bar, rail, context list) does not move
- **AND** an inner scroll region under the pointer has scrolled

#### Scenario: A new authenticated route is not silently skipped
- **WHEN** a route is added inside `AppShell` in `AppRoutes.tsx` without being added to the guard's route list
- **THEN** the guard fails, naming the missing route
