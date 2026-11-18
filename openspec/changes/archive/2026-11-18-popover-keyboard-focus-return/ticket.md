# HEL-1759: Appearance editor and actions menu: keyboard focus is lost after a failed save, and Shift+Tab closes the popover onto the page body

## Description

origin_kind: followup
origin_ticket: HEL-1756 (PR matto00/helio#1157, merged as 1e0d610bb)

HEL-1756 made the dashboard appearance editor move focus into its form when it opens. Two keyboard problems are left:

1. **Failed save.** If a save made with the keyboard fails, focus drops to the page, because Save is disabled while saving; that part predates HEL-1756. The next focus move out of the editor then closes it and throws away the picked preset.
2. **Shift+Tab from the first preset** closes the editor and leaves focus on the page body instead of returning it to the trigger. The shared actions menu does the same.

**Fix:**

* After a failed save, return focus to Save or to the error message, or use `aria-disabled` instead of `disabled` while saving.
* When a popover closes because focus left it, return focus to its trigger.

Also seen in HEL-1756: its e2e test made throwaway users with spaces in their emails, which the guarded `buildUserDeleteSql` refuses. I deleted them by hand. Make that spec's emails plain addresses.

## Acceptance Criteria

* e2e tests in a real browser, keyboard only, showing each case failing first: a failed save keeps the editor open with focus on Save or the error, and Shift+Tab out of either popover lands on its trigger.
* The HEL-1756 spec's throwaway emails are plain addresses (premise validation found this already true on main 9054da2a6; re-verify, change nothing if so).
