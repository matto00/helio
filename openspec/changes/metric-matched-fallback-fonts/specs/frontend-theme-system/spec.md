## ADDED Requirements

### Requirement: Metric-matched fallback faces for every web font

Each web font face the app loads (the sans face Schibsted Grotesk, the mono face JetBrains Mono and the serif face
Fraunces) SHALL be followed in its `--font-face-*` stack by metric-matched fallback faces: `@font-face` rules that use
only locally installed fonts (`src: local(...)`, never a download) and set `size-adjust`, `ascent-override`,
`descent-override` and `line-gap-override` so that text set in the fallback occupies the same line box and, for a
representative English sample at body and heading sizes, the same advance width as the web font, within 2% on average over a representative sample at 16, 20 and 28px (no single sample at a single size beyond 8% at weight 400; measured worst 7.4%, because Chromium's hinted advances are not linear in font size; weight 600 is not separately matched, see design.md D2). There SHALL be a matched fallback
for the Arial-metric family (Arial, Liberation Sans, Arimo, or the mono/serif equivalents) and for the DejaVu family.
The override values SHALL be reproducible from a committed derivation. The web font SHALL stay first in each stack,
and every type style (Sans, Serif headings, Mono) SHALL keep reading the stacks through the existing tokens.

#### Scenario: Fallback faces are declared and stacked
- **WHEN** the theme stylesheet is loaded
- **THEN** each of `--font-face-sans`, `--font-face-mono` and `--font-face-serif` lists its web font first and its metric-matched fallback faces next, and each fallback face is an `@font-face` whose `src` uses only `local()` and which sets all four metric overrides

#### Scenario: Fallback occupies the web font's box
- **WHEN** a representative sentence is rendered with `line-height: normal` in a matched fallback face and in its web font at the same body or heading font size
- **THEN** the mean rendered width ratio over the sample sizes is within 2% (no single sample beyond 8% at weight 400) and the line-box heights differ by at most 1px

#### Scenario: No download for a fallback
- **WHEN** a page loads with the web fonts blocked
- **THEN** no request is made for any fallback face, and text renders in the matched fallback
