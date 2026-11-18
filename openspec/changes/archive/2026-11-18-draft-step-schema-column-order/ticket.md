# HEL-1732: Draft step preview: schema-ordered columns in "Rows after step N", and keep `truncated` on the last-good-frame fallback

## Description

origin_kind: followup
origin_ticket: HEL-1705 (PR matto00/helio#1134, merged as 46ab3251e)

Two leftovers from HEL-1705.

1. **Column order in the step preview.** The "Rows after step N" grid shows draft frames with their columns in a scrambled order. This was already the case before HEL-1705. HEL-1705 fixed the order for saved Output rows by adding schema order and a `columns` list. The draft step frames still need the same treatment.
2. **Stale truncated frame.** When `mapServerResolved` in `draftStepView.ts` falls back to the last good frame, it drops `truncated`. For a moment, a stale truncated frame can then draw the compare overlay. The fix is one line.

## Acceptance Criteria

* The step preview's columns follow the step's output schema. There is a test that fails first.
* The fallback keeps `truncated`, with a unit test that fails first.
* Checked against the running app on desktop and phone, in light and dark.

## Agent notes (optional, fold in only if cheap)

These are smaller items from the HEL-1705 PR body. Fold them in only if they are cheap:

* `latestYAggregate` parses with a lenient `parseFloat`.
* `DraftPreviewPlanner` resolves the primary twice.
* A guard is copied in `metricHistoryView.ts`.
* The wording says "code-point" where the code counts UTF-16 units.

Evidence: `.concertino/runs/HEL-1705/evidence/`.
