// Pipeline step catalog wire types (HEL-1136). Mirrors the backend's
// `com.helio.services.pipelines.PipelineStepCatalog` / `PipelineStepCatalogProtocol` shapes
// directly — see `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepCatalogProtocol.scala`.

/** One declared step group, in the catalog's declared display order. */
export interface StepGroupEntry {
  id: string;
  label: string;
}

/** One `GET /api/pipeline-step-catalog` step entry. `group` is `group?: string` (not
 *  `group: string | null`) — design.md Decision 4: spray-json DROPS a `None` field entirely
 *  rather than writing `null`, so "ungrouped" is `group === undefined`, never `group === null`. */
export interface PipelineStepCatalogEntry {
  kind: string;
  label: string;
  description: string;
  group?: string;
  authorable: boolean;
}

/** `GET /api/pipeline-step-catalog`'s full response shape — `groups` and `steps` are ORDERED
 *  ARRAYS (design.md Decision 3): nothing order-bearing may be inferred from object-key order. */
export interface PipelineStepCatalog {
  groups: StepGroupEntry[];
  steps: PipelineStepCatalogEntry[];
}
