## Purpose

The Home page at `/home`: where a signed-in user sees which dashboards changed and what their pipelines ran, failed and
will run next, with plain-language copy and a quiet, accent-disciplined layout.

## ADDED Requirements

### Requirement: Home is the app home and loads in one summary call

`/home` SHALL render the Home page inside the app shell, with no context list (rail only, the saved collapsed state
unchanged). On load the Home page SHALL add exactly one request of its own, `GET /api/home-summary`, and reuse the
dashboards list the shell already loads; neither the page nor the shell SHALL issue a request scoped to a single
pipeline on `/home`. Loading `/home` SHALL NOT record a dashboard view (see the shelf requirement). It SHALL refetch the summary when the tab becomes
visible again and once after a Retry or Run now.

#### Scenario: Network log on load
- **WHEN** a user with 3 pipelines and 4 dashboards opens `/home`
- **THEN** the network log shows one `/api/home-summary` request and no `/api/pipelines/<id>/...` request

### Requirement: Opening line

The page SHALL show a mono eyebrow with the local weekday, date and time (for example `TUE · OCT 13 · 09:12`) and one
summary sentence built from templates over the summary and change data (number words for one to nine), naming changed
dashboards, failed runs and stuck or missed runs, and ending "everything else is quiet" when anything was named, or a
quiet sentence when nothing was. No language model SHALL be called.

#### Scenario: Changes and a failure
- **WHEN** two shelf dashboards show the changed dot and one pipeline has an unresolved failed item
- **THEN** the sentence reads "Two dashboards changed since your last visit. One run failed, everything else is quiet."

#### Scenario: Nothing happened
- **WHEN** nothing changed and nothing failed, stalled or was missed
- **THEN** the sentence states plainly that all is quiet

### Requirement: Dashboard shelf

The shelf SHALL show up to four cards: dashboards showing the changed dot first, then by last update, newest first.
Each card SHALL link to the dashboard and show a thumbnail of panel boxes drawn from the saved layout (no live data),
the name, a relative update time and, when changed, a dot with ", changed since your last visit" in its accessible name.
The dot SHALL use the same colour token and rule as HEL-1575's changed tab marker (owner ruling `data-or-edit`: new data
or someone else's edit since your last view, never your own saves) and SHALL clear once the user opens that dashboard.
"Last view" SHALL be a per-dashboard view stamp recorded in server time only for the dashboard the dashboard view
(`/dashboards` or `/dashboards/:id`) actually displays (on display, on switching to it, and on leaving it), never for a
dashboard that is only selected or restored as a tab without being displayed, and never erased by a later recent-visit
record; HEL-1575's tab `lastViewedAt` SHALL NOT be used, because it stamps tabs that were never displayed. "Own write"
SHALL be a per-dashboard stamp taken from every own content-write acknowledgement HEL-1575 records
(`noteOwnDashboardWrite`), whether or not the dashboard has a tab. A shelf card SHALL link to `/dashboards/:id`.
Per-dashboard stamps SHALL be kept for every existing dashboard the user has viewed, independent of the palette's
ten-entry recent list, and dropped when the dashboard no longer exists. A dashboard with no view stamp shows no dot.
An "All N →" link SHALL open `/dashboards`.

#### Scenario: Dot clears after opening
- **WHEN** a shelf dashboard shows the dot and the user opens it, then returns to Home
- **THEN** that card shows no dot

#### Scenario: Dot clears on phone for the already-selected dashboard
- **WHEN** at 375px the changed dashboard is already the selected one and the user opens it from the shelf, then returns
- **THEN** that card shows no dot

#### Scenario: Opening another dashboard keeps a selected dashboard's dot
- **WHEN** dashboard Y is selected (or the active saved tab) and changed, and the user opens X from Home's shelf and
  returns to Home
- **THEN** Y's card still shows the dot and X's does not

#### Scenario: Own edits never mark a dashboard
- **WHEN** at 1280px the user moves a panel on dashboard X, switches to dashboard Y with a plain click (X's tab is
  replaced), then opens Home
- **THEN** X's card shows no dot

#### Scenario: Visiting pipelines does not evict dashboard stamps
- **WHEN** the user views dashboard X, then visits twelve pipelines and sources, and another user then edits X
- **THEN** X's card on Home shows the dot

#### Scenario: Loading Home does not hide a change
- **WHEN** another user edits the user's most recently updated dashboard and the user then loads `/home`
- **THEN** that dashboard's card shows the dot

#### Scenario: Thumbnail from layout
- **WHEN** a dashboard has three panels in its saved large layout
- **THEN** its card thumbnail shows three boxes in their relative positions

### Requirement: Pipeline run timeline

The timeline SHALL show one row per returned pipeline over the 24h window plus the 6h horizon, with hour labels, a
"now" line, and one mark per run or upcoming fire. Status SHALL be distinguishable by shape as well as colour:
succeeded a filled circle, failed a filled diamond, queued or running a ring with a centre dot, scheduled a hollow ring,
with a legend that shows the shapes. Every mark SHALL be keyboard-reachable (arrow keys move between marks within and
across rows) with an accessible label naming the pipeline, status and local time, SHALL show the run's details on
hover and on focus, and a run mark SHALL open `/pipelines/:id` on click or Enter. On a coarse pointer (any width) and in the phone layout each pipeline row SHALL be a single control of at least 44px height, labelled with the pipeline name, its
run and failure counts and its next fire, showing a non-interactive strip of the marks; activating it SHALL expand a
list of that pipeline's runs and fires, newest first, each row at least 44px high with status (shape and text), time,
and error, linking to `/pipelines/:id`. When more pipelines were active than shown, a "+N more" link SHALL open
`/pipelines`.

#### Scenario: Keyboard access
- **WHEN** focus enters the timeline and the user presses Right Arrow
- **THEN** focus moves to the next mark and its label and details are announced

#### Scenario: Tablet touch uses rows
- **WHEN** the page renders at 820px with a coarse pointer
- **THEN** each pipeline is one row control at least 44px high and no individual mark is a tap target

#### Scenario: Phone reads a failed run's error
- **WHEN** at 375px the user taps a pipeline row whose last run failed
- **THEN** the expanded list shows that run as failed with its error text and a link to the pipeline

#### Scenario: Not hue alone
- **WHEN** the page is rendered in grayscale
- **THEN** succeeded, failed, in-progress and scheduled marks remain distinguishable by shape

### Requirement: Needs attention and Retry

Needs attention SHALL list the summary's attention items with pipeline name, a plain-language reason (the run's error
for a failed run), the time, an Open link to `/pipelines/:id`; an unresolved failed item SHALL offer Retry and a missed item Run now, each
submitting one real run through `POST /api/pipelines/:id/run` (subject to the HEL-505 guards). When the item's pipeline
has a `queued` or `running` run in the summary, Retry and Run now SHALL be replaced by a non-interactive "Running now"
status, so Home never starts a second concurrent run. A stuck item SHALL offer
Open only (it may still be running; a second submit would run concurrently). A `429` SHALL be reported in plain
language with the Retry-After wait; the button SHALL be disabled while pending. Resolved failures SHALL appear after
unresolved ones, marked as resolved, with no Retry.

#### Scenario: Retry a failed run
- **WHEN** the user presses Retry on a failed item
- **THEN** one run is submitted for that pipeline and the summary refreshes

#### Scenario: No retry while a run is in flight
- **WHEN** a pipeline has an unresolved failed item and a run that started 2 minutes ago is `running`
- **THEN** the item shows "Running now" and no Retry button, also when that pipeline is not among the timeline's rows

#### Scenario: Stuck run cannot be resubmitted from Home
- **WHEN** a stuck item is shown
- **THEN** it offers Open and no Retry

#### Scenario: Guard rejects
- **WHEN** the submit returns `429` with `Retry-After: 15`
- **THEN** the item says the run was not started and to try again in 15 seconds

### Requirement: Up next

Up next SHALL list the summary's soonest fires with mono local time and pipeline name, each linking to the pipeline.

#### Scenario: Scheduled pipelines listed
- **WHEN** the user has two enabled schedules
- **THEN** Up next lists both, soonest first

### Requirement: Designed states for a new user, loading and failure

With no dashboards, the shelf area SHALL render the existing first-run drop zone (see `first-run-dashboard-build`),
unchanged, so a new user can build a first dashboard from Home without an extra step. Its "Set up step by step" action
SHALL open `/dashboards` with the step-by-step checklist shown, exactly as choosing it on `/dashboards` does.
With no pipelines, the timeline, Needs attention and Up next SHALL show plain-language empty states, with a link to
Data Pipelines. Loading SHALL show skeletons of the final layout; a failed summary SHALL show an error with a retry,
while the shelf still renders from the dashboards list. The page SHALL render without horizontal scroll at 1280, 820,
768 and 375px in light and dark themes.

#### Scenario: Step by step from Home
- **WHEN** a zero-dashboard user chooses "Set up step by step" on Home
- **THEN** the app opens `/dashboards` showing the three-step checklist

#### Scenario: Brand-new user
- **WHEN** a newly registered user signs in
- **THEN** they land on `/home` and see the first-run drop zone and the timeline, attention and up-next empty states with no error
