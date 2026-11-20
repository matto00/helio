# HEL-1634: Logout leaves some per-user client caches in place (output history, provenance, panels/dashboards slices)

## Description

origin_kind: followup
origin_ticket: HEL-1575

### Why

While building HEL-1575's per-user warm cache, the survey found that logout (and a sign-out caused by a 401 through `clearAuth`) does not reset several client caches. If another user signs in on the same tab without a reload, those caches can still hold the previous user's data. This predates HEL-1575.

HEL-1575 already clears its own warm cache and IndexedDB copy, and calls `resetOutputFreshness()` on every `clearAuth`.

### What still is not reset on `clearAuth` (as filed)

* `outputHistoryCache` (module-level, no freshness reset hook)
* `provenanceCache`
* the `panels` and `dashboards` Redux slices, along with most other slices. At filing time only `scheduledItems`, `onboarding` and `dashboardFolders` reset on `clearAuth` (since then `homeSummary`, `dashboardTabs`, `sourceSamples`, kept drafts and the warm cache also reset).
* `recentHistoryStore` (localStorage `helio.recentVisits`, not keyed by user)

## Acceptance criteria

- [ ] After user A logs out and user B logs in without a page reload, no cache or slice serves A's data. Proven by a test per cache.
- [ ] Recents are keyed by user, or cleared on logout.

## Driver scope additions (2026-11-20)

- The ticket's list predates HEL-1575/1783 (warm tab cache with shared dashboards), HEL-1786 (`panelStatusStore`), HEL-1745 (ask), assistant conversations and model preference, draft-preview scheduler and sample caches, insight caches. ALL per-user client state in `frontend/src` (module-level caches, Redux slices, localStorage/sessionStorage/IndexedDB keys) is enumerated by script and the inventory is committed as evidence.
- One central reset (root-reducer reset on `clearAuth` plus one registry of module caches that each register a reset hook), not scattered calls; a guard test fails when a new module-level cache or storage key is added without registering (or being allowlisted with a reason).
- Browser storage keys that should survive logout (device preferences such as theme, motion) are named in an allowlist with their reason; device preferences are not wiped.
- e2e: A logs in, opens a dashboard, history and provenance; A logs out; B logs in on the same tab without reload; assert nothing of A's appears and no request uses A's ids. Red first.
- Frontend only; no migration.
