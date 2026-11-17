# HEL-1705: Live Output column after HEL-1685: refresh unfocused server-resolved Outputs; compare overlay and plain-chart tile; deterministic server column order

## Description

HEL-1685 addenda the owner deferred on 2026-10-22: D `keep-defer-followup`, E `defer-followup`, H `defer-followup`. Parent epic HEL-1570. Related: HEL-1632, HEL-1685.

* **D:** a server-resolved Output that is not the selected step keeps showing a stale frame until it is selected. Refresh it when the draft changes, within the existing draft-preview budget and limits.
* **E:** the live Output column has no compare overlay, and no tile for a plain unaggregated chart. Render both at parity with the dashboard (reuse HEL-1632's render-parity test).
* **H:** the server's draft-preview column order is not deterministic. Make it stable and pin it with a test, so the live column and the saved Output agree.

Probe each premise before building; the lane must reproduce D and H first.

## Original addendum wording (HEL-1685 ticket.md, from HEL-1632)

- D. Stale frame: a server-resolved Output node that isn't focused shows a stale frame until it's selected.
- E. Missing features: there is no compare overlay in the column, and a plain (unaggregated) chart Output shows only the ROWS OUT tile.
- H. Server: make the saved panel's column order deterministic on the server.

HEL-1632 design.md (archive 2026-10-20-live-output-draft-column) recorded the column order as a known divergence: "a follow-up candidate: make the saved path's order deterministic server-side".

## Acceptance Criteria

- D and H are reproduced (a test that fails first) before any fix is built.
- D: an unfocused server-resolved Output refreshes when the draft changes, with no increase in draft-preview request count (one request per paced draft change, same scheduler) and within the endpoint's caps and in-flight limits; measured.
- E: the live Output column renders a compare overlay and a tile for a plain unaggregated chart, at parity with the dashboard, covered by HEL-1632's render-parity test.
- H: column order is stable and pinned by a test, so the live column and the saved Output agree.
- Checked in the running app, desktop and phone, light and dark (DESIGN.md binding).

## Out of scope (driver)

HEL-1684 (structural draft operations, queued after this lane). No Flyway migration expected. react-grid-layout stays 2.2.4.
