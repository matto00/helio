## Why

L1-L3 of the insight epic (HEL-921) registered the `insight` Output kind, built the grounding pack and stored renders
behind a read API, but nobody can author an insight in the UI and a placed insight only ever shows "Not yet rendered".
This leaf makes insights authorable and readable: the Output editor gets the insight settings, and the panel renders
the stored markdown with citation chips that lead to the cited data's provenance.

## What Changes

- Output editor: `insight` joins the create picker. A new insight settings card offers a preset picker (default
  `auto`), a checklist of the pipeline's other Outputs it reads (pre-ticked with the same-node default), a refresh
  selector (`on_run` default, `daily`, `manual`) and a collapsed "Custom prompt" disclosure. Creating an insight needs
  no typing. Free-tier users see an upsell note on the card.
- Insight panel: renders the newest `ok` render's markdown, sanitized (no raw HTML, no images, no links), with each
  `[cN]` marker that names a known citation replaced by a citation chip button.
- A chip opens the cited Output's provenance popover anchored at the chip and moves focus into it. On a public board,
  it opens the provenance of the panel that shows the cited Output; when that Output is not placed on the board, it
  falls back to the insight panel's own provenance.
- Panel states: not yet rendered (now `role="status"`), rendering (client-side, while a refresh is pending), failed
  (previous render kept with a note), quota reached (owner only), unchanged (render kept with a quiet note), a
  neutral "not updated" note for viewers, and a free-tier owner upsell.
- The panel footer shows the render time instead of the node's data time; the panel refresh action and a pipeline
  run's completion re-fetch the insight instead of the ignored rows.
- Cost, model and token counts are never displayed anywhere in this change, whatever the API returns.
- Backend (small, additive): each public insight citation gains an optional `panelId`, the id of a panel on the same
  dashboard bound to the cited Output; the cited Output id itself stays hidden.
- Deferred to L4 (HEL-1743, not merged at planning): the per-Output model selector and the manual refresh button.
  The card and panel are built with a slot for each; neither is faked.

## Capabilities

### New Capabilities
- `insight-authoring`: the insight settings in the Output editor sheet.
- `insight-panel`: the rendered insight panel, its states, sanitization and citation chips.

### Modified Capabilities
- `insight-output-kind`: the not-yet-rendered requirement now covers only Outputs with no render yet, and gains
  `role="status"`.
- `insight-render-store`: the public insight read adds an optional per-citation `panelId`.

## Impact

- Frontend: `features/pipelines/ui/outputEditor/*` (kind options, config card, build/patch config, kind state),
  `features/panels/ui/OutputPanelContent.tsx`, `InsightNotRenderedState.tsx`, panel footer and refresh wiring,
  `features/panels/provenance/*` (a reusable provenance popover opener), a new `features/panels/insight/*`
  (service, hook, renderer, chips, states), `outputKindDrift.test.ts`.
- Backend: `PublicPanelInsightResolver`, `OutputInsightProtocol` public citation shape, the public insight schema and
  its spec. No migration. Possible textual overlap with HEL-1743 in `OutputInsightProtocol.scala`.
- e2e: a new spec plus a test-only seed helper that writes an `output_insights` row through the e2e DB connection.
