// ConvertFormatConfig — conversion picker + content-field picker + in-place
// overwrite disclosure for the "convertformat" pipeline op (HEL-1109 — see
// design.md Decisions 2/3/7).
//
// The conversion is offered as ONE Select of the four supported pairs, never
// as two independent from/to dropdowns (design.md D2) — that would make 12 of
// 16 combinations expressible, every one a 422 the UI had the information to
// prevent. A legacy/agent-authored step whose persisted pair isn't one of the
// four is preserved as the card's current selection, not coerced.

import type { SchemaField } from "../../types/pipelineStep";
import { Select, TextField } from "../../../../shared/ui/index";
import {
  SUPPORTED_CONVERT_FORMAT_PAIRS,
  type ConvertFormatConfigValue,
} from "../../state/stepNarrowing";

export type { ConvertFormatConfigValue };

const PAIR_LABELS: Record<string, string> = {
  "csv->json": "CSV → JSON",
  "json->csv": "JSON → CSV",
  "text->markdown": "Text → Markdown",
  "markdown->text": "Markdown → Text",
};

function pairKey(from?: string, to?: string): string {
  return `${from ?? ""}->${to ?? ""}`;
}

interface ConvertFormatConfigProps {
  /** Parsed config object from the step's persisted config. */
  config: ConvertFormatConfigValue;
  /** Full schema fields from the analyze endpoint's inputSchema — filtered to
   *  string-body entries for the field dropdown (design.md D7). */
  analyzeSchema: SchemaField[];
  /** Called with the typed config object on any committed change (CS2c-3a). */
  onChange: (newConfig: ConvertFormatConfigValue) => void;
}

export function ConvertFormatConfig({ config, analyzeSchema, onChange }: ConvertFormatConfigProps) {
  const contentFields = analyzeSchema.filter((f) => f.type === "string-body");

  const currentKey = pairKey(config.from, config.to);
  const isSupportedCurrent = SUPPORTED_CONVERT_FORMAT_PAIRS.some(
    ([from, to]) => pairKey(from, to) === currentKey,
  );

  const pairOptions = SUPPORTED_CONVERT_FORMAT_PAIRS.map(([from, to]) => ({
    value: pairKey(from, to),
    label: PAIR_LABELS[pairKey(from, to)],
  }));
  // design.md D2 — a legacy/agent-authored pair outside the four supported
  // ones is preserved and shown as the card's current selection, not
  // silently coerced onto one of the four.
  const options =
    config.from || config.to
      ? isSupportedCurrent
        ? pairOptions
        : [
            ...pairOptions,
            {
              value: currentKey,
              label: `${config.from ?? "?"} → ${config.to ?? "?"} (unsupported)`,
            },
          ]
      : pairOptions;

  function handlePairChange(nextKey: string) {
    if (!isSupportedCurrent && nextKey === currentKey) return; // preserved legacy pair, not re-emitted
    const match = SUPPORTED_CONVERT_FORMAT_PAIRS.find(
      ([from, to]) => pairKey(from, to) === nextKey,
    );
    if (!match) return;
    const [from, to] = match;
    onChange({ ...config, from, to });
  }

  function handleFieldChange(field: string) {
    onChange({ ...config, field });
  }

  function handleOutputFieldChange(outputField: string) {
    onChange({ ...config, outputField: outputField || undefined });
  }

  const destination = config.outputField?.trim() || config.field;
  const isInPlace = !config.outputField?.trim();

  return (
    <div className="pipeline-detail-page__convertformat-config">
      <div className="pipeline-detail-page__compute-field">
        <span className="pipeline-detail-page__compute-label">Conversion</span>
        <Select
          ariaLabel="Format conversion"
          value={currentKey === "->" ? "" : currentKey}
          placeholder="— select a conversion —"
          options={options}
          onChange={handlePairChange}
        />
      </div>

      <div className="pipeline-detail-page__compute-field">
        <span className="pipeline-detail-page__compute-label">Content field</span>
        <Select
          ariaLabel="Content field to convert"
          value={config.field}
          placeholder="— select a string-body field —"
          options={contentFields.map((f) => ({ value: f.name, label: f.name }))}
          onChange={handleFieldChange}
        />
      </div>

      <div className="pipeline-detail-page__compute-field">
        <span className="pipeline-detail-page__compute-label">Destination field (optional)</span>
        <TextField
          placeholder={config.field || "e.g. convertedContent"}
          value={config.outputField ?? ""}
          onChange={(e) => handleOutputFieldChange(e.target.value)}
          onBlur={(e) => handleOutputFieldChange(e.target.value)}
          aria-label="Destination field"
        />
        {config.field && (
          <p className="pipeline-detail-page__compute-fields-hint">
            {isInPlace
              ? `The converted value replaces "${destination}"'s own content in place.`
              : `The converted value is written to a new field, "${destination}".`}
          </p>
        )}
      </div>
    </div>
  );
}
