# motion-primitives Specification

## Purpose
Shared motion primitives (staggered entrance, layout slide, value tween, crossfade, indicator slide) and the
panel-grid layout timing, all driven by the DESIGN.md §10 motion tokens and the user's effective Motion setting.

## Requirements

### Requirement: Primitives take timing only from motion tokens
Every motion primitive SHALL take its durations, delays and easing curves from the `--motion-*` tokens declared in
`theme.css`, and SHALL contain no literal duration. A primitive that cannot resolve a token duration SHALL behave as
instant.

#### Scenario: Token change retimes a primitive
- **WHEN** the value of the token a primitive uses changes
- **THEN** the primitive's animation timing follows the new value with no source change in the primitive

#### Scenario: Literal duration rejected
- **WHEN** a primitive's source carries a literal duration
- **THEN** the motion guard test fails

### Requirement: One effective-motion reader
Components SHALL obtain the effective motion level (full, subtle or off) from the single shared reader, which follows
the appearance-preferences precedence (saved choice wins; with no saved choice OS reduce means off).

#### Scenario: Saved Subtle is reported as subtle
- **WHEN** the user saved Motion = Subtle and the OS reports reduced motion
- **THEN** the reader reports subtle

### Requirement: Staggered entrance
A list using the staggered entrance SHALL, on its first population, fade each item in while rising a few pixels,
each item starting one stagger step after the previous, with no item starting later than about 400ms. Re-renders
SHALL NOT replay it; an item added later SHALL enter without queueing behind earlier items.

#### Scenario: First load staggers
- **WHEN** the dashboard list first shows its rows with Motion = Full
- **THEN** rows fade and rise in sequence

#### Scenario: Subtle keeps only the fade
- **WHEN** Motion = Subtle
- **THEN** rows fade in without moving

### Requirement: Layout slide
Items in a list using layout slide SHALL move to their new position over the move duration when a sibling is added,
removed or reordered, instead of jumping. Under Subtle or Off they SHALL jump with no position animation.

#### Scenario: Removing a dashboard slides the rest up
- **WHEN** a dashboard row is removed with Motion = Full
- **THEN** the rows below slide into the freed space

### Requirement: Value tween
A numeric value using the value tween SHALL count from its previous value to its new value when it changes, and SHALL
show its first value without counting. Under Subtle or Off the new value SHALL appear instantly. The settled text SHALL
equal the value's normal formatted text.

#### Scenario: Metric value changes
- **WHEN** a metric panel's value changes from 120 to 180 with Motion = Full
- **THEN** the displayed number passes through intermediate values and settles on exactly the formatted 180

### Requirement: Crossfade
Content replacing a loading skeleton SHALL fade in while the skeleton fades out in the same place, without the
container collapsing between them. Under Off the swap SHALL be instant. Once loading ends the outgoing skeleton SHALL
be hidden from assistive technology and SHALL be removed even when no fade ran.

#### Scenario: Loading ends before the skeleton paints
- **WHEN** loading finishes so quickly that no fade transition starts
- **THEN** the skeleton is still removed and is not announced as loading

#### Scenario: Panel body loads
- **WHEN** a panel body finishes loading with Motion = Full or Subtle
- **THEN** the skeleton fades into the content in place

### Requirement: Indicator slide
An active-item indicator SHALL translate and resize from the previously active item to the newly active one over the
move duration. Its first placement SHALL NOT animate. Under Subtle or Off it SHALL move with no position animation.
The app rail and the segmented radio group SHALL use it.

#### Scenario: Navigating between rail destinations
- **WHEN** the user navigates from one rail destination to another with Motion = Full
- **THEN** the rail's active indicator slides to the new item

### Requirement: Subtle drops translate entrances on existing overlays
Under Motion = Subtle the toast, the mobile navigation sheet and the refinement chat drawer SHALL enter and leave with
an opacity fade only, without translating.

#### Scenario: Toast under Subtle
- **WHEN** a toast appears with Motion = Subtle
- **THEN** it fades in in place without sliding

### Requirement: No transform or position animation when motion is off
With Motion = Off, or OS reduced motion and no saved choice, no primitive SHALL animate transform or position; this
SHALL be verified in a real browser in both light and dark themes.

#### Scenario: OS reduce without a saved choice
- **WHEN** the OS reports reduced motion and the user saved no motion choice
- **THEN** list rows, rail and segmented indicators, and moved list items reach their final position with no
  running transform or position animation

### Requirement: Panel-grid layout motion uses one token duration
Panel-grid items, the drag placeholder and the grid container height SHALL all transition with the same move-duration
token and the ease-out curve, regardless of stylesheet load order. An item being dragged or resized, and the
placeholder while resizing, SHALL follow the pointer without a transition.

#### Scenario: Resizing a panel
- **WHEN** a panel is resized and its siblings reflow with Motion = Full
- **THEN** the siblings, the placeholder and the container height all animate over the same token duration
