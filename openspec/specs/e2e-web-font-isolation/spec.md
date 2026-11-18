# e2e-web-font-isolation Specification

## Purpose
Keeps every e2e browser run independent of the third-party Google Fonts hosts while still rendering the real web
fonts, so a stalled fonts request can never hang a navigation and font-measuring specs keep measuring the web face.

## Requirements

### Requirement: Fonts requests are answered locally for every spec
Every browser the e2e suite launches SHALL send each request for `fonts.googleapis.com` or `fonts.gstatic.com` to a
local server holding a committed copy, by one shared configuration, without any spec importing or calling
font-specific code and without adding request interception. This SHALL hold for the default context, for contexts a
spec creates itself, and for page routes that continue a fonts request.

#### Scenario: Stalled upstream does not hang a bare navigation
- **WHEN** the upstream fonts hosts accept connections but never answer, and a spec calls `page.goto` with the default `load` wait
- **THEN** the navigation completes within its normal timeout and the stalled upstream receives no connection

#### Scenario: The same stall is red without the mechanism
- **WHEN** the shared mechanism is disabled and the upstream fonts hosts never answer
- **THEN** the same bare `page.goto` times out

### Requirement: The real web fonts still render
The local copy SHALL be the exact stylesheet responses for the font URLs the app requests and every font file they
reference, so text renders in the same web faces as with the live hosts.

#### Scenario: Web faces rasterised
- **WHEN** an `app.html` page under the mechanism has loaded and its fonts have settled
- **THEN** text is rasterised in the custom faces Schibsted Grotesk, Fraunces and JetBrains Mono (including weight 700), not a fallback

### Requirement: Unknown or drifted font URLs fail loud
A fonts request with no local copy SHALL be answered immediately with an error status and SHALL fail the run, naming
the URL. A guard SHALL fail when a Google Fonts URL in the app's HTML entries, or a font file referenced by a
committed stylesheet, has no committed copy, naming it.

#### Scenario: App font URL changes
- **WHEN** a font URL in `frontend/app.html` or `frontend/index.html` no longer matches a committed stylesheet
- **THEN** the guard fails naming that URL
