## MODIFIED Requirements

### Requirement: Stack panel heights are content-appropriate per panel kind
In the phone stack, panel heights SHALL be derived from the panel kind — never from the desktop formula
`h × rowHeight`. The stored `h` SHALL only modulate within a kind's clamped band. Per-kind policy (starting
values, expected to be tuned on device):

- `metric`: content-sized within ~104–132px; `h` is ignored entirely.
- `chart`: aspect-driven `clamp(200px, w × 0.62, 340px)` where `w` is panel content width; `h ≤ 4` selects
  the compact end of the band, `h ≥ 8` the tall end.
- `table`: capped at `min(60dvh, header + rows × rowHeight)`; scrolls internally beyond the cap.
- `text` and `markdown`: fully intrinsic — no fixed height, no cap, no internal scroll.
- `image`: natural aspect ratio, `max-width: 100%`, `height: auto`.
- `divider`: intrinsic hairline with no card chrome (no header, no footer).
- `collection`: fully intrinsic — no fixed height, no internal scroll; the item grid wraps to the
  stack's content width (an explicit policy entry, not a fall-through default).

The per-kind policy SHALL live in a single pure module so device-tuning is a one-file change.

#### Scenario: Metric panel is not mostly whitespace
- **WHEN** a metric panel with stored `h = 5` renders in the stack
- **THEN** its height is content-sized within the metric band (~104–132px), not `5 × 52px`

#### Scenario: Chart height respects the clamped aspect band
- **WHEN** a chart panel renders in the stack at content width `w`
- **THEN** its height is within `clamp(200px, w × 0.62, 340px)`
- **AND** a chart with `h ≤ 4` is shorter than a chart with `h ≥ 8` at the same width

#### Scenario: Markdown flows with the page
- **WHEN** a markdown panel with long content renders in the stack
- **THEN** the panel grows to its intrinsic content height with no internal scrollbar

#### Scenario: Collection sizes intrinsically in the stack
- **WHEN** a collection panel with several metric items renders in the stack at phone width
- **THEN** the panel grows to its intrinsic content height with no internal scrollbar
- **AND** the item grid wraps within the stack content width with no horizontal body scroll
