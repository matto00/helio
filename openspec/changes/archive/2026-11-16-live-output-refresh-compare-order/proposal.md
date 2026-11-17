## Why

HEL-1685 deferred three gaps in the pipeline page's live Output column (HEL-1632). An unfocused server-resolved
Output shows a stale frame until its step is selected (D). The column has no compare overlay and a plain chart shows
only the rows-out tile (E). A saved panel's columns arrive alphabetical while the live column uses the Output's
schema order, so order-dependent renders disagree (H, premise corrected on this run and ruled by the owner).

## What Changes

- **D:** `POST /api/pipelines/:id/draft-preview` accepts an optional `rowsStepIds` list (at most 8) and streams one
  `rows` line per requested step. The client asks, on the same single paced request, for the focused step and the
  displayed Output's node. No added requests per draft change; memory stays within `DraftPreviewHeapSpec`'s bound.
- **E:** the live column draws the dashboard's compare overlay (`selectChartOverlay`) and metric delta from the
  Output's own `config.compare` baseline over the draft rows, and a plain (unaggregated) chart gets a `LATEST <Y>`
  tile (the last plotted point of the y field).
- **H:** `GET /api/outputs/:id/rows`, the public panel rows route and the history-payload rows route return each row's
  keys in the Output's schema order plus a `columns` list; the client builds headers from `columns`, so integer-like
  keys keep their place. **Behaviour change:** panels with no column config or no x-axis mapping change their default
  column order to schema order: charts from alphabetical, tables from natural sort (owner accepted).

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-draft-preview-api`: rows lines for several requested steps.
- `pipeline-live-output-column`: unfocused Output refresh, compare overlay, latest-y tile, schema-order agreement.
- `output-routes-api`: rows responses carry schema-ordered keys and a `columns` list.

## Impact

Draft-preview backend and client, the three rows read paths, the live Output column, panel data hooks, and the
JSON schemas for the draft-preview request and the three rows responses. No migration.

## Non-goals

HEL-1684 structural draft operations; sparklines in the live column; any change to the scheduler's pacing.
