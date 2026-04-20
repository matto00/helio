# HEL-68: Chart panel: appearance configuration

## Context

Once charts render real data (HEL-67), users should be able to customize their visual presentation. This ticket adds appearance controls for chart panels in the panel detail modal.

## What changes

* **Colors**: series color picker or palette selector (applies to lines/bars/slices)
* **Legend**: show/hide toggle, position (top/bottom/left/right)
* **Tooltip**: enable/disable; format string or template for value display
* **Axis labels**: show/hide X and Y axis labels; optional custom label text
* All settings persist to the panel's appearance config in the backend
* Changes preview live in the panel detail modal without requiring a save first

## Acceptance criteria

- [ ] Users can change series colors and see the chart update immediately
- [ ] Legend visibility and position are configurable and persist
- [ ] Tooltip can be enabled or disabled per panel
- [ ] Axis labels can be shown or hidden independently for X and Y axes
- [ ] All appearance settings survive a page reload
- [ ] Changes preview in real time without requiring an explicit save action
