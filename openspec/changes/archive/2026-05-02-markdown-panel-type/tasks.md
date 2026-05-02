## 1. Backend

- [x] 1.1 Add `Markdown` case object to `PanelType` sealed trait in `domain/model.scala`
- [x] 1.2 Update `PanelType.fromString` and `asString` to handle `"markdown"`
- [x] 1.3 Add `content: Option[String]` field to `Panel` case class in `domain/model.scala`
- [x] 1.4 Create Flyway migration `V10__panel_content.sql` adding `content TEXT` column to `panels`
- [x] 1.5 Update `PanelRepository` Slick mapping to read/write the `content` column
- [x] 1.6 Update `JsonProtocols` to serialize/deserialize `content` in panel request/response
- [x] 1.7 Update `PanelRoutes` / `RequestValidation` to accept `content` in `POST` and `PATCH` bodies
- [x] 1.8 Ensure `content` is carried through panel duplication in `PanelRepository`

## 2. Frontend

- [x] 2.1 Install `react-markdown` npm dependency
- [x] 2.2 Add `markdown` to the `PanelType` union type and type guard in the frontend types
- [x] 2.3 Update `panelsSlice` and panel service to include `content` field in panel state and API calls
- [x] 2.4 Create `MarkdownPanel` component that renders `content` via `react-markdown`
- [x] 2.5 Add empty/placeholder state to `MarkdownPanel` when content is null or empty
- [x] 2.6 Wire `MarkdownPanel` into the panel type switch in the grid rendering
- [x] 2.7 Add `markdown` option to the panel type selector component
- [x] 2.8 Add markdown content `<textarea>` to the panel detail view edit mode
- [x] 2.9 Wire textarea save to dispatch `PATCH /api/panels/:id` with updated `content`

## 3. Tests

- [x] 3.1 Backend: add ScalaTest cases for `PanelType.fromString("markdown")` and `asString`
- [x] 3.2 Backend: add test for `POST /api/panels` with `type: markdown` returns `content` field
- [x] 3.3 Backend: add test for `PATCH /api/panels/:id` updating `content` on a markdown panel
- [x] 3.4 Frontend: add Jest snapshot/unit test for `MarkdownPanel` with content and without
- [x] 3.5 Frontend: verify `panelsSlice` handles `content` field in panel upsert action
