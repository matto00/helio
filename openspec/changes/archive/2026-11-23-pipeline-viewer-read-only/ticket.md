# HEL-1794: Pipeline detail: make the whole page read-only for viewer grantees

## Description

origin_kind: followup
origin_ticket: HEL-1661

HEL-1661 hides every run entry from a viewer grantee on a shared pipeline's detail page and shows a "View only" indicator. Everything else on the page stays editable for a viewer, and the server refuses all of it:

* editing steps into a client-only draft, adding, moving or deleting steps
* renaming the pipeline
* editing or pausing the schedule
* creating and editing Outputs

A viewer who has made a draft keeps Discard (owner ruling on HEL-1661, Q2).

Follow HEL-1782's dashboard precedent: hide edit affordances from viewers. Check desktop and phone, including the phone step sheet.

## Acceptance Criteria

* A viewer sees no actionable edit control on the pipeline detail page, on desktop and phone, in light and dark.
* A viewer cannot create a draft.
* An e2e test covers it, failing first.

## Driver notes (claims to verify)

* Since filing: HEL-1798/HEL-1810 (session-epoch guards in pipeline hooks), HEL-1809 (memo comparators on SpineStepRow/SpineOutputs with typed prop contracts — a new prop must be handled), HEL-1615, HEL-1626 merged. Re-derive from main.
* Enumerate every edit affordance on desktop and phone (scripted over the pipeline page components) and record the inventory.
* "A viewer cannot create a draft": UI gating plus a guard in the draft-creation hook; the Discard ruling still applies to a draft that exists anyway (e.g. created before a role change).
* Editors keep full editing; owners unchanged. Prove viewer vs editor on helio_app_test-backed e2e users.
* Frontend only expected; no migration.
