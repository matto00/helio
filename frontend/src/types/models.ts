// Cross-cutting frontend types — single survivor of CS4 cycle 1's
// `models.ts` decomposition.
//
// All domain-owned types have moved to their feature folder's `types/`
// (`features/auth/types/user.ts`, `features/dashboards/types/dashboard.ts`,
// `features/dataTypes/types/dataType.ts`,
// `features/panels/types/panel.ts`,
// `features/pipelines/types/pipelineStep.ts`,
// `features/sources/types/dataSource.ts`). Per design D7, this file is
// kept as the home for genuinely cross-cutting types — currently only
// `ResourceMeta`, which mirrors the backend `ResourceMeta` value class
// and is reused across every persistent-entity wire shape (dashboards,
// panels, etc.).

export interface ResourceMeta {
  createdBy: string;
  createdAt: string;
  lastUpdated: string;
}

/** Paginated list envelope returned by all four GET-list endpoints.
 *
 *  Mirrors the backend `PagedResult[A]` wire shape. The `items` array holds
 *  the current page; `total` is the full row count so callers can decide
 *  whether to request another page. `offset` and `limit` echo the request
 *  params so consumers don't need to remember them. */
export interface PagedResult<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}
