## ADDED Requirements

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

## MODIFIED Requirements

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
