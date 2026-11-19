// HEL-1780 D2: a signed-in dashboard grantee reads every per-panel route with NO share token; an empty `token=` would reach
// `authorizeResourceWithSharing` as `Some("")`. Each per-panel service omits the param when the token is absent, and a share
// viewer still sends its token.
import { httpClient } from "../../../services/httpClient";
import { fetchPublicOutputHistory } from "../../panels/history/outputHistoryService";
import { fetchPublicPanelInsight } from "../../panels/insight/insightService";
import { fetchPublicProvenance } from "../../panels/provenance/provenanceService";
import {
  fetchPublicDistinctValues,
  fetchPublicFilterCapabilities,
  fetchPublicPanelRows,
} from "./publicDashboardService";

jest.mock("../../../services/httpClient", () => ({ httpClient: { get: jest.fn() } }));
const get = jest.mocked(httpClient.get);

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({
    data: { items: [], total: 0, offset: 0, limit: 200, columns: [], values: [] },
  });
});

function sentParams(): Record<string, unknown> {
  return (get.mock.calls[0][1] as { params?: Record<string, unknown> } | undefined)?.params ?? {};
}

type Call = () => Promise<unknown>;
const WITHOUT: Array<[string, Call]> = [
  ["rows", () => fetchPublicPanelRows("d", "p", undefined, 0, 50)],
  ["distinct values", () => fetchPublicDistinctValues("d", "p", undefined, "team")],
  ["filter capabilities", () => fetchPublicFilterCapabilities("d", "p")],
  ["history", () => fetchPublicOutputHistory("d", "p")],
  ["insight", () => fetchPublicPanelInsight("d", "p")],
  ["provenance", () => fetchPublicProvenance("d", "p")],
];
const WITH: Array<[string, Call]> = [
  ["rows", () => fetchPublicPanelRows("d", "p", "tok", 0, 50)],
  ["distinct values", () => fetchPublicDistinctValues("d", "p", "tok", "team")],
  ["filter capabilities", () => fetchPublicFilterCapabilities("d", "p", "tok")],
  ["history", () => fetchPublicOutputHistory("d", "p", "tok")],
  ["insight", () => fetchPublicPanelInsight("d", "p", "tok")],
  ["provenance", () => fetchPublicProvenance("d", "p", "tok")],
];

describe("per-panel services and the share token (HEL-1780 D2)", () => {
  it.each(WITHOUT)("%s omits `token` when none is given", async (_name, call) => {
    await call();
    expect("token" in sentParams()).toBe(false);
  });

  it.each(WITH)("%s still sends a share viewer's token", async (_name, call) => {
    await call();
    expect(sentParams().token).toBe("tok");
  });
});
