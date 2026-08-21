import { Skeleton } from "./Skeleton";

/**
 * Initial-load placeholder for a page shell's main content area (HEL-528,
 * design.md D3/D11) — `SourcesPage`, `PipelinesPage`, `TypeRegistryPage`.
 * These pages resolve into one of two very different shapes (a detail panel
 * for a selected item, or `EmptyState`'s `main` hero when the list turns out
 * to be empty) that can't be told apart before the fetch resolves, so this
 * deliberately does not try to shape-match either — it reuses `EmptyState`
 * `main`'s own wrapper class (`ui-empty-state--main`, `EmptyState.css`) so
 * the container inherits that variant's real `min-height: 320px` floor, the
 * exact number the inherited HEL-539 331px→15px collapse this replaces
 * measures against. The icon slot goes one step further and reuses
 * `EmptyState`'s own `ui-empty-state__icon-wrap` box (`EmptyState.css:20-21`)
 * rather than a same-guessed `64`/`64` literal on the `Skeleton` itself — the
 * D3 "reuse the real wrapper, don't re-guess it" rule this ticket applies
 * everywhere else, which also fixes a shape mismatch a literal size alone
 * would not: the wrap is a rounded *square* (`--app-radius-lg`), not the
 * circle a bare `variant="circle"` would paint.
 */
export function PageContentSkeleton() {
  return (
    <div className="ui-empty-state ui-empty-state--main" aria-label="Loading">
      <div className="ui-empty-state__icon-wrap" aria-hidden="true">
        <Skeleton variant="block" width="100%" height="100%" />
      </div>
      <Skeleton variant="line" width="12em" height="1.5em" />
      <Skeleton variant="line" width="20em" />
    </div>
  );
}
