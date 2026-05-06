## 1. Frontend — Types & Service

- [ ] 1.1 Add `Pipeline` interface to `frontend/src/types/models.ts` (id, name, outputDataTypeId?)
- [ ] 1.2 Create `frontend/src/services/pipelineService.ts` with `fetchPipelines(): Promise<Pipeline[]>`

## 2. Frontend — Route Registration

- [ ] 2.1 Add `/pipelines` and `/pipelines/:id` routes inside `ProtectedRoute > AppShell` in `App.tsx`
- [ ] 2.2 Add "Pipelines" `NavLink` to the sidebar nav in `App.tsx`
- [ ] 2.3 Update command-bar breadcrumb in `App.tsx` to handle pipelines path

## 3. Frontend — PipelinesPage (list)

- [ ] 3.1 Create `frontend/src/components/PipelinesPage.tsx` — fetch pipelines, render a list of clickable rows linking to `/pipelines/:id`
- [ ] 3.2 Create `frontend/src/components/PipelinesPage.css`

## 4. Frontend — PipelineDetailPage

- [ ] 4.1 Create `frontend/src/components/PipelineDetailPage.tsx` — top-level page with source bar, river view, footer bar sections
- [ ] 4.2 Implement source selector bar — dispatch `fetchSources`, render one chip per source with toggle + preview button
- [ ] 4.3 Implement inline source preview panel — shown on chip preview click, static mock rows in monospace table
- [ ] 4.4 Implement static SVG ribbon component — 4–5 Bezier bands with design-token colors, viewBox="0 0 800 50" preserveAspectRatio="none"
- [ ] 4.5 Implement `StepCard` component — collapsed (icon, label, row count, chevron) and expanded (config form, column diff chips, Preview/Remove buttons)
- [ ] 4.6 Implement op-type dropdown — positioned `<ul>` with 6 op types, opens from inline ribbon + button and bottom add button
- [ ] 4.7 Implement river view empty state — "Add your first transformation step" message + add button
- [ ] 4.8 Implement footer bar — editable output name (inline input on click), schema chips, row stats, Preview ghost button, Run pipeline button with glow
- [ ] 4.9 Wire "Run pipeline ▶" to `window.alert("Pipeline execution coming soon")`
- [ ] 4.10 Create `frontend/src/components/PipelineDetailPage.css` using design tokens

## 5. Tests

- [ ] 5.1 Create `frontend/src/components/PipelineDetailPage.test.tsx`
- [ ] 5.2 Test: route `/pipelines/:id` renders `PipelineDetailPage`
- [ ] 5.3 Test: back navigation link renders and `href` is `/pipelines`
- [ ] 5.4 Test: source selector renders sources fetched from API
- [ ] 5.5 Test: empty state shows "Add your first transformation step" when steps is empty
- [ ] 5.6 Test: adding a step adds a card to the river view
- [ ] 5.7 Test: removing a step removes its card
- [ ] 5.8 Test: output name field is editable (input appears on interaction)
- [ ] 5.9 Test: "Run pipeline" click triggers placeholder message
