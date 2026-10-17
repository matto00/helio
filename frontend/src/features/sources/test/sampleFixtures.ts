import type { DataSource, SourceSample } from "../types/dataSource";

export function sample(overrides: Partial<SourceSample> = {}): SourceSample {
  return {
    rows: [{ id: { $int: 1 }, name: "a" }],
    capturedAt: "2026-10-16T12:00:00Z",
    sourceRowCount: 1,
    truncated: false,
    live: false,
    ...overrides,
  };
}

export function ownedSource(id: string, type: DataSource["type"] = "dataset"): DataSource {
  return {
    id,
    name: `Source ${id}`,
    type,
    createdAt: "2026-03-22T00:00:00Z",
    updatedAt: "2026-03-22T00:00:00Z",
    inferredSchema: [],
    config: {},
  } as unknown as DataSource;
}
