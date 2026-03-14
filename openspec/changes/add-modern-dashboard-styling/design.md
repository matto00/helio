## Context

The current frontend now supports real dashboard selection and backend-backed panel loading, but the presentation is still minimal. This ticket should move the app toward a polished, professional dashboard product: dark-first by default, light mode available on demand, rounded surfaces, restrained motion, and a premium feel closer to a high-end marketing/product UI than a generic component-library default. At the same time, we should avoid baking in one-off visual decisions that make later user customization harder.

## Goals / Non-Goals

**Goals:**
- Add a reusable dark/light theme system with dark mode as the default.
- Persist the selected theme in the browser so refreshes keep the user preference.
- Introduce shared CSS variables and tokenized styling for color, spacing, radii, shadows, and motion.
- Restyle the app shell, sidebar, dashboard list, and panel area to feel modern, professional, and polished.
- Expand the dashboard layout to span the full browser width while keeping the dashboard canvas as the visual focus.
- Add a `react-grid-layout` foundation for flexible future panel placement and resizing.
- Use rounded edges and subtle depth without heavy animations or splashy click effects.
- Keep styling modular so future dashboard/panel appearance customization can build on the same foundation.

**Non-Goals:**
- Adding backend persistence for theme preference.
- Adding user-facing controls for dashboard background, panel background, panel transparency, or panel color in this ticket.
- Implementing per-dashboard or per-panel customization models.
- Introducing a heavy UI component library.

## Decisions

### Use CSS custom properties as the theme foundation
Theme tokens will live in CSS variables so dark and light mode can switch cleanly without rewriting component structure. This also creates a stable base for the future appearance customization work in `HEL-16`.

Alternative considered:
- Hardcoding colors directly into component styles was rejected because it would make future customization and theme maintenance harder.

### Default to dark mode and persist the choice in local storage
The app will boot in dark mode by default and read/write the active theme through `localStorage` so the preference survives refreshes.

Alternative considered:
- Session-only theme state was rejected because the user explicitly wants a persistent toggleable theme.

### Keep the styling system lightweight while using a purpose-built grid library
The visual pass will still rely on modular CSS and small React utilities, but it will use `react-grid-layout` as the panel-placement foundation. This gives the dashboard a proven flexible grid system without bringing in a heavy UI framework or unwanted default animations.

Alternative considered:
- Adding a full UI library was rejected because it would push visual behavior and motion defaults away from the desired polished, restrained look.

### Use a full-bleed shell with a dominant dashboard canvas
The shell should no longer feel like a narrow centered marketing page. The layout will span the viewport width, with the sidebar remaining compact and the main dashboard canvas taking up most of the available space.

Alternative considered:
- Keeping the current centered `max-width` shell was rejected because it leaves too little room for the dashboard experience and future free-placement panels.

### Establish a static starter grid before persistence
Panels will render inside a `react-grid-layout` grid with a generated starter layout derived from current panel data. This builds the layout foundation now without pulling persistence, drag-save behavior, or backend layout modeling into `HEL-15`.

Alternative considered:
- Waiting to introduce grid layout until full persistence exists was rejected because the layout foundation is directly relevant to the visual product direction and future customization work.

### Aim for premium restraint instead of heavy effects
The shell should use generous spacing, rounded cards, subtle borders, soft shadows, and minimal motion. Hover and active states can exist, but they should feel crisp and quiet rather than flashy.

Alternative considered:
- Highly animated glassmorphism or bold neon styling was rejected because it does not fit the requested professional Apple-like polish.

### Defer user appearance customization to a dedicated ticket
Actual controls for dashboard background, panel background, panel transparency, and panel color will be implemented in `HEL-16`, which includes both frontend and backend work. `HEL-15` should only build the reusable styling and theming foundation those controls will use later.

Alternative considered:
- Including full customization controls in this ticket was rejected because it would substantially expand scope and mix foundational visual work with persisted product settings.

## Risks / Trade-offs

- [Theme styling could sprawl across components] → Centralize shared tokens and layout primitives in app-level styling files.
- [Persisted theme code could become fragile in tests] → Keep theme state in a small isolated hook/provider and cover default + toggle behavior with focused tests.
- [Future customization may need more tokens than initial styling uses] → Name tokens generically and avoid coupling them to one specific screen or component.
