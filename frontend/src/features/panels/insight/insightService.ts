import { httpClient } from "../../../services/httpClient";

/** HEL-1744 D4 -- `GET /api/outputs/:id/insight` and the public `GET /api/dashboards/:d/panels/:p/insight`, folded into one
 *  client shape. The shapes below deliberately declare NO model, token, cost, run-id, digest or trigger field, and each
 *  response is mapped through an allow-list, so those values (which the authenticated read may carry) can never reach
 *  state, however a component is written. */
export interface InsightCitation {
  id: string;
  field: string;
  number?: number;
  date?: string;
  capturedAt?: string;
  isPct: boolean;
  /** Authenticated read only: the cited Output. */
  outputId?: string;
  /** Public read only: a panel on the same dashboard bound to the cited Output, when one exists. */
  panelId?: string;
}

export interface InsightRender {
  markdown: string;
  citations: InsightCitation[];
  /** When the render was stored. */
  renderedAt: string;
}

export interface InsightAttempt {
  /** Kept as the server's string: an unknown value must degrade to the neutral note, not be rejected. */
  status: string;
  createdAt: string;
}

export interface InsightData {
  render: InsightRender | null;
  /** `null` on the public read (it carries no attempt). */
  lastAttempt: InsightAttempt | null;
}

type Raw = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

function mapCitation(raw: Raw): InsightCitation | null {
  const id = str(raw.id);
  const field = str(raw.field);
  if (id === undefined || field === undefined) return null;
  const optional: Partial<InsightCitation> = {
    outputId: str(raw.outputId),
    number: num(raw.number),
    date: str(raw.date),
    capturedAt: str(raw.capturedAt),
    panelId: str(raw.panelId),
  };
  // Only allow-listed keys, and only when present (a missing value is absent, never `undefined`).
  const present = Object.fromEntries(Object.entries(optional).filter(([, v]) => v !== undefined));
  return { id, field, isPct: raw.isPct === true, ...present };
}

function mapRender(raw: unknown, timeKey: "createdAt" | "renderedAt"): InsightRender | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Raw;
  const markdown = str(r.markdown);
  const renderedAt = str(r[timeKey]);
  if (markdown === undefined || renderedAt === undefined) return null;
  const citations = Array.isArray(r.citations)
    ? r.citations
        .map((c) => (typeof c === "object" && c !== null ? mapCitation(c as Raw) : null))
        .filter((c): c is InsightCitation => c !== null)
    : [];
  return { markdown, citations, renderedAt };
}

function mapAttempt(raw: unknown): InsightAttempt | null {
  if (typeof raw !== "object" || raw === null) return null;
  const a = raw as Raw;
  const status = str(a.status);
  const createdAt = str(a.createdAt);
  return status === undefined || createdAt === undefined ? null : { status, createdAt };
}

export async function fetchOutputInsight(outputId: string): Promise<InsightData> {
  const response = await httpClient.get<Raw>(`/api/outputs/${outputId}/insight`);
  return {
    render: mapRender(response.data.render, "createdAt"),
    lastAttempt: mapAttempt(response.data.lastAttempt),
  };
}

export async function fetchPublicPanelInsight(
  dashboardId: string,
  panelId: string,
  token: string,
): Promise<InsightData> {
  const response = await httpClient.get<Raw>(
    `/api/dashboards/${dashboardId}/panels/${panelId}/insight`,
    { params: { token } },
  );
  return { render: mapRender(response.data.render, "renderedAt"), lastAttempt: null };
}
