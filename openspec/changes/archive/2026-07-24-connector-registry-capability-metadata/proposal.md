## Why

`DataSourceKind.All` is a hardcoded `Set[String]`, and nothing enumerates connectors with their
capability metadata — an agent (via helio-mcp) or the frontend "Add source" toggle has no way to
discover what kinds exist and what each needs. HEL-449 built `ConnectorMetadata` for exactly this
aggregation; this ticket (the capstone of HEL-429) builds the registry that consumes it.

## What Changes

- Add `ConnectorRegistry` (`com.helio.domain`) aggregating a `ConnectorMetadata` entry per source
  kind — `SqlConnector`/`RestApiConnector` contribute their existing `.metadata`; the five
  content/upload kinds (csv/static/text/pdf/image, which have no live `Connector[Config]` instance)
  get static `ConnectorMetadata` values registered directly. **BREAKING (additive, no wire
  consumers yet)**: widen `ConnectorMetadata` with a `requiredFields: Vector[ConnectorFieldDescriptor]`
  entry describing each kind's required config fields (name/label/secret-flag; no values).
- `DataSourceKind.All` derives from `ConnectorRegistry.all.map(_.kind).toSet` instead of a literal
  set; `parseKind` behavior is unchanged (same 7-member set). A test asserts the registry and
  `DataSourceKind.All` never drift (fails if a kind is added to one without the other).
- Add `GET /api/connectors` returning the registry as JSON (no secret values, ever).
- helio-mcp: `list_connectors` read tool (`helio-mcp/src/tools/read.ts` + `helioApi.ts`) returning
  the same registry payload verbatim, following the existing `guarded(() => api.xxx())` pattern.
- Frontend: `SourceTypeToggle.tsx` renders its buttons from the registry response instead of a
  hardcoded list — behavior-preserving (same 7 options, same order/labels) for existing kinds.

## Capabilities

### New Capabilities
- `connector-registry`: `ConnectorRegistry` aggregation, `GET /api/connectors`, the MCP
  `list_connectors` tool, and the registry-driven `SourceTypeToggle`.

### Modified Capabilities
- `connector-spi`: the "Connector capability metadata" requirement's `ConnectorMetadata` field list
  gains `requiredFields`.

## Non-goals

- Building any new connector (csv/424/425/426/427 connector-specific work).
- Widening `authKind` into a sealed trait (still a plain `String`; unrelated to this ticket's scope).
- Wiring `POST /api/sources`/`/infer`/`/test` to read `requiredFields` for validation — the registry
  is a read/discovery surface only.

## Impact

- `backend/src/main/scala/com/helio/domain/Connector.scala` — widen `ConnectorMetadata`.
- `backend/src/main/scala/com/helio/domain/ConnectorRegistry.scala` — new.
- `backend/src/main/scala/com/helio/domain/DataSource.scala` — `DataSourceKind.All` derivation.
- `backend/src/main/scala/com/helio/api/routes/` — new `GET /api/connectors` route.
- `backend/src/main/scala/com/helio/api/protocols/` — new wire types + JSON format.
- `helio-mcp/src/tools/read.ts`, `helio-mcp/src/helioApi.ts` — new `list_connectors` tool.
- `frontend/src/features/sources/ui/SourceTypeToggle.tsx` and its callers — registry-driven.
- `openspec/specs/connector-spi/spec.md` — MODIFIED via this change's delta at archive time.
