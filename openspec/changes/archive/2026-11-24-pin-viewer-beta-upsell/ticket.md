# HEL-1838: Output sheet: decide whether a pipeline viewer sees the "Request Beta access" link

## Description

origin_kind: followup
origin_ticket: HEL-1794

HEL-1794 made the pipeline page read-only for a viewer grantee. Inside the Output sheet, a viewer still sees a
"Request Beta access" link (the tier upsell). A viewer cannot change the Output, so the upsell may be noise there, or
it may be a fair prompt to a free-tier viewer.

Decide: show the link to viewers, hide it, or show it only on their own (non-shared) pipelines.

## Owner ruling (2026-11-24, revised; supersedes an earlier "Hide for viewers" comment)

Viewers SEE the "Request Beta access" link, the same as editors and owners. Keep today's behaviour. The work is to
pin it with tests.

## Acceptance criteria

- [ ] The rule is decided and implemented (decided: viewers see it; today's behaviour kept).
- [ ] A test pins it for viewer and editor (owner unchanged). The tests fail if the link is hidden for viewers,
      shown by mutation (e.g. gating it on readOnly/canEdit turns the viewer test red).
- [ ] Verified live on main, before any test is written, that a real viewer grantee on a shared pipeline sees the
      link in light and dark themes, naming the conditions that show it. If not, escalate instead.
- [ ] The HEL-1839 fail-closed role defaults (`readOnly = true` default) do not hide the link; if they do, restore it.
