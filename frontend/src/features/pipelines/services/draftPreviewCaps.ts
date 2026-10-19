import type { DraftPreviewRequest, WireRow } from "../types/draftPreview";

// HEL-1630 design.md D7: the server's request caps, checked before sending so an over-cap request costs no round trip and
// no slot of the endpoint's budget. Each is a hard refusal (413) on the server; keep these in step with
// `DraftPreviewLimits.scala`.
export const DRAFT_PREVIEW_CAPS = {
  bodyBytes: 4 * 1024 * 1024,
  frameRows: 10_000,
  roots: 8,
  lanes: 8,
  sources: 8,
  steps: 50,
  idLength: 64,
} as const;

const encoder = new TextEncoder();

/** The first cap `request` would break, named for the user, or `undefined` when it fits. */
export function findExceededCap(request: DraftPreviewRequest): string | undefined {
  const c = DRAFT_PREVIEW_CAPS;
  const frameOver = (rows: WireRow[]) => rows.length > c.frameRows;
  const lanes = Object.entries(request.lanes ?? {});
  const sources = Object.entries(request.sources ?? {});
  if (request.roots.length > c.roots) return `more than ${c.roots} input frames`;
  if (request.steps.length > c.steps) return `more than ${c.steps} steps`;
  if (lanes.length > c.lanes) return `more than ${c.lanes} lane frames`;
  if (sources.length > c.sources) return `more than ${c.sources} source frames`;
  const ids = [
    ...request.roots.map((r) => r.id),
    ...request.steps.map((s) => s.id),
    ...lanes.map(([id]) => id),
    ...sources.map(([id]) => id),
  ];
  if (ids.some((id) => id.length > c.idLength)) return `an id longer than ${c.idLength} characters`;
  if (
    request.roots.some((r) => frameOver(r.rows)) ||
    lanes.some(([, f]) => frameOver(f.rows)) ||
    sources.some(([, s]) => frameOver(s.rows))
  )
    return `a frame of more than ${c.frameRows} rows`;
  if (encoder.encode(JSON.stringify(request)).length > c.bodyBytes)
    return `a request body over ${c.bodyBytes} bytes`;
  return undefined;
}
