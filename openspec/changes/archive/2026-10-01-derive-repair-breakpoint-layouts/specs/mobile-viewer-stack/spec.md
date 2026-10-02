## MODIFIED Requirements

### Requirement: Stack order follows the stored xs layout
The stack SHALL order panels by the resolved `xs` layout's `y` coordinate ascending, breaking ties by `x`
ascending, where the resolved `xs` layout is the saved `xs` layout when valid and otherwise the layout derived
from the nearest authored breakpoint per `breakpoint-layout-resolution`. Deriving SHALL preserve the source
layout's reading order, so the stack order matches the source reading order.

#### Scenario: Panels ordered by y then x
- **WHEN** the `xs` layout places panel A at (x:0, y:2), panel B at (x:0, y:0), and panel C at (x:1, y:0)
- **THEN** the stack renders B, then C, then A

#### Scenario: No xs layout
- **WHEN** only the lg layout is authored, with image above markdown above text in reading order
- **THEN** the stack renders image, markdown, text in that order
