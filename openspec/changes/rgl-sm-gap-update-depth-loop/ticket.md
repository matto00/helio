# HEL-1835: "Maximum update depth exceeded" logged 8-9x on full load of some sm layouts with a column gap (react-grid-layout loop)

## Description

origin_kind: followup. origin_ticket: HEL-1618 (PR #1246, merged as e3eda3eda). The owner chose to file this.

HEL-1618's final reviewer found that a full page load of some `sm`-breakpoint (6-column) dashboard layouts that leave
a column gap logs "Maximum update depth exceeded" 8-9 times. It reproduces with text panels only, so the form changes
did not cause it. Probe: `.concertino/runs/HEL-1618/evidence/scratch/skeptic-final/probe-depth.cjs`. The scratch copy
has been swept, so use the copy in evidence.

Related: HEL-1575 found a react-grid-layout 2.2.4 loop. A bare `Responsive` grid loops when one render changes both
its `layouts` and its breakpoint. It worked around that by keying the skeleton grid by dashboard id. HEL-1624 later
removed the transient wrong-dashboard selection.

## Do

- Reproduce the loop with the probe, then find the cause (systematic-debugging law). Find out whether it is the same
  library defect HEL-1575 found, and which prop change starts it.
- Fix it in helio, for example by stabilising the `layouts` identity or using the same key workaround. If the library
  must change, write up the repro, and ask the owner before filing anything upstream.

## Acceptance criteria

- [ ] A test that fails first: no "Maximum update depth" console error on a full load of the reproducing layout.
- [ ] The HEL-1575 and HEL-1624 load specs still pass.

## Driver additions (binding for this run)

- The fix must remove the loop, not silence the console error; no viewport-specific special case.
- The loop must not change persisted layout: no extra `PATCH /api/dashboards/:id` during the load.
- No visual change expected; show a before/after check at `sm` (DESIGN.md binds frontend work).
- A required library change is an ESCALATION before anything is filed upstream.
