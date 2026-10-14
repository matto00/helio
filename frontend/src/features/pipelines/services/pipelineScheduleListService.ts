import { httpClient } from "../../../services/httpClient";
import type { PipelineScheduleList } from "../types/pipelineSchedule";

/** `GET /api/pipeline-schedules` (HEL-1574): the caller's enabled schedules plus the sources feeding them. Always
 *  one request, whatever the number of pipelines and sources. spray-json omits null `nextRunAt`/`lastRunAt`, so
 *  they are normalized to `null` here. */
export async function fetchPipelineScheduleList(): Promise<PipelineScheduleList> {
  const response = await httpClient.get<{
    items: Array<Record<string, unknown>>;
    sources: Array<Record<string, unknown>>;
  }>("/api/pipeline-schedules");
  const data = response.data;
  return {
    items: data.items.map((i) => ({
      ...(i as unknown as PipelineScheduleList["items"][number]),
      nextRunAt: (i.nextRunAt as string | undefined) ?? null,
      lastRunAt: (i.lastRunAt as string | undefined) ?? null,
    })),
    sources: data.sources.map((s) => ({
      ...(s as unknown as PipelineScheduleList["sources"][number]),
      nextRunAt: (s.nextRunAt as string | undefined) ?? null,
    })),
  };
}
