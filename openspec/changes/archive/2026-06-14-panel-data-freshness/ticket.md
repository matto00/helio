# HEL-234 — Panel "data as of [timestamp]" freshness indicator

## Title
Panel "data as of [timestamp]" freshness indicator

## Description
Follow-up from HEL-200 (AC #4 was explicitly deferred — see archive `2026-05-11-last-run-stats-views/proposal.md` and `design.md`).

## Scope
Panels whose `typeId` is bound to a DataType should display a "Data as of [timestamp]" indicator. The timestamp is the `lastRunAt` of the pipeline whose `outputDataTypeId` matches the panel's DataType.

## Why it was deferred
The query chain is `Panel → typeId → DataType → Pipeline (via outputDataTypeId) → lastRunAt`. No existing repository method walks DataType → Pipeline. HEL-200's scope was the pipeline list + detail views, which already had the data in `PipelineSummary`; the panel indicator needs new infrastructure and was carved out at proposal time.

## Acceptance Criteria
1. New backend method (e.g. `PipelineRepository.findByOutputDataTypeId(id)`) returning the pipeline whose `outputDataTypeId` matches.
2. Panel API/response includes a `dataAsOf: string | null` field (ISO timestamp), populated for panels with a bound DataType, null otherwise.
3. Frontend panel renders the indicator below or beside the title, using the same `formatRelativeTime` utility added in HEL-200 ("Data as of 2 hours ago").
4. Indicator hidden when the panel has no bound DataType, or when the underlying pipeline has never run.

## Implementation Notes
- Consider a new OpenSpec capability `panel-data-freshness` to group the spec changes.
- Decide whether to compute `dataAsOf` server-side in the panel response (simpler) or client-side via a separate query (more flexible). Server-side preferred for consistency with HEL-200's pattern.
- If multiple pipelines write to the same DataType, define which timestamp wins (most recent successful run is the natural choice).

## References
- HEL-200 archive: `openspec/changes/archive/2026-05-11-last-run-stats-views/`
- HEL-200 PR: https://github.com/matto00/helio/pull/143
- `formatRelativeTime` utility lives in the frontend utils (added by HEL-200).

## In-flight PRs with Overlap
- PR #185 (HEL-133) — panel-related changes
- PR #186 (HEL-283) — panel-related changes
- PR #187 (HEL-281) — panel-related changes
- PR #188 (HEL-280) — panel-related changes

Implement against the current base state (task/orchestration-v2-fixes). Note merge sequencing when PRs land.
