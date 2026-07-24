# HEL-484: Connector registry + capability metadata (agent connector menu)

## Context

The valid source kinds are a hardcoded `Set[String]` in `DataSourceKind.All` (`backend/src/main/scala/com/helio/domain/DataSource.scala`), with per-kind logic scattered across `SourceRoutes`/`DataSourceRoutes`/`SourceService`/`DataSourceProtocol`. Nothing enumerates connectors with their capabilities, so an agent (via helio-mcp) has no way to discover "what can I connect to and what does each need." As v1.9 adds many connectors, a central registry keyed off the SPI capability metadata (HEL-449) is needed to drive the agent connector menu and the frontend "Add source" type toggle.

## Scope

- A `ConnectorRegistry` that aggregates the SPI capability metadata (`kind`, `displayName`, `authKind`, `supportsIncremental`, required config fields) for every registered connector; make `DataSourceKind.All` derive from the registry so adding a connector is one registration.
- Read endpoint (e.g. `GET /api/connectors`) returning the registry for the frontend `SourceTypeToggle`/`AddSourceModal` and for an MCP read tool.
- helio-mcp: a `list_connectors` read tool (`helio-mcp/src/tools/read.ts` + `helioApi.ts`) so an agent can enumerate available connectors and their required inputs before calling a create tool.
- Frontend: drive `SourceTypeToggle.tsx` from the registry rather than a hardcoded list (behavior-preserving for existing kinds).

## Acceptance criteria

- Every existing kind (csv/rest_api/sql/static/text/pdf/image) appears in the registry with correct capability metadata; `DataSourceKind.parseKind` still accepts exactly the same set.
- `GET /api/connectors` and the MCP `list_connectors` tool return the registry; no credentials or secret field values are included (field descriptors only).
- Adding a connector requires only a registry registration to appear in the menu.
- Backend + MCP tests; frontend renders the same toggle options as before for current kinds.
- Backward-compatible.

## Out of scope

- Building any new connector.

## Dependencies

- Blocked by HEL-449 (Connector SPI capability metadata) — already shipped on main (`d6fe6a45`).

## Epic context

Sixth and final ticket of HEL-429 "Connector Framework Hardening" (v1.9 Data Connectors). All five predecessors are on `origin/main`:

- HEL-449 Connector SPI (`Connector[Config]` trait, `ConnectorMetadata`) — `d6fe6a45`
- HEL-473 schema-inference facade — `ca65465d`
- HEL-468 uniform fetch-error envelope — `6dbcf4cd`
- HEL-460 secret redaction seam (`SecretField`/`HasSecrets`/`SecretRedaction`) — `5da8c5ad`
- HEL-480 connection-test endpoint + `TestConnectionAffordance` — `ee8d5dbf`

This ticket is the capstone: a registry enumerating connectors with their capability metadata, so an agent (via helio-mcp) can discover "what can I connect to and what does each need." No siblings remain after this ticket. Do NOT absorb scope from the connector-specific epics (HEL-424 Sheets, HEL-425 warehouses, HEL-426 object storage, HEL-427 advanced REST) — the registry should be built so those future connectors register into it cleanly, but this ticket does not build them.

## Investigation notes (pre-planning, orchestrator)

- **Only `SqlConnector` and `RestApiConnector` implement the `Connector[Config]` SPI trait today.** `csv`/`static`/`text`/`pdf`/`image` are upload/content-based kinds with no live `Connector[Config]` instance (no `testConnection`/`fetch` semantics — they're file-backed, not live-queried). The registry must still enumerate all 7 kinds with correct capability metadata per the acceptance criteria, so its aggregation unit should be `ConnectorMetadata` values (not `Connector[_]` existentials) — real SPI connectors expose theirs via `.metadata`, and the 5 content kinds get static `ConnectorMetadata` values registered directly, without requiring full Connector[Config] implementations (which would risk drifting into "building new connectors," out of scope).
- **`ConnectorMetadata` (HEL-449) currently has 4 fields: `kind`, `displayName`, `supportsIncremental`, `authKind`.** It does NOT carry a "required config fields" list. The ticket's scope bullet asks the registry to expose "required config fields" per connector — this requires widening `ConnectorMetadata` (or wrapping it in a registry-level entry type) with a field-descriptor list. `Connector.scala`'s doc comment anticipated this ("HEL-484 may widen it to a sealed trait" — referring to `authKind`, but the same widening allowance applies to the metadata surface generally, since HEL-449's design doc explicitly named HEL-484 as the aggregation owner of the metadata surface). This is additive (new field on a case class with no existing wire consumers), not a breaking change.
- **Sibling ownership map** (`openspec/changes/archive/2026-07-24-connector-spi-shared-trait/design.md`) explicitly assigns "Connector registry + capability aggregation" to HEL-484 with no listed overlap — confirmed no scope conflict with the other four predecessor tickets.
- **`DataSourceKind.All`** (`backend/src/main/scala/com/helio/domain/DataSource.scala`) is a `Set[String]` of the 7 kinds; `parseKind` validates against it. Must derive from the registry post-change, with identical accepted-set behavior.
- **Existing MCP precedent**: `helio-mcp/src/tools/read.ts` registers read tools as thin pass-throughs (`guarded(() => api.xxx())` returning JSON verbatim). `list_connectors` should follow the same pattern; wire a matching `HelioApi` method in `helioApi.ts`.
- **Frontend**: `SourceTypeToggle.tsx` (`frontend/src/features/sources/ui/SourceTypeToggle.tsx`) currently hardcodes 7 buttons with a `SourceType` union type. Must be driven by the registry response while staying behavior-preserving (same 7 options, same labels/order) for current kinds.
- **Repo-wide gotcha**: spray-json omits `Option = None` entirely from the wire (not `null`) — if any registry field is optional, normalize absent→null at the frontend/MCP boundary and test with the key OMITTED.
- **Mechanism requirement**: any design claim like "every kind appears in the registry" or "the registry stays in sync with `DataSourceKind`" needs a test that FAILS when a kind is added without registering — not a prose promise.
