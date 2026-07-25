// HEL-399 — useShapeOffering: lazy shape-catalog fetch, gated on `active`
// and a non-empty `PANEL_TYPE_SHAPES` mapping for the current panel type.

import { renderHook, waitFor } from "@testing-library/react";

import { getPipelineShapeCatalog } from "../../pipelines/services/pipelineService";
import type { PipelineShapeCatalogEntry } from "../../pipelines/types/pipelineShape";
import { useShapeOffering } from "./useShapeOffering";

jest.mock("../../pipelines/services/pipelineService", () => ({
  getPipelineShapeCatalog: jest.fn(),
}));

const getPipelineShapeCatalogMock = jest.mocked(getPipelineShapeCatalog);

const catalog: PipelineShapeCatalogEntry[] = [
  {
    id: "single-row",
    label: "Single row",
    description: "Reduces a source to exactly one row.",
    paramsSchema: [],
    outputContract: { rowCount: { kind: "exactly-one" }, fields: [], description: "" },
  },
  {
    id: "passthrough",
    label: "Passthrough",
    description: "No reduction.",
    paramsSchema: [],
    outputContract: { rowCount: { kind: "unbounded" }, fields: [], description: "" },
  },
];

beforeEach(() => {
  jest.clearAllMocks();
});

describe("useShapeOffering", () => {
  it("does not fetch when inactive", () => {
    renderHook(() => useShapeOffering(false, "metric"));
    expect(getPipelineShapeCatalogMock).not.toHaveBeenCalled();
  });

  it("does not fetch for a panel type with no shape mapping", () => {
    renderHook(() => useShapeOffering(true, "text"));
    expect(getPipelineShapeCatalogMock).not.toHaveBeenCalled();
  });

  it("fetches and filters to the mapped ids for metric", async () => {
    getPipelineShapeCatalogMock.mockResolvedValueOnce(catalog);
    const { result } = renderHook(() => useShapeOffering(true, "metric"));

    await waitFor(() => expect(result.current.offeredShapes).toHaveLength(1));
    expect(result.current.offeredShapes[0].id).toBe("single-row");
    expect(result.current.shapeCatalogError).toBeNull();
  });

  it("fetches only once even if re-rendered with the same active state", async () => {
    getPipelineShapeCatalogMock.mockResolvedValueOnce(catalog);
    const { result, rerender } = renderHook(({ active }) => useShapeOffering(active, "metric"), {
      initialProps: { active: true },
    });

    await waitFor(() => expect(result.current.offeredShapes).toHaveLength(1));
    rerender({ active: true });

    expect(getPipelineShapeCatalogMock).toHaveBeenCalledTimes(1);
  });

  it("sets shapeCatalogError when the fetch fails", async () => {
    getPipelineShapeCatalogMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 500, data: { message: "Failed to load shape catalog." } },
    });
    const { result } = renderHook(() => useShapeOffering(true, "metric"));

    await waitFor(() =>
      expect(result.current.shapeCatalogError).toBe("Failed to load shape catalog."),
    );
    expect(result.current.offeredShapes).toEqual([]);
  });
});
