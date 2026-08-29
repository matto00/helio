# HEL-861: Surface REST row-cap truncation instead of silently capping runs at 1000 rows

## Description

`InProcessPipelineEngine.maxRunRows = 1000` is passed to every `ConnectorDriver.fetch` and to `SqlConnectorDriver.fetch`. The cap is deliberate and documented in code as a memory bound. The defect is not the cap — it is that **nothing anywhere tells the caller the cap was applied**.

A source over a 3,303-row JSON array reports `sourceRowCount: 1000` on every run. There is no warning at source creation, none in `analyze_pipeline`, none in the run result. A downstream `filter` then returns plausible-looking results computed over a truncated population: a "top 10 receivers" panel silently becomes "top 10 among an arbitrary first 1000 rows, ordered by whatever the API happened to return". There is no signal to distrust it.

Repro: `https://api.sleeper.app/projections/nfl/2026?season_type=regular&order_by=pts_ppr&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K&position[]=DEF` returns 3,303 rows; `run_pipeline` reports `sourceRowCount: 1000`.

### Corrected code references (ticket body was stale; re-derived against main @83e99a0e)

The ticket says `services/pipeline/InProcessPipelineEngine.scala:40` with fetch call sites at lines 136/141. Actual, verified by enumeration:

- `backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala:65` — `private val maxRunRows: Int = 1000`
- same file `:176` — `connector.fetch(r.config, maxRunRows, ConnectorResolveContext.Internal)`
- same file `:181` — `SqlConnectorDriver.fetch(s.config, maxRunRows, ConnectorResolveContext.Internal)`

`maxRunRows` occurs exactly three times in the entire tree, all in that one file. Any statement about "the call sites of the cap" must be re-derived from that enumeration, not from the ticket's line numbers.

## Scope

- Add an explicit truncation signal to the run result — a truncation flag alongside the number of rows actually available — and surface it at source creation too.
- Propagate it to **both** the MCP surface and the UI. A flag nobody renders is not a fix; the whole point is that a caller, human or agent, can tell the number is partial.
- Keep the memory bound intact. Do **not** raise the cap as a substitute for reporting it.
- Pagination is **out of scope** (HEL-427 owns it). Honest truncation now beats complete data later.
- Schemas/openspec updated in the same change, per CLAUDE.md.

## Acceptance criteria

- [ ] A run over a source with more rows than the cap reports truncation explicitly, including how many rows were available.
- [ ] A run under the cap reports no truncation (no false positives).
- [ ] The signal is visible through both the MCP surface and the UI, not only in the raw API payload. A truncated run must be **distinguishable from a complete one** in the text an MCP caller reads and in what a human sees on screen — not merely a boolean present in a backend JSON response.
- [ ] The 3,303-row repro shape surfaces truncation with an available-row count of 3303.
- [ ] The existing 1000-row memory bound is unchanged.
- [ ] Schemas/openspec updated for the new run-result fields.
- [ ] Wording is behaviour: whatever is surfaced must lead a caller acting on it to a correct conclusion. A bare "truncated: true" with no row count invites the reader to guess and does not satisfy this.
