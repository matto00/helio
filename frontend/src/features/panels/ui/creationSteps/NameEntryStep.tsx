// Name-entry step of PanelCreationModal — title input, the subtype-specific
// creator fields (metric / chart / image), the submit/back action
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
  ImageTypeConfig,
  MetricTypeConfig,
  PanelType,
  TypeConfig,
} from "../../types/panel";
import { ChartCreatorFields } from "../creators/ChartCreatorFields";
import { ImageCreatorFields } from "../creators/ImageCreatorFields";
import { MetricCreatorFields } from "../creators/MetricCreatorFields";
import { PanelCreationPreview } from "../PanelCreationPreview";

// F-211 — a distinct example per type, instead of "Revenue Pulse" showing on
// every type regardless of fit (odd on, say, Timeline or Image).
const TITLE_PLACEHOLDER: Record<PanelType, string> = {
  metric: "Revenue Pulse",
  chart: "Revenue by Region",
  text: "Section Header",
  table: "Recent Orders",
  markdown: "Release Notes",
  image: "Team Photo",
  collection: "Top Accounts",
  timeline: "Deployment History",
  divider: "",
};

interface NameEntryStepProps {
  selectedType: PanelType;
  title: string;
  onTitleChange: (title: string) => void;
  typeConfig: TypeConfig | null;
  metricConfig: MetricTypeConfig;
  chartConfig: ChartTypeConfig;
  imageConfig: ImageTypeConfig;
  onTypeConfigChange: (config: TypeConfig) => void;
  /** F-035 — the DataType bound on datatype-select (or via the shape flow),
   *  if any, so the preview can render the real bound state instead of
   *  guessing from `typeConfig` alone. Null for unbound/non-data-bound types. */
  dataTypeId: string | null;
  /** Resolved display name for `dataTypeId`, looked up by the shell. */
  dataTypeName: string | null;
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
  onTypeConfigChange,
  dataTypeId,
  dataTypeName,
  createError,
  submitDisabled,
  isCreating,
  onBack,
  onSubmit,
}: NameEntryStepProps) {
  return (
    <div className="panel-creation-modal__name-entry">
      {/* F-112 — `noValidate`: no field here still uses `type="url"` (see
          `ImageCreatorFields`), so no native constraint-validation bubble
          fires today, but this is defense-in-depth against a future field
          silently reintroducing one; validation/errors are the existing
          `InlineError` below instead. */}
      <form className="panel-creation-modal__form" onSubmit={onSubmit} noValidate>
        <div className="panel-creation-modal__field">
          <label className="panel-creation-modal__label" htmlFor="panel-create-title">
            Panel title
          </label>
          <TextField
            id="panel-create-title"
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder={TITLE_PLACEHOLDER[selectedType]}
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
      {/* 2.6 / F-035 — Pass typeConfig and the resolved binding so the
          preview reflects entered config and the real bound state live. */}
      <PanelCreationPreview
        type={selectedType}
        title={title}
        typeConfig={typeConfig}
        dataTypeId={dataTypeId}
        dataTypeName={dataTypeName}
      />
    </div>
  );
}
