# HEL-1578: Home page: dashboard shelf + 24h pipeline run timeline, Needs attention, Up next

## Description

There's no single place to see what changed and what ran. The owner wants dashboard previews and pipeline runs side by side, to better track what runs and when.

A new **Home** route (first rail item, and the default landing page after sign-in; this replaces landing on the last dashboard. Confirm with the owner in the PR):

* **Opening line:** a mono date/time eyebrow plus one plain-language summary sentence built from data (e.g. "Two dashboards changed overnight. One run failed, everything else is quiet."). Generated with templates, not an LLM.
* **Dashboard shelf:** 4 or more cards with a small layout thumbnail (panel boxes from the saved layout, no live data), name, relative update time, and a "changed since your last visit" dot. "All N →" links to the list.
* **Pipeline runs, last 24h:** one row per pipeline (top N by recent activity), with run marks coloured by status (ok / failed / scheduled-future), a "now" line, and hour labels. Hover/focus on a mark shows run details. Click opens the run.
* **Needs attention:** failed or stalled runs with the reason, plus Open and Retry.
* **Up next:** the next scheduled runs (from pipeline schedules).
* Backend: an endpoint that returns run summaries for the window and upcoming schedule fires in one call (with schema, OpenAPI and tests). Reuse the existing recent-visit data for "changed since last visit".
* Reference: "B2 · Home" on the epic's canvas (`/home/matt/Development/helio/.concertino/design/HEL-1570/` — HANDOFF.md, README.md, screenshots/Home.png, canvas/project/Home.dc.html; illustration only).

## Acceptance criteria

- [ ] Home loads in one summary API call plus the existing dashboards list, with no per-pipeline fan-out (verified via network log)
- [ ] The timeline shows real run history for the last 24h with ok/failed/scheduled distinguishable by more than hue alone, and each mark is keyboard-focusable with an accessible label
- [ ] A failed run appears under Needs attention with its error, and Retry triggers a run subject to the existing run guards (HEL-505)
- [ ] The "changed" dot clears for a dashboard after the user opens it
- [ ] Empty states for a new user (no dashboards, no pipelines) are designed and tested

## Driver-relayed context (claims, verified in premise-validation.md)

- Binding: DESIGN.md v3 incl. §0 tone (plain-language copy, "human touch") and §9 Shell.
- HEL-1574 owner rulings `home-points-to-dashboards` and `keep-six-1583-decides` (HEL-1574 events.jsonl). This ticket repoints Home, in the rail AND the phone BottomNav, to the real Home page.
- HEL-1562: app home is `/home`, `/` is a marketing page.
- "Changed" dot: owner ruling `data-or-edit` — new data or someone else's edits, never your own saves. Reuse HEL-1575's server signal (`dashboard-change-signals`), never a second mechanism.
- Summary endpoint: one call; schema, tests, RLS proven in a non-BYPASSRLS session; no per-pipeline fan-out; Retry uses the existing HEL-505 run guards.
- Precedence: ticket AC + owner rulings > DESIGN.md v3 > HANDOFF.md > board.
