## ADDED Requirements

### Requirement: Markdown content resolves bound data over literal content

At render time, a Markdown panel SHALL resolve its content as the bound DataType field's mapped value
(`data.content`, populated by the generic per-slot mapping in `usePanelData`) when present, falling back
to the literal `config.content`. Empty resolved content SHALL render the existing placeholder state.

#### Scenario: Bound panel renders pipeline-produced markdown
- **WHEN** a Markdown panel is bound to a DataType whose latest rows contain a markdown string in the
  mapped field
- **THEN** the grid panel renders that string as Markdown

#### Scenario: Unbound panel renders literal content
- **WHEN** a Markdown panel has no binding and non-empty `config.content`
- **THEN** the grid panel renders the literal content as Markdown

### Requirement: Markdown source/static editing mirrors the sibling field-or-literal pattern

The Markdown Content editor SHALL compose `useBoundOrLiteralState`, a Source-mode-only `DataTypePicker`
(filtered to pipeline-output DataTypes), and `BoundOrLiteralField` with `literalMultiline`, mirroring the
Text panel's Content editor. Mode SHALL default to Source for a bound panel and Static for an unbound
one. Saving in Source mode SHALL set `dataTypeId`/`fieldMapping.content` and omit `content` from the
patch (preserving prior literal text); saving in Static mode SHALL clear the binding (explicit nulls) and
set `content`.

#### Scenario: Source save omits content from the patch
- **WHEN** the user saves the Content editor in Source mode with a DataType and field selected
- **THEN** the PATCH `config` contains `dataTypeId` and `fieldMapping: { "content": "<field>" }` and no
  `content` key

#### Scenario: Static save clears the binding explicitly
- **WHEN** the user saves the Content editor in Static mode on a previously bound panel
- **THEN** the PATCH `config` contains `dataTypeId: null`, `fieldMapping: null`, and the authored
  `content`

### Requirement: helio uploads URL scheme resolves to the uploads route

Markdown rendering SHALL resolve URLs of the form `helio://uploads/image/<id>` to
`/api/uploads/image/<id>` via a custom react-markdown `urlTransform`, for both image and link URLs. The
`<id>` SHALL be validated as a single safe path segment before substitution. All other URLs SHALL pass
through react-markdown's default URL sanitization (`defaultUrlTransform`), so unknown protocols remain
stripped. Resolution SHALL target the uploads route only — never filesystem paths — keeping it
storage-backend agnostic (`HELIO_UPLOADS_BACKEND` local/gcs).

#### Scenario: helio image ref resolves to the uploads endpoint
- **WHEN** markdown content contains `![chart](helio://uploads/image/123e4567-e89b-12d3-a456-426614174000)`
- **THEN** the rendered `<img>` has `src="/api/uploads/image/123e4567-e89b-12d3-a456-426614174000"`

#### Scenario: Plain uploads-route URL still renders
- **WHEN** markdown content contains `![chart](/api/uploads/image/<id>)`
- **THEN** the rendered `<img>` uses that relative URL unchanged

#### Scenario: Non-uploads helio URL is not rewritten
- **WHEN** markdown content contains a URL like `helio://something/else`
- **THEN** it is not rewritten to the uploads route and falls through default sanitization

#### Scenario: Unsafe id segment is not substituted
- **WHEN** markdown content contains `helio://uploads/image/../secrets`
- **THEN** the URL is not rewritten to an uploads-route path

### Requirement: Rendered markdown images are constrained to the panel

Images rendered inside a markdown panel SHALL be constrained to the panel's width (no horizontal
overflow), on both the desktop grid and the mobile panel stack (<768px).

#### Scenario: Wide image fits the mobile panel stack
- **WHEN** a markdown panel containing an uploaded-image ref wider than the viewport renders in the
  mobile panel stack at a phone viewport (~390px wide)
- **THEN** the image scales down to the panel width without horizontal overflow of the mobile shell

### Requirement: The uploaded-image URL scheme is documented

The repository documentation SHALL describe the `helio://uploads/image/<id>` scheme: where refs can be
used (markdown panel content), what they resolve to (`GET /api/uploads/image/:id`), how ids are obtained
(`POST /api/uploads/image`), and that raw `/api/uploads/image/<id>` URLs also render.

#### Scenario: Docs describe the scheme end-to-end
- **WHEN** a reader consults `docs/uploads.md`
- **THEN** it documents the upload endpoint, the byte-serving endpoint, and the `helio://` markdown
  reference scheme with an example
