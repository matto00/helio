## 0. Schema

- [x] 0.1 Update `schemas/panel.schema.json`: add `"divider"` to the `type` enum and add optional properties `dividerOrientation`, `dividerWeight`, `dividerColor`

## 1. Backend

- [x] 1.1 Add `Divider` case object to `PanelType` sealed trait in `model.scala`
- [x] 1.2 Update `PanelType.fromString` to accept `"divider"` and `PanelType.asString` to emit it
- [x] 1.3 Add `dividerOrientation`, `dividerWeight`, `dividerColor` fields to `Panel` case class
- [x] 1.4 Write Flyway migration `V21__divider_panel_type.sql` adding the three nullable columns
- [x] 1.5 Add `dividerOrientation`, `dividerWeight`, `dividerColor` to `PanelRow` and `PanelTable` in `PanelRepository`
- [x] 1.6 Update `PanelRepository.rowToPanel` to map the three new columns
- [x] 1.7 Add `updateDividerFields` method to `PanelRepository` (None = leave unchanged semantics)
- [x] 1.8 Update `PanelRepository.insertPanel` to accept and persist the three new fields
- [x] 1.9 Update `JsonProtocols` to serialize/deserialize `dividerOrientation`, `dividerWeight`, `dividerColor` on panel request/response types
- [x] 1.10 Update `RequestValidation` to validate `dividerOrientation` enum values
- [x] 1.11 Wire `updateDividerFields` into `PanelRoutes` PATCH handler

## 2. Frontend

- [x] 2.1 Add `"divider"` to the `PanelType` union in `models.ts`
- [x] 2.2 Add `dividerOrientation`, `dividerWeight`, `dividerColor` optional fields to the `Panel` interface
- [x] 2.3 Create `DividerPanel.tsx` component that renders a styled `<div>` rule respecting orientation, weight, and color
- [x] 2.4 Add `"divider"` case to `PanelContent.tsx` to render `DividerPanel`
- [x] 2.5 Add "Divider" entry to the panel type selector (label + icon)
- [x] 2.6 Add divider settings section to the panel settings sidebar with orientation toggle, weight input, and color picker
- [x] 2.7 Update `panelsSlice` PATCH thunk to include divider fields in update payload
- [x] 2.8 Update `panelService.ts` to pass divider fields on panel update requests

## 3. Tests

- [x] 3.1 Add backend unit tests for `PanelType.fromString("divider")` and `asString` in `PanelTypeSpec.scala`
- [x] 3.2 Add backend integration tests for PATCH with divider fields (set, leave-unchanged, invalid orientation)
- [x] 3.3 Add backend test for GET panels returning null divider fields on non-divider panel
- [x] 3.4 Write Jest tests for `DividerPanel.tsx`: horizontal render, vertical render, default weight/color
- [x] 3.5 Write Jest tests for panel settings sidebar: divider controls appear only for divider panels
## 4. Schema & Code Fixes (CR cycle 2)

- [x] 4.1 Update `schemas/create-panel-request.schema.json`: add `"divider"` to the `type` enum
- [x] 4.2 Fix null-color clobber in `PanelDetailModal.tsx` `handleDividerSubmit`: pass `null` when stored color is null and picker is at the fallback
- [x] 4.3 Thread `dividerColor: string | null` through `panelService.ts` and `panelsSlice.ts` thunk signature
- [x] 4.4 Promote `DividerOrientation` type to `models.ts`; tighten `Panel.dividerOrientation` to `DividerOrientation | null`
- [x] 4.5 Move `DividerOrientation` import in `PanelDetailModal.tsx` from inline type alias to canonical import
- [x] 4.6 Add Jest tests for null-color guard (no-op Save preserves null; explicit color is passed through)
