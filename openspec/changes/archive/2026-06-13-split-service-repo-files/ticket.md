# HEL-280: Split DashboardService / PanelService / DashboardRepository / PanelRepository to meet file-size budget

## Context

Surfaced during HEL-265 CS4 evaluation. The sharing-aware repo + service changes pushed 4 files past the soft file-size budget:

* `DashboardService.scala` — ~353L (soft budget 300L for services)
* `PanelService.scala` — ~336L (soft budget 300L for services)
* `DashboardRepository.scala` — ~337L (soft budget 250L for non-services)
* `PanelRepository.scala` — ~332L (soft budget 250L for non-services)

None are over the 400L hard BLOCKER threshold, and the chain was already long — splitting was explicitly deferred per executor instructions. But the soft overrun is real and should be cleaned up before it grows.

## Scope

Behavior-preserving split following the patterns established by the backend-routes-decompose and backend-service-layer changes earlier in 2026-05:

* **DashboardService**: candidate split — separate the sharing/ACL paths (`findById`, `findByIdOwned`, `requireRole`) from the CRUD paths (`create`, `update`, `delete`, `duplicate`, `exportSnapshot`)
* **PanelService**: candidate split — separate the query path (`findById`, `batchQuery`) from the mutation path (`create`, `update`, `delete`, `batchUpdate`)
* **DashboardRepository / PanelRepository**: candidate split — extract the sharing-aware query helpers into a shared `SharingAwareQueries` companion or trait

## Constraints

* Pure refactor; no behavior changes
* All existing tests must pass unchanged
* Service constructor signatures should be preserved (or split into composed traits) so wiring in `Main.scala` / `ApiRoutes.scala` doesn't churn
* File-size budgets after the split: ideally ≤250L per file, definitely ≤300L

## Acceptance criteria

1. The 4 files listed above are ≤300L (250L preferred)
2. `sbt test` 715/715 unchanged
3. No new files exceed soft budget
4. Pattern is consistent with the existing backend-service-layer / backend-routes-decompose precedent

## Related

* Source: HEL-265 CS4 evaluation flag
* Pattern: backend-service-layer change (Jan-Feb 2026)
* Lower priority — no functional risk, just code-hygiene debt

## Overlap Note

This ticket touches the same 4 files as HEL-281 (PR #187), HEL-133 (PR #185), and HEL-283 (PR #186) on their own unmerged branches. The worktree is cut from current HEAD (task/orchestration-v2-fixes) which does NOT include those PRs. Merge sequencing will need to be handled carefully.
