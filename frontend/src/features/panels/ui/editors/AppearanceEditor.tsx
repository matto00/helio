import type { Dispatch, SetStateAction } from "react";

import { TextField } from "../../../../shared/ui/index";
import { buildPanelSurface, resolvePanelTextColor } from "../../../../theme/appearance";
import type { Theme } from "../../../../theme/theme";
import type { ChartAppearance } from "../../types/panel";
import { ChartAppearanceEditor } from "./ChartAppearanceEditor";

interface AppearanceEditorProps {
  panelTitle: string;
  /** F-125 — needed to resolve the live-preview swatch through the same
   *  theme-aware blend `PanelCard`/`PanelContent` render with. */
  theme: Theme;
  title: string;
  setTitle: Dispatch<SetStateAction<string>>;
  background: string;
  setBackground: Dispatch<SetStateAction<string>>;
  color: string;
  setColor: Dispatch<SetStateAction<string>>;
  transparency: number;
  setTransparency: Dispatch<SetStateAction<number>>;
  showChartSection: boolean;
  chartAppearance: ChartAppearance;
  setChartAppearance: Dispatch<SetStateAction<ChartAppearance>>;
}

/** Common appearance form section (title, background, text color, transparency
 *  and — for chart panels — the chart appearance sub-form). Extracted from
 *  `PanelDetailModal` so the modal stays under the file-size cap. */
export function AppearanceEditor({
  panelTitle,
  theme,
  title,
  setTitle,
  background,
  setBackground,
  color,
  setColor,
  transparency,
  setTransparency,
  showChartSection,
  chartAppearance,
  setChartAppearance,
}: AppearanceEditorProps) {
  // F-125 — resolve the same blended background/text combo `PanelCard` /
  // `PanelContent` render at view time, so the editor gives a real live
  // preview instead of leaving the user to infer the result from two raw hex
  // inputs (the sibling `DashboardAppearanceEditor` already does this for the
  // dashboard's window/grid background).
  const previewBackground = buildPanelSurface(theme, background, transparency / 100);
  const previewText = resolvePanelTextColor(theme, background, transparency / 100, color);

  return (
    <>
      <h3 className="panel-detail-modal__edit-section-heading">Appearance</h3>

      <div className="panel-detail-modal__data-section">
        <label className="panel-detail-modal__data-label" htmlFor="panel-title">
          Title
        </label>
        <TextField
          id="panel-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Panel title"
        />
      </div>

      <div className="panel-detail-modal__row">
        <label className="panel-detail-modal__field">
          <span>Background</span>
          <input
            type="color"
            value={background}
            onChange={(e) => setBackground(e.target.value)}
            aria-label={`${panelTitle} background color`}
          />
        </label>
        <label className="panel-detail-modal__field">
          <span>Text</span>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            aria-label={`${panelTitle} text color`}
          />
        </label>
      </div>

      <div className="panel-detail-modal__appearance-preview">
        <span className="panel-detail-modal__appearance-preview-label">Preview</span>
        <span
          className="panel-detail-modal__appearance-preview-swatch"
          style={{ backgroundColor: previewBackground, color: previewText }}
          aria-hidden="true"
        >
          Aa
        </span>
      </div>

      <label className="panel-detail-modal__slider">
        <span>Transparency</span>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={transparency}
          onChange={(e) => setTransparency(Number(e.target.value))}
          aria-label={`${panelTitle} transparency`}
        />
        <strong>{transparency}%</strong>
      </label>

      {showChartSection && (
        <ChartAppearanceEditor
          chartAppearance={chartAppearance}
          setChartAppearance={setChartAppearance}
        />
      )}
    </>
  );
}
