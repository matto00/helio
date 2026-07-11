# HEL-294: Agent-creatable CSV / REST / SQL data sources via MCP

Part of HEL-291 (Agent-native dashboard usability: panel aggregation, config depth, and...).
Unblocks the "plug Helio into any project and let the agent wire up the data" half of the v2.0 vision.

## Problem

MCP `create_data_source` is **static-only** (inline columns + rows). Its own description states
CSV/REST/SQL sources are "out of this tool's scope." So an agent dropped into a new project
**cannot connect a real data source** — the very first step of the source → pipeline → dashboard chain.

## Change

Expose source creation for the non-static source types the backend already supports (CSV
upload/URL, REST API, SQL) as MCP tools over their existing endpoints, with the config each type
needs (e.g. SQL: connection + query; REST: URL + auth + path; CSV: upload/URL). Mirror
`create_data_source`'s pattern: create the source, surface the auto-created companion DataType,
and point the agent at building a pipeline for a bindable output.

## Acceptance criteria

* An agent can, through MCP alone, create a SQL-backed source (or CSV/REST), then
  `list_source_objects` to see its shape, then build a pipeline over it.
* End-to-end: agent connects a fresh non-static source → pipeline → dashboard with no manual UI
  step.
* Credentials handled safely (not echoed back through tool results).

## Links

- Linear: https://linear.app/helioapp/issue/HEL-294/agent-creatable-csv-rest-sql-data-sources-via-mcp
- Parent: HEL-291
