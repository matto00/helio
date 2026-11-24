# HEL-1837: Pipeline schedules for grantees: decide who can read and save a shared pipeline's schedule

## Description

origin_kind: followup
origin_ticket: HEL-1794

### Problem

Pipeline schedules are owner-only on the server. `PipelineScheduleService` reads, saves and deletes go through
`pipelineRepo.findByIdOwned`, which only the pipeline owner passes. So:

* A viewer or editor grantee never sees a shared pipeline's schedule. The pipeline page shows "Add schedule" as if
  there were none.
* An editor can open "Add schedule", but saving it returns `404`.

HEL-1794 hid the schedule controls for viewers. An editor still sees "Add schedule" and gets the `404`. That was
already true before HEL-1794.

### Decide

* Can a viewer or editor grantee read the schedule (read-only chip)?
* Can an editor create, change or delete it? Who is the run then charged to? Scheduled runs already count against
  the pipeline owner's budget (HEL-1492 precedent).
* If editors cannot save, hide "Add schedule" for them instead of letting the save fail.

## Owner ruling (2026-11-24, recorded as a comment on the ticket)

**Read all, owner writes.** Viewer and editor grantees see a shared pipeline's schedule as a read-only chip. Only the
pipeline owner can create, change or delete it. "Add schedule" and every other schedule write control is hidden for
grantees.

## Acceptance criteria

- [ ] The access rule is decided, and server and client agree on it for owner, editor and viewer.
- [ ] No grantee gets a control whose save the server refuses.
- [ ] Tests for each role, on the route and in the UI.

Driver-derived acceptance detail:
- `GET /api/pipelines/:id/schedule` admits the owner and any editor/viewer grantee of that pipeline, using the same
  sharing-aware read check the other pipeline read routes use; a stranger or unknown id stays `404`.
- `PUT`/`DELETE` stay owner-only and answer a grantee the way the neighbouring owner-only pipeline write routes do.
- The response carries nothing a grantee must not see (no owner ids).
- Red-first route tests per role (owner read/write, editor read + write refused, viewer read + write refused,
  stranger 404); UI tests that a grantee sees the read-only chip and no write control (owner unchanged); an e2e for
  the grantee view.
- helio-mcp schedule tools and `schemas/pipelines/pipeline-schedule*.schema.json` stay consistent; CLAUDE.md's
  schedule route line is updated.
