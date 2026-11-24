# HEL-1834: Backend: enforce the 5-row form minimum on panel duplicate and proposal apply (not import)

## Description

origin_kind: followup
origin_ticket: HEL-1618 (PR matto00/helio#1246, merged as e3eda3eda). The owner chose this scope.

HEL-1618 made the desktop grid hold multi-field form panels to at least 5 rows; a compact counter keeps 4. A form already saved at 4 rows grows to 5 on its next resize only if the space below it is free, and is never bumped on load. The backend auto-layout already uses 5 rows (`PanelPacker.scala:44`).

Two backend paths can still create a form panel under 5 rows:

* **Panel duplicate.** `CreatePlacement.duplicateSizes` copies the source panel's height.
* **Proposal apply.** `ProposalLayoutSupport.scala:38`.

## Do

* On both paths, give a form panel that is not a compact counter at least 5 rows. Use the same placement rules as the client, and never move other panels.
* Out of scope: dashboard import. The owner ruled that imported, saved layouts stay as saved.

## Acceptance criteria

- [ ] For each path, a test that fails first: duplicating a 4-row form, and applying a proposal that places a form at 4 rows, each give 5 rows.
- [ ] A compact counter is unchanged on both paths.
- [ ] Import is unchanged, pinned by a guard test.

## Driver context (claims, verified in premise-validation.md)

- Enumerate every backend path that creates or places a form panel; extra paths beyond the two are a scope escalation.
- Compact-counter detection must match the client's `isCompactCounterConfig` exactly (exactly one field, control "counter").
- Where growing to 5 would overlap a neighbour, mirror the client (`liftResizedForm`: grow only when the space directly below is free; otherwise keep).
