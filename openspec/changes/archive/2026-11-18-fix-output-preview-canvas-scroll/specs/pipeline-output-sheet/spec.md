## ADDED Requirements

### Requirement: Output editor scroll extent is bounded by its content on a narrow viewport

When the Output editor dialog shows a chart Output's live preview, the dialog's scrollable area SHALL end at its
last rendered content. No element inside the editor body (including visually hidden accessibility text and the
chart's drawing surface) SHALL extend the dialog's scroll extent beyond the content, on a narrow viewport (375px wide, and 390x844) in both light and dark themes. The chart
preview SHALL still render inside its preview card and be clipped to it at desktop widths.

#### Scenario: Phone width shows no blank scroll past the content
- **WHEN** a user opens an existing chart Output in the Output editor at a 375px-wide or 390x844 viewport, in light
  or dark theme, and the chart preview has rendered
- **THEN** the dialog's scroll height does not exceed the bottom of its last content element by more than a
  rounding tolerance

#### Scenario: Desktop preview still renders inside its card
- **WHEN** a user opens the same chart Output in the Output editor at a desktop viewport
- **THEN** the chart preview's drawing surface is non-empty and lies within the preview card's bounds
