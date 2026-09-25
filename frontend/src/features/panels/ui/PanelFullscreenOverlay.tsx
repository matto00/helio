import "./PanelFullscreenOverlay.css";
import { Modal } from "../../../shared/ui/Modal";
import { PanelContent } from "./PanelContent";
import type { PanelDataResult } from "../hooks/usePanelData";
import type { Panel } from "../types/panel";

export interface PanelFullscreenOverlayProps extends Omit<PanelDataResult, "isRefreshing"> {
  panel: Panel;
  open: boolean;
  onClose: () => void;
}

/**
 * HEL-584 — a maximized, view-only rendering of a single panel's content,
 * opened from `PanelCard`'s header Fullscreen control.
 *
 * Mounted unconditionally by `PanelCard` (matching `QuickLauncherOverlay`'s
 * always-mounted-with-a-toggled-`open`-prop precedent, not
 * `PanelDetailModal`'s conditionally-mounted one — that component has no
 * `panel` to render at all when nothing is selected, which doesn't apply
 * here). `Modal` always renders its header (title/description) regardless
 * of the native `open` attribute, but this component gates its OWN body
 * (`PanelContent` — the expensive part: a chart panel instantiates a real
 * ECharts instance) on `open` so a closed overlay never pays for a second,
 * hidden render of a panel's content, and so Modal's own `[open]` effect
 * (showModal()/close() + focus-capture/restore) sees a real, toggling
 * `open` prop instead of a component that only ever mounts already-open —
 * unmounting instead of toggling would skip that effect's close-time
 * "else" branch (where the focus restore lives) entirely.
 *
 * design.md Decision 1: wraps the shared `Modal` primitive (`size="full"`)
 * rather than forking a bespoke full-viewport overlay — reuses Modal's
 * opaque surface, backdrop, single entrance animation, native focus trap,
 * `Esc`-close, and focus restore unmodified. `className="panel-fullscreen-
 * overlay"` (Decision 1a) gives the dialog a definite height, since Modal's
 * own `size="full"` preset is width-only and would otherwise shrink-to-fit
 * its content — see that CSS file's own comment.
 *
 * design.md Decision 2: receives the SAME `PanelDataResult` fields
 * `PanelCardBody` takes, as props from the caller's existing
 * `usePanelData` result — never calls that hook itself, so opening
 * fullscreen can never race HEL-579's in-flight refresh guard with a second,
 * independent fetch instance for the same panel.
 *
 * Renders `PanelContent` unmodified (no forked chart/table/markdown
 * rendering) — the fullscreen render always matches the card.
 */
export function PanelFullscreenOverlay({
  panel,
  open,
  onClose,
  data,
  rawRows,
  headers,
  isLoading,
  error,
  errorKind,
  noData,
  neverMaterialized,
  chartAggregate,
  rowsTruncated,
  refresh,
}: PanelFullscreenOverlayProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="full"
      className="panel-fullscreen-overlay"
      title={panel.title}
      description={<span className="eyebrow">{panel.type}</span>}
      ariaLabel={`${panel.title} fullscreen`}
    >
      {/* Gated on `open` — see this component's own doc comment for why:
          Modal renders `children` into the DOM regardless of its native
          `open` attribute, so an ungated `PanelContent` here would
          instantiate a second, hidden chart-panel/ECharts instance per
          dashboard panel at all times, not only while the overlay is
          actually open. */}
      {open && (
        <div className="panel-fullscreen-overlay__body">
          <PanelContent
            panel={panel}
            data={data}
            rawRows={rawRows}
            headers={headers}
            isLoading={isLoading}
            error={error}
            errorKind={errorKind}
            onRetry={refresh}
            retryVariant="button"
            noData={noData}
            neverMaterialized={neverMaterialized}
            chartAggregate={chartAggregate}
            rowsTruncated={rowsTruncated}
          />
        </div>
      )}
    </Modal>
  );
}
