# HEL-1762: Phone: provenance popover's bottom can sit under the bottom nav

## Description

origin_kind: followup
origin_ticket: HEL-1744 (PR matto00/helio#1161, merged as 5e84b8e3b). Defect from HEL-1756's placement.

The HEL-1744 evaluator saw that on phone the bottom of the provenance popover can sit under the fixed bottom nav
(at 390x844 the chip popover's bottom was at y=800, the nav's top at ~776). HEL-1756 fits the popover to the window but
does not subtract the bottom nav's height, so items under the nav can't be tapped.

**Fix:** the shared fit (`panelFit` and `usePortalPopover`'s `place`) should treat the bottom nav, and any fixed bottom
inset such as the safe area, as outside the usable area on phone. Check every popover that uses the fit, not only
provenance.

## Acceptance criteria

* e2e at 390x844 and on a short phone viewport, light and dark: an `elementFromPoint` check on the popover's last item
  is red before the fix and green after.
* The full HEL-1750, HEL-1756 and HEL-1759 spec files still pass.
