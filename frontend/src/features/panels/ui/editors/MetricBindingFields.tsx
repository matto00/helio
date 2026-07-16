// HEL-248 — Metric panel's Value + Label/Unit binding block, extracted from
// `BindingEditor` (behavior-preserving) so that file stays under the
// CONTRIBUTING.md 400-line split threshold once the Chart Display wiring is
// added. Purely presentational: `BindingEditor` still owns all state (the
// `MetricValueEditor` field/reduce state and the two `BoundOrLiteralState`
// hooks) and the save/dirty/reset plumbing.

import type { SelectOption } from "../../../../shared/ui/index";
import { BoundOrLiteralField } from "./BoundOrLiteralField";
import { MetricValueEditor } from "./MetricValueEditor";
import type { BoundOrLiteralState } from "./useBoundOrLiteralState";

interface MetricBindingFieldsProps {
  fieldOptions: SelectOption[];
  fieldValue: string;
  onFieldChange: (value: string) => void;
  reduceValue: string;
  onReduceChange: (value: string) => void;
  labelState: BoundOrLiteralState;
  unitState: BoundOrLiteralState;
}

export function MetricBindingFields({
  fieldOptions,
  fieldValue,
  onFieldChange,
  reduceValue,
  onReduceChange,
  labelState,
  unitState,
}: MetricBindingFieldsProps) {
  return (
    <>
      <MetricValueEditor
        fieldOptions={fieldOptions}
        fieldValue={fieldValue}
        onFieldChange={onFieldChange}
        reduceValue={reduceValue}
        onReduceChange={onReduceChange}
      />
      <div className="panel-detail-modal__data-section">
        <span className="panel-detail-modal__data-label">Label &amp; Unit</span>
        <BoundOrLiteralField
          label="Label"
          mode={labelState.mode}
          onModeChange={labelState.setMode}
          fieldOptions={fieldOptions}
          fieldValue={labelState.fieldValue}
          onFieldChange={labelState.setFieldValue}
          literalValue={labelState.literalValue}
          onLiteralChange={labelState.setLiteralValue}
          literalPlaceholder="e.g. Revenue"
        />
        <BoundOrLiteralField
          label="Unit"
          mode={unitState.mode}
          onModeChange={unitState.setMode}
          fieldOptions={fieldOptions}
          fieldValue={unitState.fieldValue}
          onFieldChange={unitState.setFieldValue}
          literalValue={unitState.literalValue}
          onLiteralChange={unitState.setLiteralValue}
          literalPlaceholder="e.g. $, %, ms"
        />
      </div>
    </>
  );
}
