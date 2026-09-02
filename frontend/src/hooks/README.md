# Hooks

`reduxHooks.ts` (typed `useAppDispatch`/`useAppSelector`) and
`usePortalPopover.ts` are genuinely cross-feature — each is imported by
multiple `features/*` dirs (verified: `reduxHooks` by all 14 feature dirs
plus `app/` and `shared/`; `usePortalPopover` by `features/auth`,
`features/dashboards`, plus `shared/chrome` and `shared/ui`).
`useRelativeTime.ts` is not — its only real consumer,
repo-wide, is `shared/chrome/SaveStateIndicator.tsx`; no `features/*` dir
imports it. It lives here anyway since it is `shared/chrome`'s dependency
and `shared/` has no `hooks/` subdirectory of its own to hold it.

**Belongs here:** hooks used by more than one feature, or (as with
`useRelativeTime.ts`) needed by `shared/` and with nowhere more specific to
live. Verify with a real import grep before adding — do not assume
cross-feature reuse from a hook's own logic sounding generic.
**Does not belong here:** a hook only one feature needs — put it in that
feature's own `hooks/` (e.g. `features/dashboards/hooks`,
`features/panels/hooks`).
