import type { DashboardLayout, DashboardLayoutItem } from "../../dashboards/types/dashboard";

const MIN_COLUMNS = 12;

/** The saved layout to draw: the large breakpoint, falling back to medium, small, then extra small. */
export function thumbnailItems(layout: DashboardLayout): DashboardLayoutItem[] {
  return [layout.lg, layout.md, layout.sm, layout.xs].find((items) => items.length > 0) ?? [];
}

/** Panel boxes from the saved layout, scaled into a fixed-aspect well. No live data, no panel contents. */
export function LayoutThumbnail({ layout }: { layout: DashboardLayout }) {
  const items = thumbnailItems(layout);
  if (items.length === 0) {
    return <div className="home-thumb home-thumb--empty">No panels yet</div>;
  }
  const columns = Math.max(MIN_COLUMNS, ...items.map((item) => item.x + item.w));
  const rows = Math.max(1, ...items.map((item) => item.y + item.h));
  return (
    <div className="home-thumb" aria-hidden="true">
      {items.map((item) => (
        <span
          key={item.panelId}
          className="home-thumb__box"
          style={{
            left: `${(item.x / columns) * 100}%`,
            top: `${(item.y / rows) * 100}%`,
            width: `${(item.w / columns) * 100}%`,
            height: `${(item.h / rows) * 100}%`,
          }}
        />
      ))}
    </div>
  );
}
