## ADDED Requirements

### Requirement: A theme's declared token values must be the values that render
Where a theme declares a value for a token, that value SHALL be the one the application actually renders for
that theme. A token whose value is supplied at runtime SHALL NOT also be declared per theme in a way that
suggests a per-theme value takes effect when it cannot, and any documentation of such a token SHALL describe
what actually happens.

#### Scenario: A declared per-theme value is not silently overridden
- **WHEN** a theme declares a value for a token
- **THEN** either that value renders in that theme, or no such per-theme declaration exists

#### Scenario: Runtime-supplied tokens are described accurately
- **WHEN** a token's value is supplied at runtime rather than by the theme
- **THEN** the stylesheet's description of that token says so, rather than implying a per-theme default takes
  effect
