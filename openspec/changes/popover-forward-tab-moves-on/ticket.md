# HEL-1776: Actions menu: forward Tab off the last item should move on, not return to the trigger

## Description

origin_kind: followup
origin_ticket: HEL-1759

HEL-1759 returns focus to the trigger whenever Tab leaves a popover. In the actions menu, that includes pressing Tab forward off the last item.

**Owner ruling (2026-11-18):** limit the refocus to Shift+Tab. Forward Tab off the last item closes the menu and moves focus to the next focusable control after the trigger, as in the usual menu-button pattern. Shift+Tab off the first item still returns focus to the trigger.

## Acceptance criteria

* Forward Tab off the last actions-menu item closes the menu and focuses the next control after the trigger. An e2e covers this and fails first.
* Shift+Tab keeps HEL-1759's behaviour.
* Check whether the other popovers using HEL-1759's Tab handling (the appearance editor and any others) should follow the same rule, and say which ones change.
* The full hel1759 spec passes, with its forward-Tab case updated to the new rule.

## Premise notes (orchestrator, Setup)

* The hel1759 e2e spec has no forward-Tab case today (only the failed-save case and two Shift+Tab cases); the forward-Tab case is added, not updated.
* Actions-menu items are `tabIndex=-1`, so forward Tab from ANY item (not only the last) leaves the menu; the rule applies to every item.
