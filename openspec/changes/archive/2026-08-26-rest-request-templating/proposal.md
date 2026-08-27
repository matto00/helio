## Why

No templating exists anywhere in the REST fetch path today — `endpoint`, `queryParams`, `headers`,
and `body` are used verbatim. This is the spine's last child before agents/UI author against a
fixed syntax; the syntax choice is expensive to reverse once tickets/UI depend on it.

## What Changes

- Add `{{name}}` (mustache-style) placeholder syntax, resolved against a new
  `RestApiConfig.parameters: Map[String, String]` field (source-level, static defaults).
- A shared `TemplateInterpolator` resolves placeholders in `endpoint`, `queryParams` values,
  `headers` values, and `body` (when present), called from
  `RestApiConnectorDriver.buildResolvedRequest` (Connector-resolving: create/infer/test/refresh/
  pipeline-run — the only path with a `parameters` store to resolve against). The ephemeral
  bare-`url` path (`buildEphemeralRequest`, ephemeral infer/test) has no `RestSource`/
  `parameters` at all, so `{{...}}` reaching it is left as **literal text**, unchanged — the
  backward-compatible choice for a path that works today and is out of this ticket's authoring
  surface (see design.md Non-Goals for why this satisfies the AC's authoring-time coverage).
- Unresolved variable → fail loud, curated error naming the variable (never silent/blank).
- Context-appropriate escaping: query-param values pass through Pekko's existing `Uri.Query`
  percent-encoding unmodified; endpoint-segment substitutions are percent-encoded as an opaque
  literal (cannot introduce `/`, `?`, `#`); header values are substituted raw then rejected if
  they contain CR/LF (header-injection guard); JSON body substitutions are JSON-string-escaped.
- The decrypted Connector credential is never inserted into the parameters map available to
  interpolation — structurally not addressable, not just discouraged by convention. Tested with
  hostile templates naming common credential-like variable names.
- `RestApiConfigPayload`/`DataSourceConfigCodec` wire/decode `parameters` (default empty map);
  a source with no parameters and no `{{...}}` syntax behaves byte-identical to today.

## Capabilities

### New Capabilities
(none — this extends the existing REST connector capability, not a new one)

### Modified Capabilities
- `rest-api-connector`: adds templated-value resolution to endpoint/query/header/body
  construction, with fail-loud-on-unresolved and escaping-per-context requirements.

## Impact

- `RestApiConfig` (model.scala): new `parameters` field.
- `RestApiConnectorDriver.scala`: new `TemplateInterpolator` object; `buildResolvedRequest`/
  `buildEphemeralRequest` call it.
- `RestApiConfigPayload`/`DataSourceConfigCodec` (wire + decode/encode).
- No new table; no RLS allowlist entry needed (parameters lives inside `data_sources.config`
  JSONB, same as every other `RestApiConfig` field).
- Does not touch HEL-822's dual-support bare-`url` create path (still works, unchanged) and does
  not implement HEL-826's body-as-HTTP-entity wiring (only templates the `body` string itself).

## Non-goals

Run-time (per-pipeline-run) parameter overrides and workspace-level shared values — both named
by the ticket as candidate value sources, both deferred. The `parameters` field and
`TemplateInterpolator` signature are designed so a later ticket can merge run-time/workspace
maps in before calling `interpolate` (most-specific-wins precedence) without a breaking change —
see design.md. Connectors CRUD UI (HEL-824), REST body-as-entity + response shaping (HEL-826),
form parity (HEL-827), agent/MCP surface (HEL-828), in-chat credential capture (HEL-829).
