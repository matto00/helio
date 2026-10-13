## ADDED Requirements

### Requirement: Edit form signals content beyond its visible area

When the panel detail modal's edit form has more content than fits its visible area, the form SHALL show a scroll-fade
at each edge that has off-screen content: a bottom fade while content remains below, and a top fade once content has
scrolled out above. A form whose content fits SHALL show no fade. The fade SHALL follow the actual scroll position and
content height, including after a control is added or removed, after a direct switch to another panel, and after a
viewport resize. It SHALL use theme tokens only, so it renders in light and dark themes.

#### Scenario: Controls below the fold are signalled

- **WHEN** an output panel's edit form opens with the Controls section below the visible area
- **THEN** the form shows a bottom scroll-fade and no top scroll-fade

#### Scenario: Scrolled to the end

- **WHEN** the user scrolls the edit form to its bottom
- **THEN** the bottom scroll-fade is removed and a top scroll-fade is shown

#### Scenario: Content that fits shows no fade

- **WHEN** the edit form's content fits within its visible area
- **THEN** neither scroll-fade is shown

#### Scenario: Content height changes without a resize

- **WHEN** content is added to or removed from the edit form, or the modal switches directly to another panel
- **THEN** the scroll-fades reflect the new content height without the user scrolling
