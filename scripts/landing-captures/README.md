# Landing-page capture pipeline

Rebuilds the six example dashboards the landing page (`frontend/index.html`) shows, captures them in light and dark,
measures the panel rectangles the hotspots and build-section veils sit on, and cuts the OG image. Every product image
on the page is real Helio rendering produced by this script; nothing is drawn by hand.

```bash
HELIO_API_BASE_URL=http://localhost:8080 HELIO_BASE_URL=http://localhost:5173 \
  node scripts/landing-captures/run.mjs
```

Both URLs default to the values above. In a delivery worktree pass its pinned backend and dev-server ports
(`scripts/concertino/start-servers.sh`). The run takes about 15 minutes: pipeline runs are paced under the
per-user run limit (`PIPELINE_RUN_RATE_LIMIT_PER_WINDOW`) and captures are 20 s apart (the 120 req/min API limit, and
HEL-1577 logging the session out under rapid navigation).

## What it does

1. Builds `helio-mcp` (`npm ci` only when `helio-mcp/node_modules` is absent, then `npm run build`).
2. Registers a throwaway `@example.test` account with a random password, mints a one-day PAT, and starts the repo's own
   MCP server against it. Nothing secret or session-bearing is written to disk.
3. `steps/build-launch.mjs`, `steps/build-usecases.mjs`: Launch week, Revenue, Open source and Fantasy league
   (example data), then every dashboard is set to the same 10-column layout so the panel rectangles are identical.
4. `steps/enhance.mjs`: real features. `compare: previous_run` gets two genuine runs (dataset rows are written as
   earlier data, then current; the automatic re-runs make the history), plus reference lines, an annotation and a pie
   chart. The Signups schedule is paused so a scheduled run cannot overwrite "previous run".
5. `steps/build-replicas.mjs`: rebuilds four panels each of the owner's News Overview and Building Helio boards from
   `fixtures/prod-share-data/` (the data their public share links expose), because the public viewer cannot render
   them properly (HEL-1587). One story is used throughout the news board.
6. `capture.mjs`: Playwright, 1440x720 at 2x, light and dark, in a context logged in by the same process. It refuses to
   save a page that is not the expected dashboard, blurs the news photos (they belong to their publishers), writes
   `frontend/src/landing/shots/uc-<case>-<light|dark>.jpg`, `frontend/src/landing/rects.json` (it fails if the six
   dashboards do not measure identically) and `frontend/public/landing/og.jpg` (a 1200x630 crop of the launch capture).
7. In a `finally`: tag-scoped `POST /api/workspace/teardown`, then the throwaway user row is deleted by exact id through
   `e2e/support/userCleanupCore.cjs` (it refuses anything outside the e2e throwaway domains). The dev database is shared
   between worktrees, so leftovers would be misread as bugs later.

Recapture and remeasure together: the hotspot and veil positions come from `rects.json`, which this run writes from the
same captures.

## Known workarounds

- HEL-1577: navigation under load can log the session out, hence the pacing and the dashboard check before each save.
- HEL-1589: the original Apple story's image URL is HTML-encoded and broken, so the news board uses the "Meta AI Models"
  story for both its photo and its summary.
- HEL-1588: an image panel's caption PATCH is ignored, so the replicas are created with the right caption instead.
