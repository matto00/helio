## 1. Backend / schema / contract

### Backend

- [x] 1.1 Confirm `fieldMapping.annotation` needs no chart domain change: `ChartPanelConfig.fieldMapping`
      already stores/round-trips arbitrary keys and `Panel.selectedFieldsFromMapping` selects all mapping
      values; verify no slot allowlist or validation rejects an `annotation` key on create/PATCH.
- [x] 1.2 Update `schemas/panel.schema.json`: document the reserved `fieldMapping.annotation` slot on the
      chart config (annotation may be static `config.annotation` OR bound `fieldMapping.annotation`); keep
      `fieldMapping` as `type: object` (no shape break).
- [x] 1.3 Update `helio-mcp/src/tools/write.ts` docs: note that a chart annotation can be bound via
      `fieldMapping.annotation` (in addition to the static `annotation`), passed through unchanged.

## 2. Frontend

### Frontend

- [x] 2.1 `ChartRenderer`/`PanelContent`: resolve the effective chart annotation as literal-wins —
      `config.annotation ?? data?.annotation ?? null` — and pass it to `ChartRenderer`'s `annotation` prop
      (`data.annotation` comes from `usePanelData`'s first-row `fieldMapping.annotation` resolution).
- [x] 2.2 `useChartDisplayState`/`BindingEditor`: add a `useBoundOrLiteralState` instance for the annotation
      slot; on save write `config.annotation` (Fixed text, clearing `fieldMapping.annotation`) or
      `fieldMapping.annotation` (Bind to field, clearing `config.annotation` → null); default the mode via
      `defaultBoundOrLiteralMode(config.annotation !== undefined)`.
- [x] 2.3 `ChartDisplayFields`: replace the plain annotation `TextField` with `BoundOrLiteralField`
      (mode toggle + switched input using the bound-column `fieldOptions`); offer "Bind to field" only when
      `isBound`, mirroring the scatter size/color field gating.
- [x] 2.4 Thread `fieldMapping.annotation` through create/PATCH payload plumbing (`panelPayloads.ts`,
      `panelThunks.ts`) so the bound slot round-trips; confirm static `config.annotation` path is unchanged.

## 3. Tests

### Tests

- [x] 3.1 Frontend: `ChartRenderer`/`PanelContent` — bound annotation renders the resolved field value,
      static wins when both present, and none renders when neither is set.
- [x] 3.2 Frontend: `ChartDisplayFields`/`useBoundOrLiteralState`/`BindingEditor` — mode toggle defaults,
      Fixed-text vs Bind-to-field save payloads (each clears the other), and bind-to-field gated on `isBound`.
- [x] 3.3 Backend: a chart PATCH with `fieldMapping.annotation` round-trips through create/PATCH/read and
      duplication, and the bound column appears in the panel query's selected fields.
- [x] 3.4 Run all gates green: `npm run lint`, `npm run format:check`, `npm run check:schemas`, `npm test`
      (root), `npm run build` (frontend/), and `sbt test` (backend/).
