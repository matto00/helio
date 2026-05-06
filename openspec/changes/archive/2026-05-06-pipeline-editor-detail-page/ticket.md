# HEL-180 — Pipeline editor — full detail page UI

## Title
Pipeline editor — full detail page UI

## Description
Implement the full pipeline editor detail page as designed in the Helio Pipes design session.

**Route:** `/pipelines/:id` — navigates from the pipeline list on click.

**Layout:**

* Source selector bar (top) — chips for each data source with toggle active/inactive and ⊞ preview button. Preview expands an inline data table showing first N rows.
* River view (main scrollable area) — vertical sankey ribbons flowing between accordion step cards. Ribbons show column bands widening/narrowing/fading as transforms reshape the data.
* Consolidated footer bar — editable output name, inferred schema chips, row stats, Preview button, orange "Run pipeline ▶" CTA.

**Step accordion cards:**

* Collapsed: icon, plain-language label, row count after step, expand chevron.
* Expanded: description, config form fields (label + value/select), Before → After column diff with added/removed/changed highlighting, "Preview data" + "Remove step" actions.

**Add step affordances:**

* Inline + button on hover between ribbon segments (dropdown of op types: Rename, Filter, Join, Compute, Group & Aggregate, Cast).
* Dashed "Add transformation step" button at the bottom.

**Step state is local for this ticket** — persistence via API lands in HEL-228 (pipeline steps schema + API). The Run pipeline button is wired to the execution endpoint from HEL-142 when that ships; for now it shows a toast/placeholder.

**Sources data** comes from the real `GET /api/data-sources` API. Step data starts empty (empty state: "Add your first transformation step").

**Navigation:** clicking a pipeline in `PipelinesPage` navigates to `/pipelines/:id`. Back navigation returns to the list.

## Design Context (River View)

### Page: /pipelines/:id (Pipeline Detail / Editor)

### Layout (top to bottom)
1. **Source selector bar** — `borderBottom`, `background: var(--app-surface-soft)`. Label "DATA SOURCES" (uppercase, muted). Row of source chips — each chip is split into two buttons sharing a border:
   - Left: toggle active/inactive (active = accent border + accent-surface bg). Shows icon, name, row count.
   - Right: ⊞ preview button. When active, expands an inline data preview table below the chip row showing sample columns/rows in monospace font with column names in accent color.
   - "+ Connect source" dashed button at the end.

2. **River view** (flex: 1, overflow-y: auto) — scrollable. Contains alternating: SVG ribbon segments + StepCard components.
   - **Ribbon segments**: SVG viewBox="0 0 800 50", preserveAspectRatio="none". Bezier paths showing column bands flowing between steps. Bands have color per "column family" (accent, accent-strong, secondary colors). Bands widen/narrow/fade as columns are added/removed/transformed. Opacity ~0.15 fill, 0.3 stroke.
   - **Inline + button**: appears on hover over a ribbon segment (opacity: 0 normally, 1 on hover). Centered, circular 24px button. Opens a dropdown of op types.
   - **StepCard (accordion)**:
     - Collapsed: `border: 1px solid var(--app-border-subtle)`, `background: var(--app-surface)`. Shows op icon (emoji), plain-language label (e.g. "Keep only paid orders"), row count after step in monospace, chevron ▾.
     - Expanded: `border: 1px solid var(--app-accent-mid)`, `background: var(--app-accent-surface)`. Shows description text, config form grid (label + value/select fields), Before→After column diff chips (added = accent, removed = strikethrough danger, changed = accent), "Preview data" + "Remove step" buttons.
   - **Empty state**: when no steps, show "Add your first transformation step" message + a prominent add button.
   - **Bottom "Add transformation step"** dashed button.
   - **Op type dropdown**: Rename column ✏, Filter rows 🔍, Join tables 🔗, Compute column 🧮, Group & aggregate 📊, Cast type ⇄.

3. **Footer bar** — `borderTop: 1.5px solid var(--app-accent-mid)`, `background: var(--app-accent-surface)`. Single consolidated bar:
   - Left: "OUTPUT" label (uppercase accent), editable output name (click to rename — shows inline input), inferred schema chips (column name badges in accent), "inferred" italic label.
   - Right: step count + row stats (e.g. "5 steps · 12,847 → 24"), "Preview" ghost button, orange "Run pipeline ▶" button with glow effect (`boxShadow: 0 0 16px rgba(249,115,22,0.3)`).

### Navigation
- `PipelinesPage` (list) clicking a pipeline navigates to `/pipelines/:id`.
- Detail page has a back affordance (breadcrumb "Data Pipelines / {pipeline name}" in command bar, or back button).
- Route registered in `App.tsx` as `/pipelines/:id` inside the protected AppShell routes.

### Data
- Sources: loaded from real `GET /api/data-sources` API. Source preview shows first few rows (static mock data is fine if the sources API doesn't return row data).
- Pipeline metadata (name, source, output type): from `GET /api/pipelines` → find by id.
- Steps: **local React state only** — no persistence API exists yet (HEL-228 is the follow-up ticket). Start with empty steps array. User can add/remove steps in the session but they don't persist.
- "Run pipeline ▶": shows a placeholder toast/alert ("Pipeline execution coming soon") — the real API lands in HEL-229.
- Output name: editable local state, pre-populated from pipeline's `output_data_type_id` name if available.

### Ribbon visualization
The ribbon is a visual metaphor, not real data. Use a static ribbon definition with ~4-5 column bands that flow through the steps. As steps are added, the ribbon doesn't need to recompute dynamically — a fixed decorative ribbon is acceptable for this ticket. The ribbon's job is to convey "data flows and transforms here", not to be pixel-accurate to the actual columns.

### CSS
Use the existing Helio design tokens: `var(--app-accent)` (orange), `var(--app-accent-surface)`, `var(--app-accent-mid)`, `var(--app-border-subtle)`, `var(--app-surface)`, `var(--app-surface-soft)`, `var(--app-text)`, `var(--app-text-muted)`, `var(--font-mono)`. Match the existing component style of `SourcesPage.tsx` and `PipelinesPage.tsx` for structural patterns.

### Tests needed
- Route `/pipelines/:id` renders `PipelineDetailPage`
- Back navigation link renders and points to `/pipelines`
- Source selector renders sources from API
- Empty step state renders "Add your first transformation step"
- Adding a step adds it to the list
- Removing a step removes it
- Output name is editable
- "Run pipeline ▶" click shows placeholder message

## Acceptance Criteria
- `/pipelines/:id` route renders the detail page
- Source selector bar loads from `GET /api/data-sources`
- River view with ribbon SVG and step cards renders
- Empty state shown when no steps
- Steps can be added and removed (local state)
- Footer bar with editable output name and Run button
- Run button shows placeholder message
- All listed tests pass
