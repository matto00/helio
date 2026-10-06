import { render, screen, waitFor } from "@testing-library/react";

import * as fanout from "../services/pipelineRunFanout";
import * as service from "./outputHistoryService";
import { resetHistoryCache } from "./outputHistoryCache";
import { makeHistory } from "./historyFixtures";
import { useOutputHistory, type HistorySource } from "./useOutputHistory";

jest.mock("./outputHistoryService", () => ({
  fetchOutputHistory: jest.fn(),
  fetchPublicOutputHistory: jest.fn(),
}));
jest.mock("../services/pipelineRunFanout", () => ({
  subscribeToPipelineTerminal: jest.fn(() => jest.fn()),
}));
const fetchAuth = jest.mocked(service.fetchOutputHistory);
const fetchPublic = jest.mocked(service.fetchPublicOutputHistory);
const subscribe = jest.mocked(fanout.subscribeToPipelineTerminal);

function Probe({ source, enabled = true }: { source?: HistorySource; enabled?: boolean }) {
  const h = useOutputHistory("out-1", "panel-1", "pipe-1", source, enabled, "7d");
  return <span data-testid="v">{h ? String(h.current?.value) : "none"}</span>;
}

beforeEach(() => {
  resetHistoryCache();
  fetchAuth.mockReset().mockResolvedValue(makeHistory());
  fetchPublic.mockReset().mockResolvedValue(makeHistory());
  subscribe.mockClear();
});

describe("useOutputHistory", () => {
  it("two consumers of one Output make one request, and subscribe to pipeline runs", async () => {
    render(
      <>
        <Probe />
        <Probe />
      </>,
    );
    await waitFor(() => expect(screen.getAllByTestId("v")[0]).toHaveTextContent("1204"));
    expect(fetchAuth).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith("pipe-1", expect.any(Function));
  });

  it("public source reads the public route and never subscribes", async () => {
    render(<Probe source={{ variant: "public", dashboardId: "d1", token: "t" }} />);
    await waitFor(() => expect(screen.getByTestId("v")).toHaveTextContent("1204"));
    expect(fetchPublic).toHaveBeenCalledWith("d1", "panel-1", "t");
    expect(fetchAuth).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("fetches nothing when disabled and stays silent on a failed read", async () => {
    const { rerender } = render(<Probe enabled={false} />);
    expect(fetchAuth).not.toHaveBeenCalled();
    fetchAuth.mockRejectedValue(new Error("boom"));
    rerender(<Probe enabled />);
    await waitFor(() => expect(fetchAuth).toHaveBeenCalled());
    expect(screen.getByTestId("v")).toHaveTextContent("none");
  });
});
