## Why

HEL-1405 left living specs that still describe DataType-bound or top-level `content` behaviour the system no longer has,
a dead bound-data branch in `TextRenderer`, and a CLAUDE.md single-file test command that does not narrow from the
repository root (see `ticket.md`). Stale specs mislead every agent that grounds on them.

## What Changes

- `mcp-panel-composition-tools`: the proposal type-set requirement states the real agent-facing set
  (`text/markdown/image/output/form`, no `divider`); the config-passthrough requirement drops the deleted `collection`
  panel scenario and the "source-companion DataType id" wording, describing an `output` panel and an Output id.
- `markdown-panel`: requirements 1–2 (modified) and 3 (replaced) describe `config.content` (not a top-level `content`), and the "null content"
  requirement no longer lists `text` (or the deleted `metric`/`chart`/`table` kinds).
- `panel-content-sizing`: the text-panel "bound data" scenarios describe literal `config.content` instead.
- `panel-cross-filtering`: the markdown-Output requirement quotes the narrowing requirement's wording verbatim.
- Frontend: remove `TextRenderer`'s dead `data?.content` path and its `data` prop; add a guard test.
- CLAUDE.md: correct the single-file Jest command (if verification confirms the root form does not narrow).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `mcp-panel-composition-tools`: proposal panel type set; config passthrough scenarios.
- `markdown-panel`: content field location and the non-markdown null-content rule.
- `panel-content-sizing`: text panel sizing scenarios.
- `panel-cross-filtering`: markdown Output non-target requirement wording.

## Non-goals

- Rewriting other stale requirements in the same specs (e.g. `mcp-panel-composition-tools`'s collection/timeline/
  metricId requirements, `panel-type-rendering`'s `typeId`-based metric/chart/table/text scenarios). Recorded as a
  follow-up candidate, not fixed here.
- Changing the root `npm test` script (hook and CI depend on it).

## Impact

- `openspec/specs/*` (via archive), `frontend/src/features/panels/ui/renderers/TextRenderer.tsx`,
  `frontend/src/features/panels/ui/PanelContent.tsx` (call site), one new/extended Jest test, `CLAUDE.md` (one command
  line). No API, schema, or user-visible change.
