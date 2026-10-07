# HEL-1352: Output History view polish: Ghost button styling, 'no row changes' note, rows-table height, same-second labels

## Description

origin_kind: followup
origin_ticket: HEL-1277

Polish items from HEL-1277's Output History view:

* The History button uses `--app-radius-md` and weight 400. DESIGN.md §5 Ghost specifies radius-sm and medium weight.
* When two points are identical there is no "No row changes" note. The rows table's fixed 360px height also leaves the "no longer present" count far below short tables.
* Two points captured in the same second still get identical "vs …" labels.

## Acceptance Criteria

Make the fixes per DESIGN.md, compare against the running app in both themes, and add RTL tests for the note and the label disambiguation.
