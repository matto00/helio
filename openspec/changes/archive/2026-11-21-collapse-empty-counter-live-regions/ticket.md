# HEL-1804: Compact counter card: empty alert/status live regions leave ~75px of blank space under the caption

## Description

origin_kind: followup
origin_ticket: HEL-1791 (PR matto00/helio#1202, merged as 3fa325155). The owner chose a standalone ticket.

### Problem

On a compact counter form card, the empty `.form-panel-view__alert` and `.form-panel-view__status` live regions each
take a 16 px gap. In the phone panel stack that leaves about 75 px of empty space under the caption. The gap was there
before HEL-1791; the card collapse was hiding it.

### Do

* Collapse the empty space while the regions are empty. Likely files are `CounterControl.css` and `FormPanelView.tsx`.
* Keep both live regions in the DOM at all times, so screen readers still announce messages. Do not mount them
  conditionally.

## Acceptance criteria

- [ ] At 390, 768 and 1100 px (sidebar open), light and dark, the blank space below the caption is gone while the
  regions are empty. A test fails first.
- [ ] An alert or status message still shows and is still announced.
- [ ] The other panel kinds in the stack keep their current height.
