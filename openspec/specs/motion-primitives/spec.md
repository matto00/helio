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
container collapsing between them, unless the consumer opts out of the content fade because the content brings its own
entrance, in which case only the skeleton fades out. Under Off the swap SHALL be instant. Once loading ends the outgoing
skeleton SHALL be hidden from assistive technology and SHALL be removed even when no fade ran. A consumer MAY keep the
content mounted while loading, in which case the content SHALL be invisible and not interactive until loading ends, and
a load that ends before the skeleton has painted SHALL swap with no fade at all. A consumer MAY ask for full-width block
layers, in which case the content SHALL keep its container's full width.

#### Scenario: Loading ends before the skeleton paints
- **WHEN** loading finishes so quickly that no fade transition starts
- **THEN** the skeleton is still removed and is not announced as loading

#### Scenario: Panel body loads
- **WHEN** a panel body finishes loading with Motion = Full or Subtle
- **THEN** the skeleton fades into the content in place

#### Scenario: Content kept mounted while loading
- **WHEN** a crossfade keeps its content mounted while loading
- **THEN** the content is present but invisible and not interactive until loading ends, then fades in

#### Scenario: Content with its own entrance
- **WHEN** a crossfade's consumer opts out of the content fade
- **THEN** the skeleton fades out and the content appears without a layer fade

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

### Requirement: Keyed entrance
The motion system SHALL provide a keyed entrance that staggers the items present on a surface's first non-empty render in
a caller-given order, and either pops in once or leaves unanimated any item that first appears later, as the caller
chooses. Re-renders SHALL never replay an entrance.

#### Scenario: Item added after the first render
- **WHEN** a surface using the keyed entrance with pop-for-later gains a new item
- **THEN** only that item rises in, once, and the existing items do not animate

### Requirement: Expand from an origin rectangle
The motion system SHALL provide an entrance that grows an element from a given origin rectangle to its own position,
under Full only, ending with no residual transform. Under Subtle, Off, or with no origin it SHALL make no animation call.

#### Scenario: No origin
- **WHEN** the expand entrance is used without an origin rectangle
- **THEN** no animation is started and the element's ordinary entrance applies

### Requirement: First mount per token
The motion system SHALL provide a check that reports true only for the first mount, across remounts, of a given token
within a scope, so an entrance tied to a data load plays at most once per load. Every token the component observes while
mounted SHALL count as seen, not only the token present at its mount.

#### Scenario: Remount with the same token
- **WHEN** a component using the check unmounts and mounts again with the same token
- **THEN** the check reports false on the second mount

#### Scenario: Token changes while mounted
- **WHEN** the token changes while the component stays mounted, and the component later unmounts and mounts again with that newer token
- **THEN** the check reports false on the new mount

### Requirement: One-shot change cue
The motion system SHALL provide a cue that fires once when a watched value changes into a target state while mounted,
never on mount.

#### Scenario: Mounted already in the target state
- **WHEN** an element mounts already in the target state
- **THEN** the cue does not fire

### Requirement: Lift and nudge role tokens
The motion tokens SHALL include a lift scale and a nudge distance that resolve to no movement (scale 1, 0px) under Subtle,
Off, and OS reduced motion with no saved choice.

#### Scenario: Subtle neutralises lift and nudge
- **WHEN** the Motion setting is Subtle
- **THEN** the lift scale resolves to 1 and the nudge distance to 0px

### Requirement: Swipe-dismissable bottom sheet
`shared/motion` SHALL provide a bottom sheet primitive that composes the shared modal dialog (focus trap, focus restore,
Escape and a visible close control all routed through one vetoable close request). On a phone it SHALL present
full-height from the bottom edge with a grab handle. A downward drag on the handle or the header SHALL move the sheet
with the finger; releasing past a distance or velocity threshold SHALL request close (and the sheet SHALL return to rest
if the request is vetoed), otherwise the sheet SHALL return to its rest position; a cancelled pointer SHALL return it.
At rest the sheet SHALL carry no transform, so popovers portalled from inside it anchor to their triggers. The sheet
SHALL stay open through its exit animation and only then report closed.
Settling, closing and the entrance SHALL take timing only from motion tokens. Under Subtle the entrance and exit SHALL
be an opacity fade only and a release SHALL snap; under Off nothing SHALL animate transform or position. Following the
finger is direct manipulation and SHALL work at every Motion level. A drag inside the body SHALL scroll the body and
never move the sheet.

#### Scenario: Swipe down dismisses
- **WHEN** a user drags the open sheet's handle down past the threshold and releases
- **THEN** the sheet requests close through the same path as the close button

#### Scenario: Short drag returns
- **WHEN** a user drags the handle down a short distance slowly and releases
- **THEN** the sheet returns to its rest position and stays open

#### Scenario: Body drag scrolls
- **WHEN** the user drags inside the sheet body
- **THEN** the body scrolls and the sheet does not move

#### Scenario: No transform at rest
- **WHEN** the sheet has settled after opening or after a short drag
- **THEN** the sheet element has no transform and a select popover inside it opens anchored to its trigger

#### Scenario: Motion off
- **WHEN** Motion = Off and the sheet opens or is dismissed by swipe
- **THEN** no transform or position animation runs after the finger lifts
