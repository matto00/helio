## Why

There is no single place to see what changed and what ran. The owner wants dashboard previews and pipeline runs side by
side (HEL-1578, epic HEL-1570, board "B2 · Home"). Today `/home` is the dashboard view itself and the rail's Home item
only aliases it (HEL-1574).

## What Changes

- New **Home page** at `/home`, the landing after sign-in (owner answer `home-at-home`): a mono date eyebrow and a
  templated plain-language summary sentence; a shelf of four dashboard cards with saved-layout thumbnails, relative
  update time and a "changed since your last visit" dot (`four-changed-first`); a 24h pipeline-run timeline with
  shape-coded, keyboard-focusable marks (`top-8-failures-pinned`); Needs attention (failed, stuck or missed runs,
  `stuck-or-missed`) with Open and Retry; Up next (soonest scheduled fires); designed empty states for a new user.
- The **dashboard view moves to `/dashboards`** (still opening the selected dashboard). Links whose purpose is the
  dashboard grid move with it; sign-in, `/`, the wordmark and the PWA start URL keep `/home`, which is now Home.
- The rail and phone BottomNav **Home item opens the Home page** and is marked current there.
- New endpoint **`GET /api/home-summary`**: run summaries for the 24h window, upcoming schedule fires, attention items
  and (once HEL-1575 lands) change times for the requested dashboards, in one owner-scoped (RLS) call with a JSON Schema.
- **Run retention keeps 24h** (`keep-24h`): pruning keeps the 10 newest real runs or any run started in the last 24h,
  capped at 300 per pipeline. A `(pipeline_id, started_at)` index (V136) backs the window query.

## Capabilities

### New Capabilities
- `home-page`: the Home page UI, its sections, states, and interactions.
- `home-summary-api`: the one-call summary endpoint, its contract, scoping and bounds.

### Modified Capabilities
- `nav-section-registry`: Home is a real destination, marked current on `/home`; Dashboards lives at `/dashboards`.
- `app-shell-rail`: the active-item rule and rail scenarios for Home; Home has no context list.
- `marketing-landing-page`: "app home" at `/home` is the Home page, not the dashboard list.
- `frontend-auth-ui`: sign-in and registration land on the Home page.
- `frontend-data-sources-page`, `frontend-pipelines-page`: Dashboards link/breadcrumb route is `/dashboards`.
- `pipeline-proposal-review-ui`, `first-run-onboarding`, `mobile-dashboard-sheet`: the dashboard view is `/dashboards`.
- `pipeline-run-execution`: run retention keeps the last 24h (capped), not only the last 10.

## Non-goals

- A run deep link inside the pipeline detail page (HEL-1579 is rebuilding it); Open goes to `/pipelines/:id`.
- Runs of pipelines shared with the caller (owner-only); any server-side visit store (view/own-write stamps are a
  small keyed client store beside the recent-visit list, design D5); any LLM.
- Changing HEL-1575's change-signal semantics; the dot reuses them unchanged.

## Impact

Backend: new route/service/repository query, protocol + `schemas/home/home-summary-response.schema.json`, V136 index,
retention change in `PipelineRunRepository`. Frontend: `features/home/*`, `AppRoutes.tsx`, `sections.ts`,
`navDestinations.ts`, `AppRail.tsx`, `BottomNav.tsx`, and the `navigate("/home")` call sites. Overlaps HEL-1575 (tabs,
`isDashboardViewPath`, `App.tsx`) and HEL-1579 (`CommandBar`), stated in the PR.
