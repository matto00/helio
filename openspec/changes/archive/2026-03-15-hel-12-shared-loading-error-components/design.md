## Context

Four frontend components (`DashboardList`, `PanelList`, `DashboardAppearanceEditor`, `PanelAppearanceEditor`) each define their own loading and error UI inline using duplicated markup and CSS. The visual output is nearly identical across all four but the code is not shared.

## Goals / Non-Goals

**Goals:**
- Two focused shared components: `StatusMessage` (fetch-level) and `InlineError` (form-level)
- Remove duplicated CSS rules from the four component stylesheets
- No visible behavior change for users

**Non-Goals:**
- Spinner animations or skeleton loaders (richer visuals come later)
- Abstracting button loading state ("Creating...", "Saving...") — those remain local
- Empty/no-selection state messages in `PanelList` — those are semantic, not error/loading states

## Decisions

**Two components, not one general one**
`StatusMessage` handles fetch state (block-level, padded, bordered) while `InlineError` handles form errors (small text, inline). The use cases have different layout needs; merging them into one component would require awkward variant props.

**Props: status + message, not children**
`StatusMessage` takes `status: "loading" | "failed"` and `message?: string`. This keeps usage concise at the call site — callers pass Redux state directly rather than constructing JSX conditionals themselves.

**InlineError takes a nullable string**
`InlineError` renders nothing when `error` is null/undefined, so callers can unconditionally render `<InlineError error={createError} />` without wrapping it in a conditional.

**CSS Modules not used — plain CSS files consistent with the rest of the codebase**
All existing components use plain BEM-style class names. New components follow the same convention.

## Risks / Trade-offs

- [Minimal visual drift] The shared CSS may look slightly different in edge cases where a component had custom spacing adjustments. → Use the `DashboardList` styles as the reference baseline; they are the most complete.
