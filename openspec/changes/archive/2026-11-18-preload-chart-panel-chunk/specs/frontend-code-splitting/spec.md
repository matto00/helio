## ADDED Requirements

### Requirement: Chart code is preloaded once a chart-kind Output is known
Whenever the client resolves the metadata of an Output bound to a panel being shown and its kind is `chart` -- fetched for the signed-in app, restored
from the warm cache, or fetched for a public or share-token viewer -- the client SHALL begin loading the chart
rendering code immediately, without waiting for the chart component to mount or for the Output's rows to arrive.
The preload SHALL use the same chunk the chart renderer loads (one request, not two), SHALL NOT move the
`echarts`/`echarts-for-react` code into the initial entry chunk, and SHALL NOT surface an unhandled rejection or console error when it fails: a failed
preload leaves the chart exactly as it behaved before this change. The loader's own memo is cleared on failure (proven at unit
level only); the browser caches a failed dynamic import per page, so no real-browser retry is added. Outputs of other kinds SHALL NOT trigger the chart preload.

#### Scenario: Chart chunk is requested before the chart's rows arrive
- **WHEN** a dashboard with a chart-kind Output panel is opened and that Output's rows response is held back
- **THEN** the chart chunk is requested while the rows are still pending, and the chart renders once the rows arrive

#### Scenario: Warm-restored and public chart Outputs also preload
- **WHEN** a chart Output's metadata is restored from the warm cache, or fetched by a public or share-token viewer
- **THEN** the chart chunk loading starts at that moment, not when the chart component mounts

#### Scenario: Non-chart Outputs do not load chart code
- **WHEN** a dashboard whose panels are all table, metric or markdown Outputs is opened
- **THEN** no chart chunk is requested

#### Scenario: A failed preload raises no error of its own
- **WHEN** the preload request for the chart chunk fails once
- **THEN** no unhandled rejection or console error is raised by the preload, and the chart panel behaves as it did before this change: its own load surfaces the failure through the existing panel error boundary. The browser caches a failed dynamic import per page, so this change adds no real-browser retry (the loader memo's clear-on-failure is proven at unit level only)

#### Scenario: The chart module stays out of the initial entry chunk
- **WHEN** the production build's bundle-composition report is inspected after this change
- **THEN** the `echarts`/`echarts-for-react` code is present only in a separate, non-entry chunk
