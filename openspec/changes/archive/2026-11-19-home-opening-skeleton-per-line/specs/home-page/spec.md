## ADDED Requirements

### Requirement: Opening line placeholder shows one skeleton bar per line

While the home summary is loading, the opening line's placeholder (the hidden default sentence) SHALL show one skeleton bar per rendered line of that hidden sentence, each bar spanning that line's text, at every viewport width and in every type style, in light and dark themes, so that at 431-604px (where the Sans default sentence is two lines) it shows two bars and never a single bar centred across both lines. The bars SHALL use the shared skeleton look (the same surface tokens, corner radius and shimmer as the other skeletons), each bar about as thick as the existing single bar (0.8 of the sentence's font size) with a visible gap of at least 8px between consecutive bars and SHALL follow the shared skeleton's reduced-motion and motion-off behaviour (no shimmer, a flat fill). The bars SHALL NOT change the placeholder's size or wrapping, so the placeholder stays the height of the default sentence at every width; the sentence text itself SHALL NOT be visible and SHALL stay hidden from assistive technology.

#### Scenario: Two lines, two bars
- **WHEN** a user opens Home at a width from 431 to 604px in the Sans type style, light or dark, and the summary has not arrived
- **THEN** the placeholder shows two skeleton bars, one on each line of the hidden default sentence, and no bar spans both lines

#### Scenario: Bars do not merge
- **WHEN** the placeholder shows two or more bars
- **THEN** consecutive bars are separated by a visible gap of at least 8px and each bar has rounded ends

#### Scenario: One line, one bar
- **WHEN** the hidden default sentence is one line (Sans from 605px wide)
- **THEN** the placeholder shows exactly one skeleton bar

#### Scenario: Reduced motion
- **WHEN** the user prefers reduced motion (or has set motion to Off) and the placeholder is shown
- **THEN** the bars do not shimmer and show the shared skeleton's flat fill

#### Scenario: Layout unchanged
- **WHEN** the summary arrives with the default opening sentence
- **THEN** the run timeline card does not move (0px), as before this change
