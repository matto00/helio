## Why

The palette's empty-query default is a static list, so the commonest intent — "jump back to where I was" — is
not served. Recents make it one keystroke. Nothing in the tree tracks visited resources today.

## What Changes

- Add a recency store (kind + id + timestamp), persisted to `localStorage`, capped, with JSON read/write
  safety the stated `ThemeProvider` model does not supply.
- **Record arrivals, not departures.** Two mechanisms covering three kinds, wired explicitly: a Redux
  listener for dashboards (which carry no URL id) and a route-watching effect for sources and pipelines.
  Instrumenting arrival is what makes direct URLs, browser back/forward, and palette navigation all count
  without touching each caller.
- Author `useResourceNavigator`, a kind→navigate dispatcher. **HEL-503 inherits this**; the ticket text has
  the dependency backwards.
- Show a "Recent" section **prepended to** the empty-query view (HEL-516's Create/Navigation/General still
  render); with no history the existing view is returned completely unchanged.
- Prune stale entries only against slices that have actually resolved.

## Capabilities

### New Capabilities

- `palette-recent-navigation`: the palette's empty-query default surfaces recently visited resources, and
  selecting one returns the user there.
- `resource-visit-history`: the application records which resources a user visits and in what order, durably
  across reloads, and forgets ones that no longer exist.

### Modified Capabilities

- `command-action-registry`: a contributor may supply actions for the empty-query default, **prepended to —
  never displacing — the existing content**, so a sibling ticket's shipped sections are not regressed.

## Impact

- New: recency store + persistence, `useResourceNavigator`, the two recording mechanisms, a Recent section.
- `frontend/src/store/store.ts` — register a listener via the existing `startAppListening` (toasts precedent).
- `frontend/src/features/commandPalette/model/{builtInActions.ts,ranking.ts}` and `ui/CommandPalette.tsx` —
  `"Recent"` in `SECTION_DISPLAY_ORDER`, and an empty-query branch that does not exist today.
- No backend, wire, or schema impact — but per evidence rule 5 that is not "no downstream impact":
  `useResourceNavigator` is a published surface HEL-503 consumes.

## Non-goals

- Server-side or cross-device history.
- Search ranking changes (HEL-503).
- **Panel recents — deferred to HEL-1038**, because it needs a selected-panel concept and a global panel
  registry that do not exist; a panel opens inside a dashboard canvas with no route change and no observable
  action. Excluded deliberately, not overlooked.
- **A "Frequent" section.** The AC permits "recent **and/or** frequent". This ships recency only rather than
  recording a frequency counter nothing renders — unused persisted state is a liability, not groundwork.
