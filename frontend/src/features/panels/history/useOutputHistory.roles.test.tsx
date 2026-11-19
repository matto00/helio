// HEL-1780 D2/D6: the history read follows the panel's read scope, not a role gate. An owner's panel reads the Output route; a
// non-owner's panel hands a per-panel source (the dashboard, no share token) and reads `/api/dashboards/:id/panels/:panelId/history`.
import { renderHook } from "@testing-library/react";

import { fetchOutputHistory, fetchPublicOutputHistory } from "./outputHistoryService";
import { useOutputHistory } from "./useOutputHistory";

jest.mock("./outputHistoryService");

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(fetchOutputHistory).mockResolvedValue({} as never);
  jest.mocked(fetchPublicOutputHistory).mockResolvedValue({} as never);
});

it("an owner's panel reads the Output history route", () => {
  renderHook(() => useOutputHistory("o-own", "p", "pl", undefined, true, null));
  expect(fetchOutputHistory).toHaveBeenCalledWith("o-own");
  expect(fetchPublicOutputHistory).not.toHaveBeenCalled();
});

it("a non-owner's panel reads the per-panel history route with no token and never the Output route", () => {
  renderHook(() =>
    useOutputHistory("o-shared", "p", "pl", { variant: "public", dashboardId: "d" }, true, null),
  );
  expect(fetchPublicOutputHistory).toHaveBeenCalledWith("d", "p", undefined);
  expect(fetchOutputHistory).not.toHaveBeenCalled();
});

it("a share-link viewer still sends its token", () => {
  renderHook(() =>
    useOutputHistory(
      "o-pub",
      "p",
      undefined,
      { variant: "public", dashboardId: "d-token", token: "t" },
      true,
      null,
    ),
  );
  expect(fetchPublicOutputHistory).toHaveBeenCalledWith("d-token", "p", "t");
});
