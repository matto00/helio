## Why

HEL-1585 reported that a pipeline detail page scrolled the whole document at 1440x900, dragging the app shell out of view. The page has since been rewritten (HEL-1579) and only that one route has a "document does not scroll" check, with a short step list and a short context list. The shell-level invariant "the document never scrolls on an app route" has no guard on any other desktop route, so a regression on any page would ship silently.

## What Changes

- Reproduce or rule out the report locally (lane dev server, non-emulated Chromium) at 1440x900 and 1280x800, on every authenticated route, with a long step list, a short step list and a 30+ item context list; record per-route `scrollHeight`/`innerHeight` as evidence.
- Add one parametrised Playwright guard (`e2e/hel1585-document-never-scrolls.spec.ts`) asserting `document.documentElement.scrollHeight <= innerHeight` (and `scrollY === 0`) on every authenticated route at both viewports, and that a wheel over the pipeline step spine scrolls only the inner region. The guard's route list is checked against `AppRoutes.tsx` so a new authenticated route cannot be silently left out.
- If the guard finds a route that scrolls the document and the cause is shell-level, fix it in the shell CSS; otherwise list the route and raise it as follow-up triage. No fix is made speculatively.

## Capabilities

### New Capabilities

### Modified Capabilities
- `app-shell-rail`: adds a requirement that the document never scrolls on an authenticated desktop route (above 768px), only inner content regions do.

## Impact

- New e2e spec file (frontend e2e only). Possibly a shell CSS fix in `frontend/src/app/App.css` or `frontend/src/theme/theme.css` if a shell-level cause is found.
- No backend, schema or migration change. No Playwright config change (HEL-1816 owns config edits in flight).
- CI: one more spec in the 8-leg e2e matrix; its wall time is measured and stated in the PR.
