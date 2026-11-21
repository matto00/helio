## Why

On `/connectors` the connector row, its actions-menu trigger and the "Test connection" button paint a hover fill (`--app-surface-soft`) that measures about 1.05 against the `--app-bg` canvas they sit on, below the HEL-866 floor of 1.10, in both themes and at every width. The HEL-866 state-surface contrast guard never saw them because no guard cell seeds a connector, so `/connectors` renders only its empty state while it runs.

## What Changes

- The contrast guard's per-cell seed creates one connector (no-auth REST kind, a non-resolvable `.invalid` base URL, no credential, no outbound fetch) in every cell that visits `/connectors`, at 1440 (routes-light, overlays-chrome where it renders the page) and at 1100/768/390 (the narrow helper), and waits for the connector's name to render before probing.
- Sampled-control counts in those cells change deliberately; the new counts are recorded in evidence.
- Red run on current code committed first (C12), showing all three controls failing.
- CSS fix in `ConnectorsPage.css` only (no shared primitive changes): each control takes its DESIGN.md §5 recipe's hover using the `--app-bg` rung from the state-rung table (`--app-surface-raised`), inside `@media (hover: hover)`.
- CI time added is measured and stated.

## Capabilities

### New Capabilities

### Modified Capabilities
- `state-surface-contrast-guard`: the guard's seeded population now includes a connector, so `/connectors` row and row-action states are measured at every width the guard covers.
- `connectors-page-ui`: the connector row and its row actions convey a hover that clears the state-surface floor in both themes.

## Impact

- `e2e/support/state-surface-contrast-guard.ts`, `e2e/support/state-surface-contrast-guard-narrow.ts` (seed + readiness wait), possibly the route/overlay spec files' expectations.
- `frontend/src/features/connectors/ui/ConnectorsPage.css`.
- Possibly `DESIGN.md` (a note only if a recipe/rung mapping is added).
- No backend change, no migration, no API change. CI: a few seconds per /connectors cell for one extra POST and the extra sampled controls.
