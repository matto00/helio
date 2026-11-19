# HEL-1775: Small follow-ups: editor preview chart size, ask question persisting across dashboards, untested step-less pin fallback

## Description

Three small items found by overnight lanes. All three predate the tickets that found them.

1. **Editor preview chart size (from HEL-1763).** The Output editor's preview chart draws at 100px inside its 240px card,
   because `.panel-content` computes to 100px. That leaves about 140px of empty card at every width.
2. **Ask question persists (from HEL-1746).** The typed question in the ask drawer carries over when you switch
   dashboards, while the answer resets. Both should reset together, or the question should be kept on purpose with a
   stated reason.
3. **Step-less pin fallback (from HEL-1746, in HEL-1745's code).** For an Output with no step, the ask pin builder falls
   back to the pipeline id as `rootId`. No test sends that body to the real `POST /api/pipelines/:id/outputs` route.

## Acceptance Criteria

- Item 1: the chart fills its card on desktop and phone, in light and dark, with a test that fails first.
- Item 2: a test that fails first for the chosen behaviour.
- Item 3: a backend test sends the fallback body to the real create route and asserts the result. If the route rejects
  it, fix the builder.

## Driver decision (not a human ruling)

Item 2: reset the question together with the answer on a dashboard switch, matching the answer's existing behaviour.
Escalate instead if a concrete reason for keeping the question is found.

## Agent notes

- Evidence: `.concertino/runs/HEL-1763/evidence/` and `.concertino/runs/HEL-1746/evidence/` in the main checkout.
- Origin: follow-up of HEL-1746. Related: HEL-1763, HEL-1745, HEL-921.
