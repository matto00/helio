# HEL-1738: "Refresh dashboard" during a panel's first load does nothing visible: give feedback or queue a refresh

## Description

origin_kind: followup
origin_ticket: HEL-1731 (PR matto00/helio#1136, merged as e532ba3e5)

When you press "Refresh dashboard" while a panel's first rows load is still running, no new request is sent. The panel
ignores `refresh()` while a load is in flight (`usePanelData.ts`), and `PullRefreshRegistry.start` counts the panel as
already refreshing. The round ends as soon as that first load finishes. The user gets no sign that the press did
anything.

The owner ruled to change this (2026-11-17). Choose one, and say which in the design:

* **Feedback:** the press visibly joins the round already running, for example with the refresh indicator.
* **Queue:** the press queues one refresh after the in-flight load. Several presses must not multiply requests.

## Acceptance Criteria

* Pressing during a first load gives the chosen behaviour, on desktop and phone, in light and dark.
* There is an e2e that fails first. It must wait on real readiness signals, not skeleton selectors.
* The hel1681 refresh-control spec stays green.

## Orchestrator notes (premise validation, see .concertino/runs/HEL-1738/evidence/premise-validation.md)

* Both code sites read as the ticket says on main f2358c16d.
* "Refresh dashboard" exists only in the phone shell (<=768px). The existing spec
  (`mobile-dashboard-pull-refresh`, "Desktop has no button") forbids it above 768px. "Desktop" in the AC is therefore
  verified as: a desktop (mouse, non-touch) browser context at a phone-shell width shows the chosen behaviour, and at
  1280px no button exists and nothing changes. Adding a desktop button is out of scope.
