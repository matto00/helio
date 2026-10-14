# HEL-1562: Serve a static marketing landing page at helioapp.dev/ alongside the app

## Description

helioapp.dev has no marketing page: `/` is the app's protected home (`PanelList`, `frontend/src/app/AppRoutes.tsx`). The owner chose to keep the landing page and the app on one domain rather than move the app to an `app.` subdomain, so users never have to remember a second hostname.

Design reference (owner-approved 2026-10-13): `mockup/index.html` in the "Landing mockup + capture bundle" attachment (`hel1562-landing-bundle.tgz`), "the reel" on top of direction C. The page opens on the tagline "Give me a dashboard for…", pinned while scrolling swaps the ending and the dashboard through six examples: launch week, side-project revenue, open-source repo, fantasy league (example data), then the owner's real "morning news" and "building Helio itself" boards. Clicking a panel shows a follow-up prompt that produces what the panel shows (reference lines, comparisons, annotations, chart type). The news frame credits its sources, and its photos are blurred. Below the reel, "The center of your workflow." leads into direction C's build section, then the proof points, plans and the tagline as the close. Type per DESIGN.md v3 (owner ruling 2026-10-13): the wordmark, headlines and tagline use the sans heading face (`--font-heading`), matching the app. No eyebrows.

How the mockup's frames were made, to be reproduced by a checked-in script:

* Example dashboards: built through helio-mcp in a local demo account, with real feature configs: `compare: previous_run` with two genuine runs (earlier data, then current), reference lines, an annotation and a pie chart.
* The owner's two real boards: rebuilt locally from the data their public share links expose (panel content, Output config, schema and rows, appearance), because the public viewer can't show them properly (HEL-1587).
* Capture: Playwright, 1440×720 at 2×, light and dark, with all six dashboards sharing one 10-column layout so the hotspot rectangles are identical. Captures are paced at least 20 s apart (HEL-1577) and refuse to save if the page isn't the dashboard.

Owner requirement: every product image on the page is real Helio rendering, never a hand-drawn mock, so the page never sets expectations the app doesn't meet. The page must label them as example data. The scroll-highlight overlays use panel rectangles measured from the same capture, so recapture and remeasure together.

## What

* Landing page as static HTML, built as a second Vite entry so crawlers and link previews see real HTML without running JS. Firebase serves a real file before applying rewrites, so the landing page takes the `index.html` slot and the app shell gets its own HTML file.
* App home moves from `/` to `/home`. Every other app route stays unchanged, including `/dashboards/:id`, `/login`, `/register`, public share links and `/auth/callback`. Internal links and redirects that point at `/` as "app home" move to `/home`.
* `frontend/firebase.json`: `/` serves the landing page, and the `**` catch-all rewrites to the app shell. Cache headers move with the files (the shell HTML stays `no-cache`).
* PWA: `navigateFallbackDenylist` (`frontend/src/pwaConfig.ts`) must exclude `/`; `start_url` changes to `/home`.
* Returning users: on login the app sets a non-sensitive "signed in" hint in local storage, and clears it on logout. The landing page redirects to `/home` when the hint is present. If the hint is stale, the user just lands on the normal login redirect.
* Meta: title, description, canonical URL, Open Graph and Twitter card tags, plus an OG image.
* Calls to action: "Start free" links to `/register`. "Request beta access" calls the existing `POST /api/beta-access/request` with credentials (owner ruling 2026-10-14, see below).
* Plan numbers must not silently drift: quoted numbers (50 beta messages a day = `HELIO_BETA_DAILY_MESSAGE_LIMIT`; 30/90 days output history = `OUTPUT_HISTORY_MAX_AGE_DAYS_FREE/_BETA` if quoted) are sourced from one place, with a test that fails when the backend defaults change — or the copy drops the numbers.

## Owner rulings (2026-10-14, recorded via `concertino answer`, escalation on premise drift)

* Beta CTA (proceed-as-written): the landing page's "Request beta access" calls `POST /api/beta-access/request` with credentials. The endpoint is authenticated and takes no body. A signed-out visitor gets 401: show "create a free account first", with a link to `/register`. A signed-in caller sees what the endpoint returns: success (204), 409, 429 or 503. There is no input, so there are no validation errors.
* Owner decisions to keep (relayed from the owner's design session):
  1. News photos are blurred (they belong to their publishers), and the news frame lists its sources.
  2. Every product image on the page is a real Helio capture, never a hand-drawn mock.
  3. (Superseded 2026-10-13 ~21:15 PDT, owner via driver chat, after HEL-1571 / DESIGN.md v3 landed) Landing headlines, tagline and wordmark use sans via `--font-heading`, matching the app; landing CSS reads no `var(--font-display)`. Italic on the tagline ending and closing line is a style, kept.
  4. No eyebrows (small uppercase labels above headings).
  5. (Corrected 2026-10-14, owner via chat) Panel-hint prompts are things Helio can act on today: either what the panel shows, or a realistic next step such as an alert, a chart-type switch or a comparison. Keep all 24 mockup hints as they are.
* Screenshots (owner, 2026-10-13 ~21:15 PDT): ship the current pre-v3 captures; recapture is a follow-up the driver files. The checked-in capture pipeline stays.
* Mockup adaptations (owner, 2026-10-14): the build section's opening quoted prompt is set in the UI sans font; plan cards drop the small label above each heading and fold the tier into the heading text (e.g. "Free: Helio's API and MCP server").

## Acceptance criteria

- [ ] A signed-out visitor to `/` gets the landing page as static HTML: `curl` of `/` returns the hero text and OG tags without running JS.
- [ ] A signed-in user visiting `/` is redirected to `/home`, and `/home` renders the former app home.
- [ ] Deep links still work after a hard refresh: `/dashboards/:id`, `/pipelines/:id`, `/login`, `/register`, `/auth/callback` and the public share route all render the app.
- [ ] A browser with the previous service worker installed sees the landing page at `/` after the update. An installed PWA opens to `/home`.
- [ ] (Restated per owner ruling) "Request beta access" submits `POST /api/beta-access/request` with credentials and shows: success; the 401 "create a free account first" state linking to `/register`; and the 409, 429 and 503 states. (No validation-error state: the endpoint takes no input.)
- [ ] The page renders correctly in light and dark at 375px and at desktop width, with no horizontal scroll.
- [ ] Changing a backend default for a quoted plan number fails a test, or the copy no longer quotes numbers.
- [ ] Every product image is a capture of real Helio (light and dark), produced by a checked-in, re-runnable script. No hand-drawn dashboard markup ships.
