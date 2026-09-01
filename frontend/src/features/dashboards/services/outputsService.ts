// Minimal Output list fetch for the Proposal Review UI's demo-fixture path
// and dataTypeId→name binding-resolution (HEL-907 task 4.1 — retargets the
// review page off the retired DataType model onto Outputs). Deliberately
// narrow: just the fields this page needs (`id`/`name`), not a full Outputs
// feature/slice — the broader `dataTypes`/`panels`/`sources`/`metrics`
// frontend migration onto Outputs is tracked separately (HEL-936).

import type { PagedResult } from "../../../types/models";
import { httpClient } from "../../../services/httpClient";

export interface OutputSummary {
  id: string;
  name: string;
}

/** `GET /api/outputs` (HEL-906 cycle 7) — every Output the caller owns,
 *  across every pipeline. Paginated; fetches every page (mirrors
 *  `helio-mcp/src/context.ts`'s own `fetchAllOutputs` precedent) so a
 *  workspace with more than one page's worth of Outputs still resolves every
 *  binding correctly. */
export async function fetchOutputs(): Promise<OutputSummary[]> {
  const items: OutputSummary[] = [];
  let offset = 0;
  const limit = 200;
  const maxPages = 50; // 10,000 Outputs — far beyond any real workspace
  for (let page = 0; page < maxPages; page++) {
    const response = await httpClient.get<PagedResult<OutputSummary>>("/api/outputs", {
      params: { offset, limit },
    });
    items.push(...response.data.items);
    if (items.length >= response.data.total || response.data.items.length === 0) break;
    offset += limit;
  }
  return items;
}
