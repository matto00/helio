# HEL-1372: History payloads toggle: review notes from HEL-1331

## Description

Non-blocking review notes on HEL-1331 (PR matto00/helio#827, f268edf8f):

1. **Unsaved edits lost:** clicking "Request Beta access" in the Output editor navigates to `/settings#beta-access` without prompting, so unsaved edits are thrown away. Prompt first, or open the link in a way that keeps the editor state.
2. **Hard-coded numbers:** the cap and retention figures in the help copy (1,000 rows / 1 MiB; 10 runs, 7 days; 30 runs, 30 days) are hard-coded in the frontend, so an env override such as `PAYLOAD_HISTORY_MAX_ROWS` makes them wrong. Consider serving them from the backend alongside `historyPayloadsAvailable`.
3. **Styling:** the disabled-state note renders larger than the help text above it. Align it with DESIGN.md.
4. **Product note, no change implied:** a beta user editing a pipeline owned by a free-tier user sees the upsell. That follows from the owner's ruling that the pipeline owner's tier gates the toggle; it is recorded here only for awareness.

## Scope (driver ruling)

Items 1–3 are in scope; item 4 is out of scope (no change). Items 1 and 2 are owner decisions, raised as one escalation before planning artifacts are drafted. Avoid `compareOptions.ts` and helio-mcp output docs (HEL-1285 lane).

## Owner rulings (escalation HEL-1372-1791416414636-b1b423, answered via chat)

- Item 1: **new-tab**. The "Request Beta access" link opens `/settings#beta-access` in a new tab; the editor and its unsaved edits stay untouched.
- Item 2: **backend-field**. Output responses carry a read-only `historyPayloadLimits` object read from the same `PayloadHistoryConfig` the server enforces; the frontend constant is removed. The JSON schema change ships in the same change. Since HEL-1285 has merged, `helio-mcp/src/tools/outputs.ts` also stops hard-coding the numbers and points at the field.

## Acceptance criteria

1. Clicking "Request Beta access" opens Settings (Beta access section in view) in a new browser tab; the Output editor in the original tab keeps its unsaved edits. The link's accessible name says it opens in a new tab.
2. Every Output REST response that carries `historyPayloadsAvailable` also carries a read-only `historyPayloadLimits` object (max rows, max bytes, per-tier runs and age in days for free/beta/owner) from the running server's `PayloadHistoryConfig`, including env overrides. `schemas/outputs/output.schema.json` documents it.
3. The Output editor help text renders the cap and retention figures from `historyPayloadLimits`; no frontend constant holds them. With an overridden config (e.g. 500 rows), the editor shows the overridden figures.
4. helio-mcp's `update_output` description and `OutputResponse` type reference `historyPayloadLimits` instead of hard-coded figures.
5. The disabled-state note uses the same type size and token as the help text above it (DESIGN.md), and is legible in light and dark themes.
