# Shared

Cross-feature UI building blocks, split into `chrome/` and `ui/`. No
`features/*/shared` exists — there is no feature-local equivalent to
distinguish from; the split is between these two subdirectories instead.

- `chrome/` — persistent app-shell/navigation components: `SidebarBody`,
  `SidebarItemList`, `BottomNav`, `MobileNavSheet`, `ActionsMenu`,
  `AccentPicker`, `OverlayProvider`, `ErrorBoundary`. See also `ui/`.
- `ui/` — generic, feature-agnostic UI primitives: `Modal`, `Toast`,
  `IconButton`, `FormField`, `Skeleton`, `DataGrid`, `Select`, `Toggle`,
  `Spinner`, `StatusChip`, `EmptyState`. See also `chrome/`.

**Belongs here:** components any feature could render, with no feature-domain
knowledge.
**Does not belong here:** a component that only makes sense within one
feature's own UI — that lives in that feature's `ui/`.
