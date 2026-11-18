import { httpClient } from "../../../services/httpClient";
import { createOutput } from "../../pipelines/services/outputService";
import type { CreateOutputPayload, Output } from "../../pipelines/types/output";
import type { AskCitation, AskPin, AskResponse, AskScope } from "../types/ask";

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

function mapCitation(raw: unknown): AskCitation | null {
  if (!isObject(raw)) return null;
  const id = str(raw.id);
  const outputId = str(raw.outputId);
  const field = str(raw.field);
  if (id === undefined || outputId === undefined || field === undefined) return null;
  const optional = {
    number: num(raw.number),
    date: str(raw.date),
    capturedAt: str(raw.capturedAt),
  };
  const present = Object.fromEntries(Object.entries(optional).filter(([, v]) => v !== undefined));
  return { id, outputId, field, isPct: raw.isPct === true, ...present };
}

function mapPin(raw: unknown): AskPin | null {
  if (!isObject(raw)) return null;
  const pipelineId = str(raw.pipelineId);
  if (pipelineId === undefined || !isObject(raw.request)) return null;
  return { pipelineId, request: raw.request };
}

/** Maps the 200 body through an allow-list: anything else the server might one day add (a model, usage, cost) never reaches state. */
export function mapAskResponse(raw: unknown): AskResponse {
  const body = isObject(raw) ? raw : {};
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  return {
    answer: str(body.answer) ?? "",
    citations: list(body.citations)
      .map(mapCitation)
      .filter((c): c is AskCitation => c !== null),
    citedOutputs: list(body.citedOutputs)
      .filter(isObject)
      .flatMap((o) => {
        const id = str(o.id);
        const name = str(o.name);
        return id !== undefined && name !== undefined ? [{ id, name }] : [];
      }),
    pin: mapPin(body.pin),
  };
}

function askPath(scope: AskScope): string {
  return scope.kind === "dashboard"
    ? `/api/dashboards/${scope.id}/ask`
    : `/api/outputs/${scope.id}/ask`;
}

async function ask(scope: AskScope, question: string): Promise<AskResponse> {
  const response = await httpClient.post<unknown>(askPath(scope), { question });
  return mapAskResponse(response.data);
}

export const askDashboard = (dashboardId: string, question: string): Promise<AskResponse> =>
  ask({ kind: "dashboard", id: dashboardId }, question);

export const askOutput = (outputId: string, question: string): Promise<AskResponse> =>
  ask({ kind: "output", id: outputId }, question);

/** POSTs the server-built pin request, unchanged, to the pipeline's outputs route (the existing create path). */
export function pinInsight(pin: AskPin): Promise<Output> {
  return createOutput(pin.pipelineId, pin.request as unknown as CreateOutputPayload);
}
