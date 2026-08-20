# HEL-539: Error-state components (retry, empty, permission-denied)

## Description

`DESIGN.md` §7 requires every data-backed view to render a visible, human-readable, intent-error state and "never swallow a failed fetch." Today error handling is uneven: `InlineError`/`StatusMessage` exist in `shared/chrome/` but aren't used everywhere, some fetch failures render nothing, and there is no standard retry affordance or permission-denied treatment (relevant given RLS — a denied query can surface as a backend error). This ticket standardizes error states with retry.

## Scope

- Establish a canonical error-state pattern built on the existing `StatusMessage`/`InlineError` + `EmptyState` primitives (extend them minimally rather than adding a new competing component): an error variant with intent-error styling, a human-readable message, and an optional **Retry** button (§5 recipe) that re-dispatches the failed thunk.
- Apply to the main data-backed views that currently under-handle errors: dashboard/panel data fetches (`PanelContent`, `PanelList`), sources/pipelines/types list + detail pages, and the Proposal Review page. Each failed fetch shows the error state with retry; retry clears the error and re-fetches.
- Add a distinct **permission-denied / not-found** treatment (e.g. 403/404 from the API) with appropriate copy and no retry-spam, so an RLS-denied or missing resource reads correctly rather than as a generic failure.
- Ensure errors are announced (`aria-live`/role per §8) and color is never the sole signal (icon + text).

## Acceptance criteria

- Every listed view renders a visible intent-error state on fetch failure (no silent swallow); a Retry action re-runs the fetch and recovers on success.
- 403/404 responses render a distinct permission-denied/not-found state with suitable copy and no infinite retry.
- Error states use intent tokens + §5 button recipe; accessible (aria-live, icon+text); correct in light/dark.
- Tests simulate fetch failure + retry for representative views and the 403 path; `npm run lint` / `npm test` pass, zero new warnings.

## Out of scope

- Toast policy (toast-consistency ticket) and skeleton loaders (skeleton ticket).
- Backend error-shape changes (consume what the API returns).
- Loading skeletons (HEL-528), empty-state CTAs (HEL-548), and toast policy (HEL-535) — the next three tickets in this same epic (HEL-349). Do not pull them forward. Where HEL-539 must touch the same files, leave those branches alone.

## Dependencies

Relates to the toast-consistency ticket (inline error vs toast division) and the empty-state CTA ticket (shared `EmptyState`).

## Icon library note

`lucide-react` is the single icon library in this repo; use it directly rather than waiting on the pending iconography ticket (HEL-443).
