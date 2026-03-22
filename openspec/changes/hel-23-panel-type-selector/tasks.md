## 1. Component State

- [x] 1.1 Add `panelType` state (`PanelType`, default `"metric"`) to `PanelList`
- [x] 1.2 Reset `panelType` to `"metric"` alongside `title` on successful create and on cancel

## 2. Type Selector UI

- [x] 2.1 Add a `<fieldset>` / `<legend>` segment control below the title input with one `<input type="radio">` per type (`metric`, `chart`, `text`, `table`)
- [x] 2.2 Bind the radio group to `panelType` state
- [x] 2.3 Style the segment control in `PanelList.css` (pill row, active/hover states, theme-aware)

## 3. Wire Type into Create Dispatch

- [x] 3.1 Pass `type: panelType` to the `createPanel` thunk dispatch in `handleCreatePanel`

## 4. Tests

- [x] 4.1 Update `PanelList.test.tsx` — assert type selector is rendered in create mode
- [x] 4.2 Add test: selecting `chart` and submitting calls `createPanel` with `type: "chart"`
- [x] 4.3 Add test: submitting without changing type calls `createPanel` with `type: "metric"`
- [x] 4.4 Add test: type selector resets to `metric` after successful create

## 5. Verification

- [x] 5.1 Run `npm run lint` — zero warnings
- [x] 5.2 Run `npm run format:check` — clean
- [x] 5.3 Run `npm test` — all tests pass
- [x] 5.4 Run `npm run build` in `frontend/` — clean build
