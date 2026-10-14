# App Module

Holds application bootstrap concerns:

- provider composition
- routing integration
- global initialization
- the authenticated shell (`shell/`): the 56px icon rail (`AppRail`), the resizable, collapsible context list
  (`ContextList`, `ContextListSeparator`, `useContextListLayout`) and its per-section bodies, shown above the 768px
  phone breakpoint (`useIsPhoneShell`); see DESIGN.md §9
