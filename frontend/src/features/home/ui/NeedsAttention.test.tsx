import { fireEvent, screen, waitFor } from "@testing-library/react";

import { NOW, iso } from "../test/homeFixtures";
import { renderHome } from "../test/renderHome";
import type { HomeAttentionItem } from "../types/homeSummary";
import { NeedsAttention, sortAttention } from "./NeedsAttention";

jest.mock("../../pipelines/services/runToUpdate");
import { runToUpdate } from "../../pipelines/services/runToUpdate";

const runMock = runToUpdate as jest.MockedFunction<typeof runToUpdate>;

function item(overrides: Partial<HomeAttentionItem>): HomeAttentionItem {
  return {
    kind: "failed",
    pipelineId: "p1",
    pipelineName: "news-sports",
    runId: "r1",
    at: iso(-6),
    reason: "source returned 0 rows",
    resolvedAt: null,
    inFlight: false,
    ...overrides,
  };
}

describe("NeedsAttention", () => {
  beforeEach(() => runMock.mockReset());

  it("shows a failed run's error with Open and Retry", () => {
    renderHome(
      <NeedsAttention
        items={[item({})]}
        load="ready"
        now={NOW}
        onRefetch={jest.fn()}
        onRetryLoad={jest.fn()}
      />,
    );
    expect(screen.getByText(/source returned 0 rows/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/pipelines/p1");
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });

  it("submits one run through runToUpdate and refetches once on success", async () => {
    runMock.mockResolvedValue({ ok: true, message: "Run started." });
    const onRefetch = jest.fn();
    renderHome(
      <NeedsAttention
        items={[item({})]}
        load="ready"
        now={NOW}
        onRefetch={onRefetch}
        onRetryLoad={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(onRefetch).toHaveBeenCalledTimes(1));
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledWith("p1");
  });

  it("disables the button and keeps a readable note while a long run is pending", async () => {
    let finish: (value: { ok: boolean; message: string }) => void = () => {};
    runMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderHome(
      <NeedsAttention
        items={[item({})]}
        load="ready"
        now={NOW}
        onRefetch={jest.fn()}
        onRetryLoad={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    const busy = await screen.findByRole("button", { name: "Running…" });
    expect(busy).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("A run is in progress");
    finish({ ok: true, message: "ok" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled());
  });

  it("reports a 429 in plain language with the Retry-After wait and does not refetch", async () => {
    runMock.mockResolvedValue({
      ok: false,
      message: "Too many runs",
      rejected: true,
      retryAfterSeconds: 15,
    });
    const onRefetch = jest.fn();
    renderHome(
      <NeedsAttention
        items={[item({})]}
        load="ready"
        now={NOW}
        onRefetch={onRefetch}
        onRetryLoad={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The run was not started: too many runs right now. Try again in 15 seconds.",
    );
    expect(onRefetch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });

  it("shows 'Running now' instead of Retry when the pipeline has a run in flight", () => {
    renderHome(
      <NeedsAttention
        items={[item({ inFlight: true })]}
        load="ready"
        now={NOW}
        onRefetch={jest.fn()}
        onRetryLoad={jest.fn()}
      />,
    );
    expect(screen.getByText("Running now")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("offers Run now for a missed fire", () => {
    renderHome(
      <NeedsAttention
        items={[item({ kind: "missed", runId: null, reason: null })]}
        load="ready"
        now={NOW}
        onRefetch={jest.fn()}
        onRetryLoad={jest.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Run now" })).toBeInTheDocument();
  });

  it("offers Open only for a stuck run", () => {
    renderHome(
      <NeedsAttention
        items={[item({ kind: "stuck", reason: null, inFlight: true })]}
        load="ready"
        now={NOW}
        onRefetch={jest.fn()}
        onRetryLoad={jest.fn()}
      />,
    );
    expect(screen.getByRole("link", { name: "Open" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("Running now")).not.toBeInTheDocument();
  });

  it("lists resolved failures after unresolved ones, marked resolved, with no Retry", () => {
    const resolved = item({
      pipelineId: "p2",
      pipelineName: "old-one",
      runId: "r2",
      at: iso(-1),
      resolvedAt: iso(-0.5),
    });
    const open = item({});
    expect(sortAttention([resolved, open]).map((i) => i.pipelineId)).toEqual(["p1", "p2"]);
    renderHome(
      <NeedsAttention
        items={[resolved]}
        load="ready"
        now={NOW}
        onRefetch={jest.fn()}
        onRetryLoad={jest.fn()}
      />,
    );
    expect(screen.getByText(/Resolved by a later run/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("says plainly that nothing needs attention", () => {
    renderHome(
      <NeedsAttention
        items={[]}
        load="ready"
        now={NOW}
        onRefetch={jest.fn()}
        onRetryLoad={jest.fn()}
      />,
    );
    expect(screen.getByText("Nothing needs attention.")).toBeInTheDocument();
  });

  it("shows skeleton rows, never the all-clear, while the summary is loading", () => {
    renderHome(
      <NeedsAttention
        items={[]}
        load="loading"
        now={NOW}
        onRefetch={jest.fn()}
        onRetryLoad={jest.fn()}
      />,
    );
    expect(screen.getByRole("status", { name: "Loading needs attention" })).toBeInTheDocument();
    expect(screen.queryByText("Nothing needs attention.")).not.toBeInTheDocument();
  });

  it("offers a retry, never the all-clear, when the summary failed", () => {
    const onRetryLoad = jest.fn();
    renderHome(
      <NeedsAttention
        items={[]}
        load="failed"
        now={NOW}
        onRefetch={jest.fn()}
        onRetryLoad={onRetryLoad}
      />,
    );
    expect(screen.queryByText("Nothing needs attention.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetryLoad).toHaveBeenCalledTimes(1);
  });
});
