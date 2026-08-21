import { Skeleton } from "../ui/Skeleton";

interface SidebarRowsSkeletonProps {
  /** `flat` — a single-line row (`.dashboard-list__button`'s plain 32px box, most
   *  sidebar sections). `stacked` — the two-line `--stacked` variant used by the
   *  data-types section, whose resolved rows carry a provenance subtitle
   *  (design.md D9). Defaults to `flat`. */
  rowShape?: "flat" | "stacked";
  /** Number of placeholder rows to render. Defaults to 5 — a typical
   *  above-the-fold sidebar section count; the row count itself carries no
   *  no-layout-shift requirement (only the per-row geometry does). */
  count?: number;
  /** Accessible loading name for the region (e.g. `"Loading data sources…"`),
   *  applied directly to the `<ul>` so assistive technology announces one
   *  loading state for the whole list rather than one per placeholder row. */
  ariaLabel: string;
}

/**
 * Initial-load placeholder shared by `SidebarItemList` and `DashboardList`
 * (HEL-528, design.md D3/D4/D9). Renders `<li>`s inside the SAME real
 * `<ul className="dashboard-list__items">` wrapper and `.dashboard-list__button`
 * geometry the resolved rows use, so gap/padding/height/radius are inherited
 * from one stylesheet (`DashboardList.css`) rather than re-guessed here.
 */
export function SidebarRowsSkeleton({
  rowShape = "flat",
  count = 5,
  ariaLabel,
}: SidebarRowsSkeletonProps) {
  return (
    <ul className="dashboard-list__items" aria-label={ariaLabel}>
      {Array.from({ length: count }, (_, index) => (
        <li key={index} className="dashboard-list__item dashboard-list__item--row">
          <div className="dashboard-list__item-row">
            <div
              className={
                rowShape === "stacked"
                  ? "dashboard-list__button dashboard-list__button--stacked"
                  : "dashboard-list__button"
              }
            >
              {/* HEL-528 — deliberately NOT `.dashboard-list__text`/
               * `.dashboard-list__name-group` (the real row's classes): those
               * rely on real TEXT's intrinsic content width to size the flex
               * chain (`.dashboard-list__button` -> `.dashboard-list__text`
               * -> `.dashboard-list__name-group`, none of which sets its own
               * `flex-grow`/width — real text's natural width fills that gap).
               * A purely decorative `width: 100%` Skeleton bar contributes NO
               * intrinsic size, so that whole ancestor chain collapses to
               * 0 width live (confirmed via getComputedStyle probe) — this
               * dedicated wrapper instead explicitly fills the button's
               * available width via `flex: 1; min-width: 0`, matching the
               * real row's resulting geometry without depending on its
               * fragile intrinsic-sizing mechanism. Also carries the same
               * font-size + line-height the real `.dashboard-list__name`/
               * `.dashboard-list__subtitle` text uses (D9's stacked-row
               * height requirement — see the CSS rule for the full "why"),
               * so a purely decorative box reproduces both dimensions a real
               * text line gets for free. */}
              <div className="dashboard-list__skeleton-text">
                <span className="dashboard-list__skeleton-line dashboard-list__skeleton-line--name">
                  <Skeleton variant="line" width="100%" height="0.85em" />
                </span>
                {rowShape === "stacked" ? (
                  <span className="dashboard-list__skeleton-line dashboard-list__skeleton-line--subtitle">
                    <Skeleton variant="line" width="100%" height="0.85em" />
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
