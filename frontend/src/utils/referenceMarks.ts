// HEL-1306 -- the chart Output's `referenceLines` / `referenceBands` config: static target values drawn on
// the chart's value axis. One echarts-free module shared by the renderer's config read and the Output editor
// (so the editor does not pull the lazy chart chunk). The caps, label limit and tone vocabulary mirror
// `ChartReferenceMarks.scala`; `referenceMarks.guard.test.ts` pins them (and the three Output request schemas)
// to `shared-test-fixtures/chart-reference-marks.json`.

export const REFERENCE_TONES = ["neutral", "success", "warning", "error"] as const;
export type ReferenceTone = (typeof REFERENCE_TONES)[number];

export const MAX_REFERENCE_LINES = 5;
export const MAX_REFERENCE_BANDS = 3;
export const MAX_REFERENCE_LABEL = 60;

export interface ReferenceLine {
  value: number;
  label?: string;
  tone?: ReferenceTone;
}

export interface ReferenceBand {
  from: number;
  to: number;
  label?: string;
  tone?: ReferenceTone;
}

export interface ReferenceMarks {
  lines: ReferenceLine[];
  bands: ReferenceBand[];
}

export function isReferenceTone(value: unknown): value is ReferenceTone {
  return typeof value === "string" && (REFERENCE_TONES as readonly string[]).includes(value);
}

/** The server's label rule: 1 to 60 characters with at least one non-whitespace character. */
export function isValidReferenceLabel(label: string): boolean {
  // Code points, not UTF-16 units: JSON Schema `maxLength` and the backend validator count code points too.
  const length = [...label].length;
  return length >= 1 && length <= MAX_REFERENCE_LABEL && label.trim().length > 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** The optional `label` / `tone` of a stored item, or `null` when either is present but invalid. */
function readCommon(
  item: Record<string, unknown>,
): { label?: string; tone?: ReferenceTone } | null {
  const out: { label?: string; tone?: ReferenceTone } = {};
  if (item.label !== undefined) {
    if (typeof item.label !== "string" || !isValidReferenceLabel(item.label)) return null;
    out.label = item.label;
  }
  if (item.tone !== undefined) {
    if (!isReferenceTone(item.tone)) return null;
    out.tone = item.tone;
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Tolerant read of stored config (legacy or hand-written data must never throw in the renderer or the
 *  editor): a non-array reads as none, an invalid item is dropped, and a list over its cap is truncated. */
export function sanitizeReferenceMarks(lines: unknown, bands: unknown): ReferenceMarks {
  const outLines: ReferenceLine[] = [];
  if (Array.isArray(lines)) {
    for (const raw of lines) {
      const item = asRecord(raw);
      if (!item || !finiteNumber(item.value)) continue;
      const common = readCommon(item);
      if (common) outLines.push({ value: item.value, ...common });
    }
  }
  const outBands: ReferenceBand[] = [];
  if (Array.isArray(bands)) {
    for (const raw of bands) {
      const item = asRecord(raw);
      if (!item || !finiteNumber(item.from) || !finiteNumber(item.to) || item.from >= item.to) {
        continue;
      }
      const common = readCommon(item);
      if (common) outBands.push({ from: item.from, to: item.to, ...common });
    }
  }
  return {
    lines: outLines.slice(0, MAX_REFERENCE_LINES),
    bands: outBands.slice(0, MAX_REFERENCE_BANDS),
  };
}
