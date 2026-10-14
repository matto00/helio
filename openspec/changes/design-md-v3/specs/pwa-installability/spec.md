## MODIFIED Requirements

### Requirement: iOS installability meta tags
`index.html` SHALL include `viewport-fit=cover` in the viewport meta, `apple-mobile-web-app-capable`,
`apple-mobile-web-app-status-bar-style`, an `apple-touch-icon` link to a 180×180 icon, and two
`<meta name="theme-color">` tags gated on `prefers-color-scheme` sourcing the light and dark `--app-bg` values.

#### Scenario: iOS meta tags present
- **WHEN** `index.html` is inspected
- **THEN** it contains `viewport-fit=cover`, `apple-mobile-web-app-capable`, an `apple-touch-icon` link, and
  dual `theme-color` metas for light (`#f4f2ed`) and dark (`#0f0e0d`)

