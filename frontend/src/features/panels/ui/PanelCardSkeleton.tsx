import { Skeleton } from "../../../shared/ui/Skeleton";

/**
 * Placeholder for a single dashboard grid card (HEL-528, design.md D10).
 * Reuses `.panel-grid-card`'s real header/body/footer classes (`PanelGrid.css`)
 * so the card's own chrome — padding, border, radius, shadow — matches the
 * resolved `PanelCard` exactly; only the title, body, and footer meta are
 * `Skeleton` placeholders. This component owns none of the card's SIZE or
 * POSITION — those come from the grid item (react-grid-layout / the mobile
 * stack) wrapping it, positioned by the grid's own resolver.
 */
export function PanelCardSkeleton() {
  return (
    <div className="panel-grid-card" aria-hidden="true">
      <div className="panel-grid-card__top">
        <div className="panel-grid-card__title-area">
          <Skeleton variant="line" width="60%" height="1.1em" />
        </div>
      </div>
      <Skeleton variant="block" className="panel-grid-card__body-skeleton" />
      <div className="panel-grid-card__footer">
        <Skeleton variant="line" width="3em" height="0.7em" />
        <Skeleton variant="line" width="6em" height="0.7em" />
      </div>
    </div>
  );
}
