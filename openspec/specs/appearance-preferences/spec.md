# appearance-preferences Specification

## Purpose
Lets each user choose a type style, a density and a motion level in Settings → Appearance, applies each choice
app-wide through tokens and root attributes, and keeps the choice consistent across devices with no flash on load.

## Requirements

### Requirement: Appearance settings section
Settings SHALL show an Appearance section, introduced by the line "Make Helio yours. Changes apply instantly and
follow you across devices.", with, in order: Accent (the existing presets, unchanged behaviour), Mode (the existing
light/dark toggle, unchanged behaviour), Type style (Sans + mono, Mono, Serif headings; each option previews its heading face), Density (Comfortable, Compact),
Motion (Full, Subtle, Off) with the note "Defaults to your system's reduce-motion setting", and a non-interactive Theme
row marked "Later". Each control SHALL be keyboard-operable with one selected option exposed to assistive technology,
and the current effective value SHALL be shown as selected. Selecting an option SHALL apply immediately, with no
reload, and save it to the user's preferences.

#### Scenario: Selecting a type style applies without reload
- **WHEN** the user selects "Serif headings"
- **THEN** page titles and other headings render in the serif heading face immediately, without a page reload, and the
  choice is saved

#### Scenario: Effective motion shown when nothing saved
- **WHEN** a user with no saved motion choice opens Appearance with OS reduce-motion on
- **THEN** "Off" is shown as selected

#### Scenario: Theme placeholder is inert
- **WHEN** the user views the Theme row
- **THEN** it is marked "Later" and offers no selectable control

### Requirement: Type style is applied through font tokens
The type style SHALL be applied by a root attribute that switches font tokens only, with no component branching on the
style. Sans + mono (default) SHALL render the UI in the sans face with headings in the sans face. Serif headings SHALL
render headings and brand moments in the serif display face and leave body copy, controls and data unchanged. Mono
SHALL render the whole UI — headings, body copy, controls and data — in the mono face. Under every style, text SHALL
stay unclipped at 1280, 820, 768 and 375px wide, tabular numbers and table columns SHALL stay aligned, and touch
targets SHALL stay at or above 44px.

#### Scenario: Default user sees sans headings
- **WHEN** a user with no saved type style loads any page
- **THEN** headings and body text resolve to the sans face

#### Scenario: Serif headings leave body text alone
- **WHEN** the user selects "Serif headings"
- **THEN** page titles render in the serif face and body text and form controls keep the sans face

#### Scenario: Mono switches the whole UI
- **WHEN** the user selects "Mono"
- **THEN** page titles, body text, buttons and form controls all render in the mono face, without a reload

#### Scenario: Preview cards show their own face
- **WHEN** Mono is the active style and the user views the Type style options
- **THEN** the "Sans + mono" card previews the sans face and the "Serif headings" card previews the serif face

#### Scenario: Charts follow a live switch
- **WHEN** a chart panel is visible and the user switches the type style to Mono
- **THEN** the chart's global text style (title and legend text) re-renders in the mono face without a reload

#### Scenario: Mono keeps layouts intact
- **WHEN** the user selects "Mono" on a phone-width layout
- **THEN** no bottom-navigation or command-bar label that is not deliberately ellipsized is clipped, and every tap
  target meets the 44px floor by its documented mechanism (painted box or invisible hit expander)

#### Scenario: Accent swatches meet the tap floor
- **WHEN** the Appearance page is used on a touch device
- **THEN** each accent swatch's hit area is at least 44px and no two hit areas overlap

### Requirement: Density token sets
Density SHALL switch between two documented token sets, Comfortable (default) and Compact, that control the
desktop panel-grid gutter and the row spacing of the overview list tables and the shell context list. Compact SHALL be strictly
tighter than Comfortable in each token. Comfortable SHALL be the desktop default spacing (the default panel-grid gutter and the list row padding
in use before this change). Compact SHALL compensate the grid row height for its smaller gutter, so panel tops do
not move and every viewer of a shared dashboard sees the same layout. Tap targets on touch layouts SHALL stay at or above the 44px minimum.

#### Scenario: Compact tightens the panel grid
- **WHEN** the user selects Compact on a dashboard with panels
- **THEN** the horizontal and vertical gutter between panels is the Compact token value, without a reload

#### Scenario: Default density is the default spacing
- **WHEN** a user with no saved density opens a dashboard and a section overview list
- **THEN** the panel gutter equals the desktop default gutter and the list row padding equals its value before this
  change

#### Scenario: Compact keeps panel positions
- **WHEN** the user switches from Comfortable to Compact on a dashboard
- **THEN** every panel's top edge stays at the same vertical position and each panel's height changes by exactly the
  difference between the two gutters

#### Scenario: Compact tightens list rows
- **WHEN** the user selects Compact and opens a section overview list
- **THEN** each row is shorter than under Comfortable, by the documented token difference

### Requirement: Motion setting and reduced-motion precedence
The root SHALL carry `data-motion="full|subtle|off"` exactly when the user has saved a motion choice, and no
`data-motion` attribute otherwise. With no saved choice the OS `prefers-reduced-motion: reduce` setting SHALL produce
Off behaviour; an explicit saved choice SHALL beat the OS setting. Off SHALL reduce every animation and transition
driven by the motion tokens and the transition shorthands to a near-instant (0.01ms) change that still fires its end
event. Subtle SHALL keep fades and drop the
overshoot curve. Every existing reduced-motion consumer (CSS rules and script checks) SHALL follow the same
precedence. The public landing page, which never carries saved preferences, SHALL keep following the OS setting
alone.

#### Scenario: Off disables token-driven motion
- **WHEN** the user selects Off
- **THEN** every element whose transition or animation uses a motion token or shorthand completes instantly

#### Scenario: No preference follows the OS
- **WHEN** a user with no saved motion choice has OS reduce-motion on
- **THEN** animations behave as Off

#### Scenario: Explicit Full beats the OS
- **WHEN** a user who saved Full has OS reduce-motion on
- **THEN** token-driven animations run at their normal durations

#### Scenario: Returning to the system default
- **WHEN** a user with a saved motion choice chooses to follow the system setting again
- **THEN** the saved choice is removed and the root carries no `data-motion`

### Requirement: Appearance applied before first paint
For a user with a non-default appearance preference, the app SHALL apply the type style, density and motion attributes
before the first paint of the authenticated app on a device where they have signed in before, and SHALL NOT render
authenticated headings in the default face before the saved style is applied on any device. Signing out SHALL clear
the locally cached appearance.

#### Scenario: No flash on reload
- **WHEN** a user with Serif headings saved reloads the app
- **THEN** the first painted heading is already in the serif face

#### Scenario: New device
- **WHEN** the same user signs in on a device with no cached appearance
- **THEN** authenticated headings first render in the serif face, not the default face
