# Sources

Data source connections: `state/sourcesSlice.ts`, services for CRUD and
connector metadata (`dataSourceService.ts`, `connectorService.ts`),
`types/dataSource.ts`, `hooks/useAddSourceAction.ts`, `utils/labelForKind.ts`,
and `ui/` — the sources list/detail pages, add-source modal and its
per-connector `forms/`, and preview/connection-test affordances.

**Belongs here:** connecting to and inspecting external data sources.
**Does not belong here:** the pipelines that read from a source, which live
in `pipelines`.
