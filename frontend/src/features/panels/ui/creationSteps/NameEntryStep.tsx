// Name-entry step of PanelCreationModal — title input, the subtype-specific
// creator fields (metric / chart / image / divider), the submit/back action
// row, and the live preview pane.
//
// The shell owns `selectedType` and `typeConfig` and derives the four
// narrowed per-subtype configs (always non-null so the inputs stay
// controlled). This component is purely presentational: it forwards typing
// + creator changes back to the shell and renders the preview alongside.

import type { FormEvent } from "react";

import { InlineError } from "../../../../shared/chrome/InlineError";
import { TextField } from "../../../../shared/ui/index";
import type {
  ChartTypeConfig,
  DividerTypeConfig,
  ImageTypeConfig,
  MetricTypeConfig,
  PanelType,
  TypeConfig,
} from "../../types/panel";
import { ChartCreatorFields } from "../creators/ChartCreatorFields";
import { DividerCreatorFields } from "../creators/DividerCreatorFields";
import { ImageCreatorFields } from "../creators/ImageCreatorFields";
import { MetricCreatorFields } from "../creators/MetricCreatorFields";
import { PanelCreationPreview } from "../PanelCreationPreview";

interface NameEntryStepProps {
  selectedType: PanelType;
  title: string;
  onTitleChange: (title: string) => void;
  typeConfig: TypeConfig | null;
  metricConfig: MetricTypeConfig;
  chartConfig: ChartTypeConfig;
  imageConfig: ImageTypeConfig;
  dividerConfig: DividerTypeConfig;
  onTypeConfigChange: (config: TypeConfig) => void;
  createError: string | null;
  /** True iff Create panel should be disabled (creating in flight, empty title, or unmet data-binding requirement). */
  submitDisabled: boolean;
  isCreating: boolean;
  onBack: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function NameEntryStep({
  selectedType,
  title,
  onTitleChange,
  typeConfig,
  metricConfig,
  chartConfig,
  imageConfig,
  dividerConfig,
  onTypeConfigChange,
  createError,
  submitDisabled,
  isCreating,
  onBack,
  onSubmit,
}: NameEntryStepProps) {
  return (
    <div className="panel-creation-modal__name-entry">
      <form className="panel-creation-modal__form" onSubmit={onSubmit}>
        <div className="panel-creation-modal__field">
          <label className="panel-creation-modal__label" htmlFor="panel-create-title">
            Panel title
          </label>
          <TextField
            id="panel-create-title"
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Revenue Pulse"
            aria-label="Panel title"
            autoFocus
          />
        </div>

        {/* 2.5 — Per-type config fields rendered below the title input. */}
        {selectedType === "metric" && (
          <MetricCreatorFields config={metricConfig} onChange={onTypeConfigChange} />
        )}
        {selectedType === "chart" && (
          <ChartCreatorFields config={chartConfig} onChange={onTypeConfigChange} />
        )}
        {selectedType === "image" && (
          <ImageCreatorFields config={imageConfig} onChange={onTypeConfigChange} />
        )}
        {selectedType === "divider" && (
          <DividerCreatorFields config={dividerConfig} onChange={onTypeConfigChange} />
        )}

        <InlineError error={createError} />
        <div className="panel-creation-modal__actions">
          <button
            type="button"
            className="panel-creation-modal__btn panel-creation-modal__btn--secondary"
            onClick={onBack}
          >
            Back
          </button>
          <button
            type="submit"
            className="panel-creation-modal__btn panel-creation-modal__btn--primary"
            disabled={submitDisabled}
          >
            {isCreating ? "Creating..." : "Create panel"}
          </button>
        </div>
      </form>
      {/* 2.6 — Pass typeConfig to preview so it reflects entered config live. */}
      <PanelCreationPreview type={selectedType} title={title} typeConfig={typeConfig} />
    </div>
  );
}
