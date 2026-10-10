## MODIFIED Requirements

### Requirement: upload_image MCP tool

The MCP server SHALL expose an `upload_image` tool that accepts image bytes (as base64 or text) and a
filename, posts them as a single `file` multipart part to `POST /api/uploads/image`, and returns the
uploaded image's `id`, its served `url` (`/api/uploads/image/<id>`), and the
`helio://uploads/image/<id>` markdown reference usable in a markdown panel's `config.content` (or an
image panel's `config.imageUrl`).

#### Scenario: Agent uploads an image and references it in markdown
- **WHEN** an agent calls `upload_image` with image content and a filename
- **THEN** the tool returns the `id`, served `url`, and `helio://uploads/image/<id>` ref, and that
  ref renders the image when placed in a markdown panel's literal `config.content`

#### Scenario: Oversized image is rejected verbatim
- **WHEN** the uploaded image exceeds the backend's configured maximum size
- **THEN** the tool returns the backend's 413 error message unchanged, not a generic failure

### Requirement: Proposal panels accept a generic config passthrough

Each proposal panel SHALL accept an optional generic `config` object that is carried through
`apply_proposal` to `POST /api/dashboards/apply-proposal` and merged into the config the backend
derives from the flat fields, then decoded by the SAME panel-create path (`PanelConfigCodec`). This
SHALL make every v1.5 config surface expressible via a proposal — collection `baseType`/`layout`,
chart `chartOptions` (per chart type), table `density`/`columnOrder`, and text/markdown literal
`content`. On key conflict the explicit `config` SHALL win over a derived flat field, EXCEPT that a
data panel's server-resolved `outputId` binding SHALL remain authoritative so the V41 pipeline-only
binding guarantee cannot be bypassed via `config`.

#### Scenario: Collection base type and layout via proposal config
- **WHEN** an agent applies a proposal whose collection panel supplies
  `config: { baseType: "metric", layout: "grid" }` and a valid `outputId`
- **THEN** the applied panel persists as a collection with that base type and layout, bound to the
  DataType

#### Scenario: Chart chartOptions via proposal config
- **WHEN** an agent applies a proposal whose chart panel supplies
  `config: { chartOptions: { smooth: true } }` alongside its binding
- **THEN** the applied chart panel persists with those chart options

#### Scenario: config cannot bypass pipeline-only binding
- **WHEN** an agent applies a proposal whose data panel `config` attempts to override `outputId`
  with a source-companion (non-pipeline-output) DataType id
- **THEN** the flat-field binding remains authoritative and the V41 pipeline-only rule is still
  enforced
