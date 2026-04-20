## 1. Design Direction Prototyping

- [x] 1.1 Use the frontend-design skill to prototype Direction A: a bold dark-first aesthetic with distinctive typography
- [x] 1.2 Use the frontend-design skill to prototype Direction B: a refined minimal aesthetic with high contrast
- [x] 1.3 Use the frontend-design skill to prototype Direction C: a warm editorial aesthetic with expressive type
- [x] 1.4 Evaluate the 3 prototypes against: distinctiveness, production-appropriateness, dark/light parity potential
- [x] 1.5 Select the winning direction and document: palette tokens (dark + light), font names + weights, key aesthetic rules

## 2. Frontend — Token System

- [x] 2.1 Add font `<link>` tags (preconnect + stylesheet) to `frontend/index.html` for the chosen font pair
- [x] 2.2 Replace `--app-*` token values in `frontend/src/theme/theme.css` for `:root` (shared tokens: radius, shadow, transition)
- [x] 2.3 Replace dark theme token values in `[data-theme="dark"]` block
- [x] 2.4 Replace light theme token values in `[data-theme="light"]` block
- [x] 2.5 Update `font-family` stack in `:root` to use the new font pair with system fallbacks

## 3. Frontend — App Shell

- [x] 3.1 Update `frontend/src/app/App.css` — app shell, header, sidebar, and layout chrome to match the winning aesthetic
- [x] 3.2 Update `frontend/src/components/DashboardList.css` — card, list items, buttons, inputs
- [x] 3.3 Update `frontend/src/components/PanelList.css` — panel grid container, header, buttons, inputs, empty state
- [x] 3.4 Update `frontend/src/components/PanelGrid.css` — panel cards and grid chrome

## 4. Frontend — Components

- [x] 4.1 Update `frontend/src/components/PanelDetailModal.css` — modal surface, header, actions
- [x] 4.2 Update `frontend/src/components/DashboardAppearanceEditor.css` — editor panel styling
- [x] 4.3 Update `frontend/src/components/ActionsMenu.css` — dropdown/context menu
- [x] 4.4 Update `frontend/src/components/StatusMessage.css` and `InlineError.css` — status/error states (deliberate non-change: these files already consume `var(--app-surface-soft)` / `var(--app-text-muted)` tokens; error colors are intentionally hardcoded per Design Decision 4)
- [x] 4.5 Update `frontend/src/components/SourcesPage.css` and `DataSourceList.css` — data sources page

## 5. Tests

- [x] 5.1 Run `npm test` and fix any snapshot or rendering failures caused by CSS class/structure changes
- [x] 5.2 Run `npm run lint` and resolve any lint warnings introduced by the change
- [x] 5.3 Run `npm run format:check` and apply formatting if needed
- [x] 5.4 Visually verify both dark and light themes render correctly in the browser
