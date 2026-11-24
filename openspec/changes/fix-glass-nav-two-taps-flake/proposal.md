## Why

The glass-nav test "a beta user reaches /chat in two taps: Open assistant, then Browse all conversations" (old
`e2e/hel1583-glass-nav.spec.ts:554`, now `e2e/support/hel1583-glass-nav.ts:549`) fails intermittently in CI: on main
run 39830913828 (October) and on PR #1266 run 45488894333 (2026-11-24, dark theme), where the URL was already `/chat`
but the Dashboards tab still carried `aria-current="page"`. The mobile-bottom-nav spec says no tab is current on routes
that belong to none of them (for example `/chat`). Each failure blocks an unrelated PR and costs a rerun.

## What Changes

- Probe-confirmed root cause of why a tab still reads current after the URL reaches `/chat`, with CI artifacts where
  retrievable and a local reproduction (`--repeat-each`, CDP 4x/6x CPU throttling).
- A red run recorded and committed (as `.txt`) before any fix.
- The fix at the root cause: in the app (BottomNav / route transition / chat route loading) if a real user can see a
  tab marked current while the `/chat` page is shown, otherwise in the spec by asserting on the settled state through a
  real condition, never by adding waits, timeouts or retries.
- A guard that turns red when the fix is reverted (mutation run committed as `.txt`).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none) - the fix restores the existing `mobile-bottom-nav` requirement that no tab is current on routes belonging to
none of them (for example `/chat`); no requirement text changes. `.openspec.yaml` sets `skip_specs: true`.

## Impact

- `e2e/support/hel1583-glass-nav.ts` and/or the frontend nav/route surface (`frontend/src/shared/chrome/BottomNav.tsx`,
  the chat route/lazy loading, `frontend/src/features/assistant/ui/QuickLauncherOverlay.tsx`).
- No backend change, no migration, no API/schema change.
- Avoids the files of in-flight lanes HEL-1852 (backend auth) and HEL-1651 (chart-chunk preload, hel1573/hel1584 specs).
