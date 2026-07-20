## ADDED Requirements

### Requirement: Panel composition tools accept image caption and chart annotation

The MCP panel create/update tool surface SHALL accept an optional `caption` on image-panel `config` and
an optional `annotation` on chart-panel `config`, passing each straight through to the panel API so
agent-built dashboards can attach static caption/annotation text. The tool descriptions SHALL document
both fields on the respective panel `config` shapes. Omitting either field SHALL preserve today's
behavior (no caption/annotation).

#### Scenario: Agent creates an image panel with a caption
- **WHEN** an agent calls the create tool with `type: "image"` and `config: { imageUrl: "...",
  caption: "Hero photo — Reuters" }`
- **THEN** the created image panel persists with that `caption` and the dashboard renders its caption
  strip

#### Scenario: Agent sets a chart annotation
- **WHEN** an agent creates or updates a chart panel with `config.annotation: "Source: BLS"`
- **THEN** the panel persists with that `annotation` and renders it as a subtitle/footnote

#### Scenario: Omitting caption/annotation preserves current behavior
- **WHEN** an agent creates an image or chart panel without a `caption`/`annotation`
- **THEN** the panel is created with no caption/annotation, exactly as before this change
