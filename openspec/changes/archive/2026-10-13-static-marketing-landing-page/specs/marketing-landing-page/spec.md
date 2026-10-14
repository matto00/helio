## Purpose

A static marketing landing page at the site root (`/`) that crawlers and link previews can read without running
JavaScript. It sits alongside the app on the same domain, sends returning users to the app, and shows only real
Helio captures produced by a checked-in pipeline.

## ADDED Requirements

### Requirement: Landing page is static HTML at the site root
A request for `/` SHALL return the landing page as a complete HTML document. The response body SHALL contain the hero
headline text ("Give me a dashboard for"), a `<title>`, a meta description, a canonical link to `https://helioapp.dev/`,
Open Graph tags (`og:title`, `og:description`, `og:url`, `og:image` as an absolute URL, `og:type`) and Twitter card
tags (`twitter:card` = `summary_large_image`, `twitter:title`, `twitter:description`, `twitter:image`). All of these
SHALL be present in the served HTML without executing JavaScript. The landing page SHALL NOT load the app's JavaScript
bundle.

#### Scenario: curl sees the hero and the OG tags
- **WHEN** a client without JavaScript requests `/` from the production build
- **THEN** the response body contains "Give me a dashboard for", every listed meta/OG/Twitter tag and the canonical
  link
- **THEN** the response loads no script belonging to the app shell

#### Scenario: OG image resolves
- **WHEN** a client requests the URL in `og:image`
- **THEN** it receives an image of at least 1200×630 cut from a real Helio capture

### Requirement: The app is served for every other path
Every navigation to a path other than `/` that does not name a built file SHALL be served the app shell. This SHALL
hold identically for the production hosting config, the dev server and the preview server. A hard refresh on
`/home`, `/dashboards/:id`, `/pipelines/:id`, `/login`, `/register`, `/auth/callback` and the public share route
`/dashboards/:dashboardId/panels` SHALL render the app. The app shell HTML and the landing HTML SHALL both be served
with `Cache-Control: no-cache` in production.

#### Scenario: Deep link after a hard refresh
- **WHEN** the browser hard-refreshes on `/dashboards/<id>`
- **THEN** the app shell loads and renders that dashboard route

#### Scenario: Root is not rewritten
- **WHEN** the browser requests `/`
- **THEN** the landing page is served, not the app shell

### Requirement: App home lives at /home
The app's home view (the dashboard list formerly at `/`) SHALL be served at `/home`. An in-app client-side navigation
to `/` SHALL redirect to `/home`. Every in-app link, button or redirect whose destination is "app home" SHALL target
`/home`.

#### Scenario: Signed-in user opens /home
- **WHEN** an authenticated user navigates to `/home`
- **THEN** the former app home renders

#### Scenario: Wordmark goes home
- **WHEN** an authenticated user clicks the app's wordmark
- **THEN** the app navigates to `/home`

### Requirement: Returning users skip the landing page
The app SHALL store a non-sensitive "signed in" hint in `localStorage` whenever auth status becomes authenticated
(login, registration, OAuth callback, MFA verification or session rehydration). It SHALL remove the hint whenever auth
status becomes unauthenticated (logout, a failed session check, or a 401). The hint SHALL contain no credential,
token or user identifier. When the hint is present, the landing page SHALL redirect to `/home` before first paint.
When it is absent, the landing page SHALL render normally.

#### Scenario: Signed-in user visits the root
- **WHEN** a user who has signed in on this browser visits `/`
- **THEN** they are redirected to `/home` and see the app home

#### Scenario: Stale hint
- **WHEN** the hint is present but the session has expired
- **THEN** the user is redirected to `/home`, the app's session check fails, the hint is removed and the user lands
  on `/login`

#### Scenario: Logout clears the hint
- **WHEN** the user logs out and then visits `/`
- **THEN** the landing page renders

### Requirement: Calls to action
"Start free" SHALL link to `/register` and "Sign in" SHALL link to `/login`. "Request beta access" SHALL send
`POST /api/beta-access/request` to the configured API base URL with credentials and the CSRF header the API requires,
and SHALL show an inline, announced status for each outcome:
- 204: success (the request was sent).
- 401: the visitor is signed out. Show "create a free account first" with a link to `/register`.
- 409: the account already has beta access.
- 429: a request was sent recently; try later.
- 503: beta requests are not available right now.
- Any other status or a network failure: a generic retryable error.

There is no input and no validation-error state. The control SHALL be disabled while a request is in flight.

#### Scenario: Signed-out visitor requests beta
- **WHEN** a visitor without a session clicks "Request beta access"
- **THEN** the page shows the create-a-free-account message with a link to `/register`

#### Scenario: Email not configured
- **WHEN** the endpoint returns 503
- **THEN** the page shows the not-available message

#### Scenario: Success
- **WHEN** the endpoint returns 204
- **THEN** the page shows the success message

### Requirement: Plan numbers cannot drift silently
Every plan number the landing copy quotes SHALL come from one frontend module and be inserted into the static HTML at
build time. A test SHALL read the corresponding backend default from the backend source and fail when the two
differ. A test SHALL also fail if the landing HTML contains the number as a literal instead of the build-time
placeholder.

#### Scenario: Backend default changes
- **WHEN** `HELIO_BETA_DAILY_MESSAGE_LIMIT`'s default in the backend source changes from 50
- **THEN** a frontend test fails until the landing module is updated

### Requirement: Product images are real, labelled captures
Every product image on the landing page SHALL be a capture of real Helio rendering, in light and dark variants. The
captures SHALL be produced by a checked-in, re-runnable script against a local backend and dev server. The
captured layouts are panel rectangles that the same script measures and writes. The page SHALL label example
dashboards as example data. The news board's photos SHALL be blurred, and its frame SHALL list its sources. No
hand-drawn dashboard markup SHALL ship.

#### Scenario: Recapture
- **WHEN** a developer runs the capture script against local servers
- **THEN** it rebuilds the six dashboards, writes light and dark captures, the panel-rectangle file and the OG image,
  and refuses to save any capture whose page is not the expected dashboard

### Requirement: Responsive and themed
The landing page SHALL render without horizontal scroll at 375px and at desktop widths, in light and dark. The theme
SHALL follow the user's stored Helio theme when present, and otherwise the system color scheme. With reduced motion
requested, scroll-linked animation SHALL be replaced by a non-animated presentation.

#### Scenario: Phone width
- **WHEN** the page is rendered at 375px wide in either theme
- **THEN** `document.documentElement.scrollWidth` does not exceed the viewport width

### Requirement: Landing type follows the app's heading contract
The landing page's wordmark, h1/h2 headlines and closing tagline SHALL use the app's heading face token
(`--font-heading`, sans by default under `design-language-v3`), and no landing CSS SHALL read the serif display token
directly. Body copy, card titles, step titles (including the build section's quoted prompt) and data SHALL use the UI
sans or mono face. Italic on the tagline's ending and the closing line is a style and is permitted.

#### Scenario: Headings use the heading token
- **WHEN** the landing page's computed fonts are inspected
- **THEN** the wordmark, `h1`, `h2` and the closing tagline compute a `font-family` whose first family is the one
  `--font-heading` resolves to, and the landing CSS contains no `var(--font-display)`
