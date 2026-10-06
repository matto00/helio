import { renderHook, waitFor } from "@testing-library/react";

import { usePublicPanelData } from "./usePublicPanelData";
import * as publicDashboardService from "../../dashboards/services/publicDashboardService";
import { makeOutputPanel } from "../../../test/panelFixtures";

jest.mock("../../dashboards/services/publicDashboardService", () => ({
  fetchPublicOutputMeta: jest.fn(),
  fetchPublicPanelRows: jest.fn(),
}));

const fetchRows = jest.mocked(publicDashboardService.fetchPublicPanelRows);
const fetchMeta = jest.mocked(publicDashboardService.fetchPublicOutputMeta);

describe("usePublicPanelData rowsTruncated (HEL-1277)", () => {
  beforeEach(() => {
    fetchMeta.mockReset().mockResolvedValue({} as never);
  });

  it("fails closed before the first load (total 0 is not 'complete')", () => {
    fetchRows.mockReset().mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => usePublicPanelData(makeOutputPanel(), "d1", "tok"));
    expect(result.current.total).toBe(0);
    expect(result.current.rowsTruncated).toBe(true);
  });

  it("is true when the server total exceeds the loaded page (350 vs 200)", async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ day: `d${i}`, amount: i }));
    fetchRows.mockReset().mockResolvedValue({ items, total: 350 } as never);
    const { result } = renderHook(() => usePublicPanelData(makeOutputPanel(), "d1", "tok"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rowsTruncated).toBe(true);
  });

  it("is false once every row is loaded", async () => {
    const items = [{ day: "Mon", amount: 1 }];
    fetchRows.mockReset().mockResolvedValue({ items, total: 1 } as never);
    const { result } = renderHook(() => usePublicPanelData(makeOutputPanel(), "d1", "tok"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rowsTruncated).toBe(false);
  });
});
