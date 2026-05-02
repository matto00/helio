# Files Modified — image-panel-type

## Schemas

- `schemas/panel.schema.json` — added `"markdown"` and `"image"` to `type.enum`; added `typeId`, `fieldMapping`, `content`, `imageUrl`, `imageFit` properties; schema now accurately reflects the full panel API response shape
- `schemas/create-panel-request.schema.json` — added `"markdown"` and `"image"` to `type.enum`; added `content` property

## Backend

- `backend/src/main/resources/db/migration/V20__image_panel_type.sql` — new migration adding `image_url` and `image_fit` nullable TEXT columns to `panels`
- `backend/src/main/scala/com/helio/domain/model.scala` — added `Image` case object to `PanelType`; updated `fromString`/`asString`; added `imageUrl`/`imageFit` to `Panel` case class
- `backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala` — updated `PanelRow` with `imageUrl`/`imageFit` columns, updated Slick projection, `rowToDomain`, `domainToRow`, added `updateImage` method
- `backend/src/main/scala/com/helio/infrastructure/DashboardRepository.scala` — updated `panelRowToDomain` and import PanelRow construction to carry `imageUrl`/`imageFit`
- `backend/src/main/scala/com/helio/api/RequestValidation.scala` — added `validateImageFit` (accepts `contain|cover|fill` or absent; rejects anything else)
- `backend/src/main/scala/com/helio/api/routes/PanelRoutes.scala` — updated PATCH handler: added `hasImage` check, `imageFit` validation, `applyImageUpdate` step
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — added `imageUrl`/`imageFit` to `PanelResponse` (now `jsonFormat12`), `UpdatePanelRequest`, `DashboardSnapshotPanelEntry` (now `jsonFormat9`); updated `fromDomain` helpers

## Backend Tests

- `backend/src/test/scala/com/helio/domain/PanelTypeSpec.scala` — added tests for `Image` type round-trip
- `backend/src/test/scala/com/helio/api/ImageFitValidationSpec.scala` — new spec covering valid and invalid `imageFit` values

## Frontend

- `frontend/src/types/models.ts` — added `"image"` to `PanelType` union; added `ImageFit` type; added `imageUrl`/`imageFit` to `Panel` interface
- `frontend/src/services/panelService.ts` — added `updatePanelImage` service function
- `frontend/src/components/ImagePanel.tsx` — new component rendering `<img>` with `objectFit` or grey placeholder when `imageUrl` is absent
- `frontend/src/components/ImagePanel.css` — styles for `ImagePanel`
- `frontend/src/components/PanelContent.tsx` — added `imageUrl`/`imageFit` props; added `"image"` case wiring to `ImagePanel`
- `frontend/src/components/PanelGrid.tsx` — passes `panel.imageUrl`/`panel.imageFit` through `PanelCardBody` to `PanelContent`
- `frontend/src/components/PanelList.tsx` — added `{ value: "image", label: "Image" }` to `PANEL_TYPES`
- `frontend/src/components/PanelDetailModal.tsx` — added `"image"` tab with URL input and fit selector; added `updatePanelImage` dispatch; updated dirty tracking
- `frontend/src/features/panels/panelsSlice.ts` — added `updatePanelImage` async thunk and `fulfilled` reducer case

- `frontend/src/features/panels/panelSlots.ts` — added `image: []` entry to satisfy `Record<PanelType, PanelSlot[]>` exhaustiveness

## Frontend Tests

- `frontend/src/components/ImagePanel.test.tsx` — new tests covering `<img>` render with URL, `objectFit` values, and placeholder when URL is null/empty; fixed queries to use `container.querySelector("img")` since `alt=""` gives `presentation` ARIA role
- `frontend/src/components/PanelList.test.tsx` — added test verifying `image` radio option appears in the type selector
- Various test fixture files (`App.test.tsx`, `panelsSlice.test.ts`, `PanelDetailModal.test.tsx`, `PanelGrid.test.tsx`, `ComputedFieldPicker.test.tsx`, `dashboardLayout.test.ts`, `usePanelData.test.ts`) — updated Panel test objects with `imageUrl: null, imageFit: null` to satisfy updated `Panel` interface
