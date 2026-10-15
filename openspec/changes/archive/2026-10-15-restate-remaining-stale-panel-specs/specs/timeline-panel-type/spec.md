## REMOVED Requirements

### Requirement: Timeline appears in every panel-type contract surface
**Reason**: `timeline` is not a panel kind. The panel `type` enum is `text`, `markdown`, `image`, `divider`, `output`, `form` in both `schemas/panels/panel.schema.json` and `schemas/panels/create-panel-request.schema.json`, there is no `TimelineConfig` `$def`, and the helio-mcp `create_panel` and `bind_panel` tools are not registered (`helio-mcp/src/server.test.ts` lists them as removed). `timeline` is an Output kind.
**Migration**: See "Timeline is an Output kind in every Output-kind contract surface".

## ADDED Requirements

### Requirement: Timeline is an Output kind in every Output-kind contract surface
`timeline` is an Output kind rendered inside an `output` panel, and no `timeline` panel kind exists. Every contract
surface that enumerates Output `kind` values SHALL include `timeline`, matching the backend `OutputKind`: the
`kind` enums of `schemas/outputs/output.schema.json` and `schemas/outputs/create-output-request.schema.json`, and the
`kind` input of the helio-mcp `add_output` tool (`outputKindSchema`). A timeline Output's `fieldMapping` slots are `time` (required, an orderable column) and `event`
(required), and its `config` accepts the keys every Output kind accepts plus `sort`.

#### Scenario: JSON Schema enumerates timeline as an Output kind
- **WHEN** `schemas/outputs/output.schema.json` is inspected
- **THEN** its `kind` enum includes `"timeline"`, and the panel `type` enum in `schemas/panels/panel.schema.json` does not

#### Scenario: MCP Output tools accept timeline
- **WHEN** an agent calls `add_output` with `kind: "timeline"`
- **THEN** the tool's input schema accepts the kind

#### Scenario: Timeline config key is sort
- **WHEN** a timeline Output is written with `config: { fieldMapping: { time: "at", event: "what" }, sort: "desc" }`
- **THEN** the write is accepted
