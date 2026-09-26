import "./CrossFilterIndicator.css";
import { IconButton } from "../../../shared/ui/IconButton";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { clearCrossFilter } from "../state/panelsSlice";

/** HEL-588 design.md D6 / tasks.md 4.1-4.3 — the dashboard-level "Filtered
 *  by {dimension} = {value}" indicator, the ONLY way to clear an active
 *  cross-filter besides panel deletion or dashboard switch (spec.md). Self-
 *  gates on `crossFilter !== null` (renders nothing otherwise) so `PanelList`
 *  can mount it unconditionally. `role="status"`/`aria-live="polite"`
 *  (matches `PipelineDetailFooter`'s identical explicit pairing) so a
 *  set/replace/clear is announced to assistive technology, per spec.md's
 *  own scenario. */
export function CrossFilterIndicator() {
  const dispatch = useAppDispatch();
  const crossFilter = useAppSelector((state) => state.panels.crossFilter);

  if (!crossFilter) return null;

  return (
    <div className="cross-filter-indicator" role="status" aria-live="polite">
      <span className="cross-filter-indicator__text">
        Filtered by {crossFilter.dimension} ={" "}
        <span className="mono cross-filter-indicator__value">{crossFilter.value}</span>
      </span>
      <IconButton
        icon="×"
        variant="ghost"
        size="xs"
        aria-label="Clear cross-filter"
        onClick={() => dispatch(clearCrossFilter())}
      />
    </div>
  );
}
