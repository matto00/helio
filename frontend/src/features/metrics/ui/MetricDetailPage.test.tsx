// HEL-560 — the delete-confirm affordance calls GET /api/metrics/:id/usage
// when a delete is first initiated and displays the real bound-panel count,
// replacing the previous generic copy. Mirrors `MetricListTable.test.tsx`'s
// mocked-service shape, using `renderWithStore` (Router + Provider) since
// this page is routed via `useParams`.

import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";

import * as metricService from "../services/metricService";
import { renderWithStore } from "../../../test/renderWithStore";
import type { Metric } from "../types/metric";
import { MetricDetailPage } from "./MetricDetailPage";

jest.mock("../services/metricService", () => ({
  fetchMetricById: jest.fn(),
  deleteMetric: jest.fn(),
  fetchMetricUsage: jest.fn(),
}));

const mockedFetchMetricById = metricService.fetchMetricById as jest.MockedFunction<
  typeof metricService.fetchMetricById
>;
const mockedDeleteMetric = metricService.deleteMetric as jest.MockedFunction<
  typeof metricService.deleteMetric
>;
const mockedFetchUsage = metricService.fetchMetricUsage as jest.MockedFunction<
  typeof metricService.fetchMetricUsage
>;

const testMetric: Metric = {
  id: "m-1",
  ownerId: "u-1",
  dataTypeId: "dt-1",
  name: "Total Revenue",
  description: null,
  measureField: "amount",
  aggregation: "sum",
  allowedDimensions: [],
  format: { unit: null, decimals: null, prefix: null, suffix: null },
  deprecated: false,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

// `renderWithStore`'s default MemoryRouter location ("/") doesn't match a
// `:id` param — render inside a real `<Route>` at `/metrics/m-1` so
// `useParams` resolves `id` (mirrors `PipelineDetailPage.test.tsx`'s
// approach); `startDelete`/`handleDelete` both no-op without a resolved id.
function renderPage() {
  return renderWithStore(
    <Routes>
      <Route path="/metrics/:id" element={<MetricDetailPage />} />
    </Routes>,
    {
      dataTypes: { items: [], status: "succeeded" },
      metrics: {
        currentMetric: testMetric,
        currentMetricStatus: "succeeded",
      },
    },
    "/metrics/m-1",
  );
}

beforeEach(() => {
  mockedFetchMetricById.mockReset().mockResolvedValue(testMetric);
  mockedDeleteMetric.mockReset().mockResolvedValue(undefined);
  mockedFetchUsage.mockReset();
});

describe("MetricDetailPage — delete-confirm shows the real usage count (HEL-560)", () => {
  it("fetches and displays the real bound-panel count when delete is initiated", async () => {
    mockedFetchUsage.mockResolvedValueOnce({ metricId: "m-1", count: 2, panels: [] });
    renderPage();
    // MetricDetailPage's own mount effect dispatches fetchMetricById, which
    // synchronously flips currentMetricStatus to "loading" (masking the
    // preloaded "succeeded" state) until the mocked promise resolves —
    // wait for the title to confirm the fetch settled before interacting.
    await screen.findByText("Total Revenue");

    fireEvent.click(screen.getByText("Delete metric"));

    expect(mockedFetchUsage).toHaveBeenCalledWith("m-1");
    await waitFor(() => {
      expect(
        screen.getByText("2 panels bound to this metric will lose their resolved binding."),
      ).toBeInTheDocument();
    });
  });

  it("shows a zero-usage message for an unbound metric", async () => {
    mockedFetchUsage.mockResolvedValueOnce({ metricId: "m-1", count: 0, panels: [] });
    renderPage();
    // MetricDetailPage's own mount effect dispatches fetchMetricById, which
    // synchronously flips currentMetricStatus to "loading" (masking the
    // preloaded "succeeded" state) until the mocked promise resolves —
    // wait for the title to confirm the fetch settled before interacting.
    await screen.findByText("Total Revenue");

    fireEvent.click(screen.getByText("Delete metric"));

    await waitFor(() => {
      expect(screen.getByText("This metric is not bound to any panels.")).toBeInTheDocument();
    });
  });

  it("confirming delete calls deleteMetric after the usage count has loaded", async () => {
    mockedFetchUsage.mockResolvedValueOnce({ metricId: "m-1", count: 1, panels: [] });
    renderPage();
    // MetricDetailPage's own mount effect dispatches fetchMetricById, which
    // synchronously flips currentMetricStatus to "loading" (masking the
    // preloaded "succeeded" state) until the mocked promise resolves —
    // wait for the title to confirm the fetch settled before interacting.
    await screen.findByText("Total Revenue");

    fireEvent.click(screen.getByText("Delete metric"));
    await waitFor(() =>
      screen.getByText("1 panel bound to this metric will lose their resolved binding."),
    );
    fireEvent.click(screen.getByText("Confirm delete"));

    await waitFor(() => {
      expect(mockedDeleteMetric).toHaveBeenCalledWith("m-1");
    });
  });
});
