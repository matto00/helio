// HEL-1306 -- the Output editor's reference-mark rows as the author types them (strings), and the pure
// conversion to the validated `ReferenceLine` / `ReferenceBand` values `buildOutputConfig` emits. An
// invalid draft is reported, never converted, so the editor can only save what the server accepts.

import {
  isValidReferenceLabel,
  MAX_REFERENCE_LABEL,
  type ReferenceBand,
  type ReferenceLine,
  type ReferenceMarks,
  type ReferenceTone,
} from "../../../../utils/referenceMarks";

export interface LineDraft {
  value: string;
  label: string;
  tone: ReferenceTone;
}

export interface BandDraft {
  from: string;
  to: string;
  label: string;
  tone: ReferenceTone;
}

export type MarkProblem = "number" | "order" | "label";

const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** A finite number from the draft text; `undefined` for empty, non-numeric or out-of-range (`1e400`). */
export function parseDraftNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (!DECIMAL.test(trimmed)) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/** The trimmed label to emit (`undefined` when empty), or `"invalid"` when it breaks the server's rule. */
function parseDraftLabel(text: string): string | undefined | "invalid" {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  return isValidReferenceLabel(trimmed) ? trimmed : "invalid";
}

export function lineDraftProblem(draft: LineDraft): MarkProblem | null {
  if (parseDraftNumber(draft.value) === undefined) return "number";
  return parseDraftLabel(draft.label) === "invalid" ? "label" : null;
}

export function bandDraftProblem(draft: BandDraft): MarkProblem | null {
  const from = parseDraftNumber(draft.from);
  const to = parseDraftNumber(draft.to);
  if (from === undefined || to === undefined) return "number";
  if (from >= to) return "order";
  return parseDraftLabel(draft.label) === "invalid" ? "label" : null;
}

function common(label: string, tone: ReferenceTone): { label?: string; tone?: ReferenceTone } {
  const trimmed = label.trim();
  return {
    ...(trimmed !== "" ? { label: trimmed } : {}),
    // `neutral` is the default, so it is not written.
    ...(tone !== "neutral" ? { tone } : {}),
  };
}

/** `null` when any row is invalid (the caller keeps the previous committed value and blocks Save). */
export function draftsToMarks(lines: LineDraft[], bands: BandDraft[]): ReferenceMarks | null {
  if (lines.some((l) => lineDraftProblem(l)) || bands.some((b) => bandDraftProblem(b))) return null;
  return {
    lines: lines.map((l) => ({
      value: parseDraftNumber(l.value) as number,
      ...common(l.label, l.tone),
    })),
    bands: bands.map((b) => ({
      from: parseDraftNumber(b.from) as number,
      to: parseDraftNumber(b.to) as number,
      ...common(b.label, b.tone),
    })),
  };
}

export function lineToDraft(line: ReferenceLine): LineDraft {
  return { value: String(line.value), label: line.label ?? "", tone: line.tone ?? "neutral" };
}

export function bandToDraft(band: ReferenceBand): BandDraft {
  return {
    from: String(band.from),
    to: String(band.to),
    label: band.label ?? "",
    tone: band.tone ?? "neutral",
  };
}

export const LABEL_LIMIT = MAX_REFERENCE_LABEL;

/** What `buildOutputConfig` writes for a list: the normalized array, or `null` for none (a shallow-merge
 *  PATCH keeps an omitted key, so a clear must be an explicit `null`). */
export function marksOrNull<T extends { label?: string; tone?: ReferenceTone }>(
  items: T[],
): T[] | null {
  if (items.length === 0) return null;
  return items.map((item) => {
    const { tone, ...rest } = item;
    return (tone && tone !== "neutral" ? { ...rest, tone } : rest) as T;
  });
}
