// CastFieldsConfig — table of (source field | target type dropdown) rows for the "cast" pipeline op.
// Renders one row per column from the per-step inputSchema provided by the analyze endpoint.
// Renders an empty table when columns is empty (source has no schema yet).
// Selecting "— keep as is —" removes the field from the casts map (passthrough).

import { Select } from "../../../../shared/ui/index";

// Mirrors the backend's `CastStep.SupportedTargets` (same values, same order); pinned by
// CastFieldsConfig.guard.test.ts. float/double/number are distinct backend synonyms.
export const CAST_TARGET_TYPES = [
  "string",
  "integer",
  "long",
  "float",
  "double",
  "number",
  "boolean",
  "date",
  "timestamp",
] as const;

export type CastTargetType = (typeof CAST_TARGET_TYPES)[number];

const KEEP_AS_IS_VALUE = "";
const KEEP_AS_IS_LABEL = "— keep as is —";

const SUPPORTED_OPTIONS = [
  { value: KEEP_AS_IS_VALUE, label: KEEP_AS_IS_LABEL },
  ...CAST_TARGET_TYPES.map((t) => ({ value: t, label: t })),
];

/** Options for one row. A stored non-empty target outside the supported set (a legacy row) gets one
 *  extra disabled option so the trigger shows the stored value instead of "keep as is"; it is not
 *  selectable and appears on no other row. */
function optionsFor(stored: string | undefined) {
  const unsupported =
    stored && !(CAST_TARGET_TYPES as readonly string[]).includes(stored) ? stored : null;
  return unsupported === null
    ? SUPPORTED_OPTIONS
    : [
        ...SUPPORTED_OPTIONS,
        { value: unsupported, label: `${unsupported} (unsupported)`, disabled: true },
      ];
}

interface CastFieldsConfigProps {
  /** Column names derived from the step's inputSchema (from the analyze response). */
  columns: string[];
  /** Current cast mappings: { sourceField: targetType }. Absent key means keep as-is. */
  casts: Record<string, string>;
  /** Called when the user changes the target type for a field.
   *  Empty string means "remove from casts map" (keep as-is). */
  onChange: (field: string, targetType: string) => void;
}

export function CastFieldsConfig({ columns, casts, onChange }: CastFieldsConfigProps) {
  return (
    <table className="pipeline-detail-page__cast-table" aria-label="Cast fields">
      <thead>
        <tr>
          <th className="pipeline-detail-page__cast-th">Source field</th>
          <th className="pipeline-detail-page__cast-th">Target type</th>
        </tr>
      </thead>
      <tbody>
        {columns.map((col) => (
          <tr key={col} className="pipeline-detail-page__cast-row">
            <td className="pipeline-detail-page__cast-source">{col}</td>
            <td className="pipeline-detail-page__cast-target">
              <Select
                ariaLabel={`Target type for ${col}`}
                value={casts[col] ?? KEEP_AS_IS_VALUE}
                options={optionsFor(casts[col])}
                onChange={(value) => onChange(col, value)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
