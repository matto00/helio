# HEL-1420: Owner usage page: add all-time totals (signups, users, active) and longer windows, still anonymous

## Description

**Owner request (Matt, 2026-10-08/09, via AskUserQuestion): all-time totals only.** No user list; the page stays identifier-free (HEL-1211).

Context: prod has 8 users, signed up 2026-04-26 to 2026-08-17. `/admin/usage` shows only a `days` window (1..90, default 30) ending at `rolled_through` (~ today - 2), so none of them appear in the default view and 6 of 8 can't appear at any setting. Verified 2026-10-09 by a read-only prod query: every user has a `signup_completed` event (V114 backfill) and the rollups are current (`rolled_through` 2026-10-07).

## Scope

* All-time headline totals: total users (signups to date), and active in the last 7/30 days. Read from the rollups (`product_event_daily` all-time sum) or a cheap aggregate. Never return identifiers; keep the HEL-1211 anonymity contract and its "no user identifiers" test.
* Longer windows: allow e.g. 180/365 days or "all", sized against the cost of the existing per-day series (it's daily rows, so cheap). Decide the cap in design.
* Show the window's end date (`rolled_through`) clearly on the page, so a ~2-day lag isn't read as missing data.
* Exclude the system user (see the sibling ticket HEL-1421) from totals once that's decided.

## Acceptance criteria

* With the prod-like fixture (8 users created 53-166 days ago), the page shows total users = 8 (or 7 excluding the system user) and correct active counts. Red-first on the API.
* Response stays identifier-free (existing guard stays green).
* Owner-only, as today (`guardOwner`).
