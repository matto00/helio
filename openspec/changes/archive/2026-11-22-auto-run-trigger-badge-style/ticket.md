# HEL-1822: Run history: auto-run trigger badge has no style of its own (looks like manual)

## Description

Follow-up from HEL-1815 (PR #1230, merged as 5af3a438c). HEL-1815 made the web client cover all four trigger sources (`manual`, `scheduled`, `external`, `auto-run`), with the label "Auto-run". `RunHistoryModal.css` styles the trigger badge with `--scheduled` and `--external` modifiers, but has none for `--auto-run`. So an auto-run badge looks the same as a manual one.

## Do

- Add an auto-run badge style built from existing DESIGN.md tokens, consistent with the scheduled and external badges, in light and dark.
- Check the HEL-866 contrast floor for the badge (text-on-fill contrast; and the 1.10 state-surface floor if it has a hover).
- Tidy two small leftovers from HEL-1815:
  - the doc comment at `TriggerSourceMigrationSpec.scala:20` still lists three sources;
  - the contract test's label list also allows "Unknown", which is looser than it needs to be (tighten to the four known labels).

## Acceptance criteria

- [ ] A test that fails first: an auto-run run's badge carries its own modifier and differs visibly from manual, in both themes.
- [ ] The badge meets the contrast floor (measured, stated).
