## Why

Helio panels currently support metric, chart, text, table, and markdown types but offer no way to
display static imagery. Adding an image panel type enables users to embed branded logos, diagrams,
or reference images directly in dashboards without needing a data binding.

## What Changes

- Add `"image"` to the set of valid panel type values (backend enum, DB constraint, API validation)
- Add an `imageUrl` field to the panel record; stored as a URL string (null for non-image panels)
- Add an `imageFit` field to the panel record: one of `contain | cover | fill` (null for non-image panels)
- `PATCH /api/panels/:id` accepts `imageUrl` and `imageFit` for image panels
- Panel create form exposes the new `image` option in the type selector
- A new `ImagePanel` React component renders the stored URL with the chosen CSS `object-fit` value
- No DataType binding is required or used by image panels

## Capabilities

### New Capabilities
- `image-panel-type`: Backend persistence, API, and frontend rendering for the image panel type

### Modified Capabilities
- `panel-type-field`: Add `"image"` to valid type enum; add `imageUrl` and `imageFit` fields to panel
  response and PATCH request
- `panel-type-rendering`: Add image panel rendering scenario (URL + object-fit)
- `panel-type-selector`: Add `image` option to the type selector in the panel create form

## Impact

- **Backend**: Flyway migration adding `image_url` (text, nullable) and `image_fit` (text, nullable)
  columns to `panels`; updated Slick model; updated `RequestValidation` enum; updated JSON protocol
- **Frontend**: New `ImagePanel` component; updates to `PanelTypeSelector`, `PanelBody`, and panel
  PATCH service call to include `imageUrl` / `imageFit`
- **Schemas**: Panel schema updated to include `imageUrl`, `imageFit`, and `"image"` in type enum
- **No breaking changes** — existing panels are unaffected; new columns are nullable

## Non-goals

- File upload / binary storage (URL reference only)
- Image panel DataType binding
- Image cropping or editing controls
- Animated GIF controls
