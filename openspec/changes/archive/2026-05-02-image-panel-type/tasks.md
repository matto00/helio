## 1. Backend

- [x] 1.1 Write Flyway migration `V10__image_panel_type.sql` adding `image_url TEXT` and `image_fit TEXT` nullable columns to `panels`
- [x] 1.2 Add `Image` case object to `PanelType` sealed trait in `model.scala`; update `fromString` / `asString` to include `"image"`
- [x] 1.3 Add `imageUrl: Option[String]` and `imageFit: Option[String]` fields to `Panel` case class in `model.scala`
- [x] 1.4 Update `PanelRow` in `PanelRepository.scala` to include `imageUrl` and `imageFit` columns; update Slick projection
- [x] 1.5 Update `PanelRepository` read path to populate `imageUrl` / `imageFit` on `Panel` from `PanelRow`
- [x] 1.6 Update `PanelRepository` write path (create + update) to persist `imageUrl` / `imageFit`
- [x] 1.7 Add `imageFit` validation to `RequestValidation` (accept `contain`, `cover`, `fill`, or null; reject other strings)
- [x] 1.8 Update `PATCH /api/panels/:id` handler to extract and pass `imageUrl` / `imageFit` from request body
- [x] 1.9 Update `JsonProtocols.scala` to serialize/deserialize `imageUrl` and `imageFit` on panel request and response types

## 2. Frontend

- [x] 2.1 Add `imageUrl` and `imageFit` fields to the `Panel` TypeScript type in the frontend model
- [x] 2.2 Update panel service / API layer to include `imageUrl` / `imageFit` in PATCH requests
- [x] 2.3 Create `ImagePanel` React component that renders `<img>` with `object-fit` from `imageFit` (default `contain`) and a placeholder when `imageUrl` is null
- [x] 2.4 Wire `ImagePanel` into `PanelBody` (or equivalent switch/render function) for `type === "image"`
- [x] 2.5 Add `image` as an option in the panel type selector (`PanelTypeSelector` or equivalent)
- [x] 2.6 Update panel detail modal / edit form to expose `imageUrl` and `imageFit` inputs for image panels
- [x] 2.7 Update Redux `panelsSlice` to handle `imageUrl` / `imageFit` in responses and optimistic updates

## 3. Tests

- [x] 3.1 Add backend unit test: `PanelType.fromString("image")` returns `Right(Image)`
- [x] 3.2 Add backend unit test: `imageFit` validation rejects invalid values
- [x] 3.3 Add frontend Jest test: `ImagePanel` renders `<img>` when `imageUrl` is set
- [x] 3.4 Add frontend Jest test: `ImagePanel` renders placeholder when `imageUrl` is null
- [x] 3.5 Add frontend Jest test: `image` option appears in type selector
