// CastFieldsConfig — table of (source field | target type dropdown) rows for the "cast" pipeline op.
// Renders one row per column from the per-step inputSchema provided by the analyze endpoint.
// Renders an empty table when columns is empty (source has no schema yet).
// Selecting "— keep as is —" removes the field from the casts map (passthrough).

export const CAST_TARGET_TYPES = ["string", "integer", "long", "double", "boolean"] as const;

export type CastTargetType = (typeof CAST_TARGET_TYPES)[number];

const KEEP_AS_IS_VALUE = "";
const KEEP_AS_IS_LABEL = "— keep as is —";

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
              <select
                className="pipeline-detail-page__cast-select"
                aria-label={`Target type for ${col}`}
                value={casts[col] ?? KEEP_AS_IS_VALUE}
                onChange={(e) => {
                  onChange(col, e.target.value);
                }}
              >
                <option value={KEEP_AS_IS_VALUE}>{KEEP_AS_IS_LABEL}</option>
                {CAST_TARGET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
