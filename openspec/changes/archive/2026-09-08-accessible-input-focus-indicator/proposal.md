## Why

`accessible-focus-indicator`'s existing requirement is already mechanism-neutral: the focus indicator SHALL
clear 3:1 "against every surface it can be rendered against." HEL-1046 satisfied that for `outline`-based
indicators and guarded it there. But eleven CSS sites convey focus by **`border-color` and `box-shadow`
instead** (ten after excluding one orphan — see design.md D9), after suppressing the outline — so they fall under the same requirement while being invisible to
the fix and to the guard that protects it. Measured, the raw accent as a focus border scores **2.38–2.80**
against the five surface tokens in light theme, below the 3:1 non-text floor. This is a conformance gap
against a requirement that already exists, not a new obligation.

## What Changes

- Focus states that convey focus by `border-color` route through `--app-focus-ring-color` (already derived
  per accent to clear 3:1 against every surface, in both themes) instead of raw `--app-accent`.
- The `--app-accent-dim` halo is reclassified as decoration, not indicator: at **1.08:1 light / 1.14:1 dark**
  it cannot carry the obligation and must not be counted toward it.
- Four **base-rule** `outline: none` suppressions are distinguished from focus-state suppressions and handled
  on their own terms, since they remove the outline unconditionally.
- HEL-1046's whitelist guard is extended (or joined by a sibling guard) so that conveying focus by `border`
  or `box-shadow` is covered rather than being an unguarded escape hatch from the outline whitelist.
- Sites that use bare `:focus` rather than `:focus-visible` are ruled on explicitly — fixed or filed, not
  silently absorbed.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `accessible-focus-indicator`: the contrast obligation is stated to bind on **whichever mechanism conveys
  focus** — outline, border, or shadow — so that changing mechanism cannot evade the floor, and a
  sub-threshold decorative layer cannot be credited as the indicator.

## Non-goals

- **Accent-as-text at 4.5:1 — owned by HEL-1048, owner-ruled not to be folded in here.** The accessibility
  floor and the visual-identity question stay separate decisions.
- Retuning the accent presets themselves.
- Restyling inputs beyond what the floor requires.

## Impact

`frontend/src/shared/ui/inputs.css` and five further stylesheets; `frontend/src/theme/` guards and
`DESIGN.md` §8. No wire, API, or schema impact — which is not the same as no downstream impact: every
focused input in the application changes appearance.
