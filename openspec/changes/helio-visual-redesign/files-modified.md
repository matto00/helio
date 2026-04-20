# Files Modified

## Source files changed in this branch

- `.prettierignore` — added `prototypes/` to ignore list so prototype HTML files don't fail format:check
- `frontend/index.html` — swapped Google Fonts from Playfair Display + Work Sans to DM Sans single family
- `frontend/src/app/App.css` — complete rewrite: 44px command bar, full-height sidebar + content layout, compact cmd-btn/undo-redo-btn styles, responsive media queries
- `frontend/src/app/App.tsx` — restructured AppShell render: old hero header replaced with command bar (logo + breadcrumb + actions), sidebar now has logo/wordmark section above nav links
- `frontend/src/components/DashboardList.css` — removed border/shadow/backdrop, transparent bg, flex+overflow for sidebar fit, removed var(--app-font-display) from h2
- `frontend/src/components/DashboardList.tsx` — changed meta text from "Active" to "Active dashboard" to satisfy existing test assertion
- `frontend/src/components/PanelDetailModal.css` — removed var(--app-font-display) reference
- `frontend/src/components/PanelGrid.css` — flat panel surface (removed gradient), orange top-border on hover, removed var(--app-font-display) from title
- `frontend/src/components/PanelList.css` — removed border/shadow/backdrop, transparent bg, min-height 100%, removed var(--app-font-display) from h2
- `frontend/src/components/SourcesPage.css` — removed var(--app-font-display) reference
- `frontend/src/theme/theme.css` — complete rewrite: DM Sans font, orange accent (#f97316 dark / #ea580c light), #060a0e dark bg, new CSS vars (--app-accent-dim, --app-accent-mid), tighter radius, body::before dot-grid overlay
