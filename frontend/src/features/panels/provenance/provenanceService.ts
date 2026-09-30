import { httpClient } from "../../../services/httpClient";

/** HEL-1207 — `GET /api/outputs/:id/provenance` and the public
 *  `GET /api/dashboards/:dashboardId/panels/:panelId/provenance` (HEL-1206), folded into ONE
 *  client shape. The public variant structurally has no ids and no `rootBound`, so those fields
 *  are optional here and the popover never renders them for the `public` variant. */
export interface ProvenanceSource {
  id?: string;
  name: string;
  kind: string;
}

export interface ProvenanceLastRun {
  status: string;
  completedAt: string | null;
  /** `null` for BOTH an empty and an absent snapshot (backend cannot tell them apart). */
  rowCount: number | null;
}

export interface ProvenanceAssertions {
  defined: boolean;
  passed: number;
  failed: number;
  warned: number;
  rootBound?: boolean;
}

export interface Provenance {
  outputId?: string;
  pipeline: { id?: string; name: string };
  sources: ProvenanceSource[];
  /** Step kinds, trunk-first; EMPTY for a root-bound output. */
  nodePath: string[];
  /** Explicit `null` when the pipeline has never run. */
  lastRun: ProvenanceLastRun | null;
  assertions: ProvenanceAssertions;
}

export async function fetchOutputProvenance(outputId: string): Promise<Provenance> {
  const response = await httpClient.get<Provenance>(`/api/outputs/${outputId}/provenance`);
  return response.data;
}

export async function fetchPublicProvenance(
  dashboardId: string,
  panelId: string,
  token: string,
): Promise<Provenance> {
  const response = await httpClient.get<Provenance>(
    `/api/dashboards/${dashboardId}/panels/${panelId}/provenance`,
    { params: { token } },
  );
  return response.data;
}
