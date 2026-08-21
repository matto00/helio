## Why

A new user lands in an empty app with no guidance on the source→pipeline→type→panel model, and no
onboarding surface exists today. This is the last leaf of epic HEL-349, and HEL-774's icon-only bottom
nav dropped the Sources / Pipelines / Types / Metrics labels on record — naming this ticket as the
mitigation. This surface is now the primary place that vocabulary is taught, not a nice-to-have tour.

## What Changes

- A new `features/onboarding/` surface: a dismissible four-step checklist — add a data source → create a
  pipeline (which produces a type) → create a dashboard → add a panel — rendered in the panel area's
  zero-content region, not as a blocking modal.
- Three separate notions, deliberately not conflated: a **sticky active** flag in Redux, a **dismissal**
  persisted per user, and a one-shot **auto-activation** trigger. Once active the checklist stays active,
  so completing a step never makes it vanish mid-sequence.
- Auto-activation gated on the dashboard collection alone — fetched and empty, not previously dismissed —
  and visibility is *derived*, so the checklist renders on the same frame the empty state it supersedes
  would otherwise have appeared on, with no flash and no wait on a second request.
- Step completion derived from the same slices, never from local guesswork. Because the dashboard route
  does not fetch sources or pipelines, the surface dispatches those two fetches, so a step can never claim
  a state it has not observed. A step has four states: an unresolved collection renders indeterminate, and
  a **failed** one renders an inline error with a retry — never as "you haven't done this yet", which would
  be a falsehood the surface could not correct.
- Dismissal has a single owner in the slice. `UserMenu` dispatches rather than writing storage, because a
  local-state holder plus a second direct writer silently loses the dismissal issued after a re-open.
- Reaching all four steps records the dismissal but keeps the surface on screen, showing the chain ticked,
  so the completion is actually seen and the re-open affordance is never inert for a user who has
  everything already.
- Three of the four steps invoke HEL-548's create-action hook directly. The data-source step navigates to
  the section that mounts its flow instead, where that page's own hook-driven CTA opens it — the shipped
  spec's sanctioned route for a navigation surface, and the only one that survives StrictMode.
- Each step carries its section's own navigation glyph, taken from the shared section registry, so the
  lesson binds concept to icon — HEL-774's dropped labels are a glyph problem, not only a vocabulary one.
- Dismissal persisted per user in `localStorage`, keyed by user id, mirroring `ThemeProvider`'s mechanism;
  a "Getting started" item in `UserMenu` re-opens it for any user, with or without content.
- The missing unmount cleanup for the data-source modal's visibility flag is added to `SourcesPage`, which
  a shipped spec already requires and which this surface turns into a path first-run users walk.

## Capabilities

### New Capabilities

- `first-run-onboarding`: when the guided checklist appears, how each step's completion is derived and
  actioned, how dismissal persists per user, and how it is re-opened.

### Modified Capabilities

- `frontend-panel-empty-state`: the panel area's zero-content region renders the onboarding surface when
  it is active, superseding the plain empty state while preserving the never-blank guarantee, the
  "Add panel" action, and the failed-create error treatment.
## Non-goals

- Template-based dashboard creation (HEL-421) and in-app NL authoring (HEL-341) — linked if present, not
  built here.
- Backend onboarding state; persistence is client-side only.
- Any change to HEL-548's four hooks or to `EmptyState`. The seam is consumed, not modified.
- Hoisting `AddSourceModal` or `PanelCreationModal` to the shell (HEL-548 D5b defers this deliberately).

## Impact

`frontend/src/features/onboarding/` (new, incl. `onboardingSlice` registered in `store.ts` **and in
`frontend/src/test/renderWithStore.tsx`**, whose reducer map is maintained separately and which every
touched test routes through), `frontend/src/features/panels/ui/PanelList.tsx` (content-area top, outside the
skeleton gate), `frontend/src/features/auth/ui/UserMenu.tsx` + its test (re-open item, wired with hooks),
`frontend/src/features/sources/ui/SourcesPage.tsx` (the unmount cleanup a shipped spec already requires).
**`CommandBar.tsx` is deliberately not edited** — `UserMenu` takes its own hooks rather than a new prop,
because `CommandBar.tsx:160` is the sheet-opening control fenced to concurrent run HEL-773. No backend, API,
schema or dependency changes.
