# HEL-1331: UI + MCP toggle for outputs.config.historyPayloads

## Description

origin_kind: followup
origin_ticket: HEL-1276

HEL-1276 (L6) shipped `outputs.config.historyPayloads`. It is a boolean, off by default, and settable only through `PATCH /api/outputs/:id`. There is no UI toggle and no MCP tool or parameter for it. L7 (HEL-1277, the changed-rows highlight) relies on payloads, so users need a way to turn them on.

## Acceptance Criteria

* Add a toggle in the Output editor that shows the cap behaviour: ≤1000 rows and ≤1 MiB; a run over the cap stores no payload and keeps its summary. Show that free tier stores nothing.
* Add helio-mcp support through `update_output`'s config, documented in the tool description.
* Test both the UI and MCP paths. Check the UI against the running app in both themes.
* **Needs owner ruling:** the UI copy, and whether free-tier users see the toggle disabled with an upsell or don't see it at all.

## Owner Rulings

Recorded 2026-10-07 via `concertino answer` (escalation HEL-1331-1791404586338-27010a, channel chat, answer_source human). Option A chosen for all four.

1. **Free tier (Q1):** the toggle is visible but DISABLED, with the note "Free stores run summaries only" and a "Request Beta access" link to Settings (Beta access section).
2. **Copy (Q2):** label "Keep each run's rows"; help text: "Stores the full rows of every run from the next run on, so History can show what changed. A run over 1,000 rows or 1 MiB keeps only its summary. Beta keeps the last 10 runs for 7 days; Owner keeps 30 runs for 30 days."
3. **Tier gating (Q3):** gate on the PIPELINE OWNER's tier via a new read-only boolean `historyPayloadsAvailable` on the Output response (computed server-side from the pipeline owner's tier and the payload retention config), NOT on the viewer's `User.tier`. The schema change ships in this same change.
4. **Opt-out (Q4):** no purge on opt-out; stored rows expire on the normal retention schedule, and the help text says so (e.g. "Turning this off stops storing rows; rows already kept expire on the normal schedule.").

## Additional Acceptance (from rulings)

* `historyPayloadsAvailable` is present on every Output REST route response (GET/POST /api/pipelines/:id/outputs, GET/PATCH /api/outputs/:id, GET /api/outputs), true exactly when the pipeline owner's tier keeps at least one payload run (maxRuns > 0 and maxAge > 0), documented in the Output response schema(s), with backend tests covering free/beta/owner owners and a cross-tier editor-grantee case.
* The MCP `update_output` description documents `historyPayloads` (caps, tier rule, opt-out behaviour) and points at `historyPayloadsAvailable`.

