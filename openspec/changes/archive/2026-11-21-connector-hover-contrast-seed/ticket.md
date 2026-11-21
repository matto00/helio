# HEL-1805: Connector row, actions trigger and "Test connection" hovers are ~1.05 contrast (below 1.10 floor); contrast guard seeds no connector

## Description

origin_kind: followup
origin_ticket: HEL-1649 (PR matto00/helio#1203, merged as 13180246a). The owner chose to file this.

On `/connectors`, three hovers measure about 1.05 contrast against their resting state, below the HEL-866 floor of 1.10, at every width and in both themes:

* the connector row;
* its actions trigger;
* the "Test connection" button.

The HEL-866 state-surface contrast guard does not catch this. Its test data seeds no connector, so these controls never render while it runs.

## Do

* Give each control the DESIGN.md §5 hover that matches its resting recipe, inside `@media (hover: hover)` (HEL-1735).
* Seed a connector in the guard's test data, so these controls are measured at every width the guard covers (1440, 1100, 768, 390).

## Acceptance criteria

- [ ] With the connector seeded, the guard fails on the current code for all three controls. Commit that red run.
- [ ] It passes after the fix, in both themes.
- [ ] The CI time the change adds is measured and stated.

## Owner rulings that bind (from HEL-1649, 2026-11-20, relayed by the driver)

- Each control gets the DESIGN.md §5 hover matching its resting recipe, inside `@media (hover: hover)` (HEL-1735).
- Narrow widths are measured with a mouse pointer.
- The only exemption is the glass bottom-nav (HEL-1801).
- A control that fits no §5 recipe is escalated, not decided in-lane.
