## ADDED Requirements

### Requirement: A clamped panel card title exposes its full text

The desktop grid's panel card title SHALL carry the panel's full title as a native tooltip (`title` attribute), and
its accessible name SHALL be the full title, including when the title is visually line-clamped.

#### Scenario: clamped title on a footnoted narrow chart
- **WHEN** a footnoted chart panel with a long title is placed at w=2, h=4 at a 1440px viewport
- **THEN** the title heading's `title` attribute equals the full panel title, and the heading is found by its full title as its accessible name
