import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";

import { fetchDashboards as fetchDashboardsRequest } from "../../dashboards/services/dashboardService";
import {
  createCsvSource as createCsvSourceRequest,
  createCsvSourceFromUrl as createCsvSourceFromUrlRequest,
  fetchCsvLimits as fetchCsvLimitsRequest,
  fetchSources as fetchSourcesRequest,
  inferFromCsv as inferFromCsvRequest,
} from "../../sources/services/dataSourceService";
import { track } from "../../telemetry/track";
import { renderWithStore } from "../../../test/renderWithStore";
import { buildFirstRunDashboard as buildFirstRunDashboardRequest } from "../services/firstRunService";
import { resetCsvLimitsCache } from "../../sources/utils/csvSourceCreate";
import { FirstRunDropZone } from "./FirstRunDropZone";

jest.mock("../../telemetry/track", () => ({ track: jest.fn() }));
jest.mock("../services/firstRunService", () => ({ buildFirstRunDashboard: jest.fn() }));
jest.mock("../../dashboards/services/dashboardService", () => ({ fetchDashboards: jest.fn() }));
jest.mock("../../sources/services/dataSourceService", () => ({
  createCsvSource: jest.fn(),
  createCsvSourceFromUrl: jest.fn(),
  fetchCsvLimits: jest.fn(),
  fetchSources: jest.fn(),
  inferFromCsv: jest.fn(),
}));

const trackMock = jest.mocked(track);
const buildMock = jest.mocked(buildFirstRunDashboardRequest);
const fetchDashboardsMock = jest.mocked(fetchDashboardsRequest);
const createCsvMock = jest.mocked(createCsvSourceRequest);
const createUrlMock = jest.mocked(createCsvSourceFromUrlRequest);
const fetchSourcesMock = jest.mocked(fetchSourcesRequest);
const fetchLimitsMock = jest.mocked(fetchCsvLimitsRequest);

const LIMIT_BYTES = 15 * 1024 * 1024;
const inferMock = jest.mocked(inferFromCsvRequest);

const result = {
  dashboardId: "dash-new",
  dashboardName: "sales",
  panelCount: 3,
  pipelineId: "pipe-1",
  pipelineName: "sales pipeline",
  sourceId: "src-1",
  sourceName: "sales",
};
const dashboard = {
  id: "dash-new",
  name: "sales",
  meta: { createdBy: "u", createdAt: "2026-01-01T00:00:00Z", lastUpdated: "2026-01-01T00:00:00Z" },
};
const fields = [{ name: "amount", displayName: "Amount", dataType: "float", nullable: false }];

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}</p>;
}

function renderZone(onStepByStep = jest.fn()) {
  return {
    onStepByStep,
    ...renderWithStore(
      <Routes>
        <Route path="/" element={<FirstRunDropZone onStepByStep={onStepByStep} />} />
        <Route path="/dashboards/:id" element={<LocationProbe />} />
      </Routes>,
      { auth: { status: "authenticated" } },
    ),
  };
}

const csvFile = (name = "sales.csv") => new File(["amount\n1\n"], name, { type: "text/csv" });

function chooseFile(file: File) {
  fireEvent.change(screen.getByTestId("first-run-file-input"), { target: { files: [file] } });
}

describe("FirstRunDropZone (HEL-1209)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetCsvLimitsCache();
    fetchLimitsMock.mockResolvedValue({ maxBytes: LIMIT_BYTES, maxRows: 50000, maxCells: 300000 });
    inferMock.mockResolvedValue(fields);
    createCsvMock.mockResolvedValue({ id: "src-1", name: "sales" } as never);
    createUrlMock.mockResolvedValue({ id: "src-1", name: "sales" } as never);
    fetchSourcesMock.mockResolvedValue([]);
    buildMock.mockResolvedValue(result);
    fetchDashboardsMock.mockResolvedValue([dashboard] as never);
  });

  it("drops a file, builds, lands on /dashboards/:id, and emits each telemetry event exactly once", async () => {
    renderZone();
    const target = screen.getByRole("group", { name: "Drop a CSV file here" });

    fireEvent.drop(target, { dataTransfer: { files: [csvFile()] } });

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/dashboards/dash-new"),
    );
    expect(createCsvMock).toHaveBeenCalledTimes(1);
    expect(buildMock).toHaveBeenCalledWith("src-1");
    expect(trackMock.mock.calls).toEqual([
      ["firstrun_file_dropped", { source: "drop" }],
      ["firstrun_dashboard_created", { panelCount: 3 }],
    ]);
  });

  it("uses the shared infer -> force-string -> create path: every field is sent as string", async () => {
    renderZone();
    chooseFile(csvFile());

    await waitFor(() => expect(createCsvMock).toHaveBeenCalled());
    expect(createCsvMock).toHaveBeenCalledWith("sales", expect.any(File), [
      { name: "amount", displayName: "Amount", dataType: "string", nullable: false },
    ]);
  });

  it("treats the file picker as a drop and a pasted link as 'paste'", async () => {
    renderZone();
    fireEvent.change(screen.getByLabelText("Or paste a link to a CSV"), {
      target: { value: "https://example.com/data/sales.csv" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Build from link" }));

    await waitFor(() =>
      expect(createUrlMock).toHaveBeenCalledWith("sales", "https://example.com/data/sales.csv"),
    );
    expect(trackMock).toHaveBeenCalledWith("firstrun_file_dropped", { source: "paste" });
    expect(inferMock).not.toHaveBeenCalled();
  });

  it("never emits first_dashboard_rendered itself", async () => {
    renderZone();
    chooseFile(csvFile());
    await waitFor(() => expect(buildMock).toHaveBeenCalled());
    expect(trackMock.mock.calls.map(([event]) => event)).not.toContain("first_dashboard_rendered");
  });

  it("is operable by keyboard: a real 'Choose a file' button, a labelled link field and a submit button", () => {
    renderZone();

    expect(screen.getByRole("button", { name: "Choose a file" })).toBeEnabled();
    expect(screen.getByLabelText("Or paste a link to a CSV")).toHaveAttribute("type", "url");
    expect(screen.getByRole("button", { name: "Build from link" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Set up step by step" })).toBeEnabled();
    expect(screen.getByTestId("first-run-file-input")).toHaveAttribute("tabindex", "-1");
  });

  it("opens the native picker from the 'Choose a file' button", () => {
    renderZone();
    const clicked = jest.fn();
    screen.getByTestId("first-run-file-input").addEventListener("click", clicked);

    fireEvent.click(screen.getByRole("button", { name: "Choose a file" }));

    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("announces progress through a polite live region", async () => {
    let finishBuild: (value: typeof result) => void = () => {};
    buildMock.mockReturnValue(new Promise((resolve) => (finishBuild = resolve)));
    renderZone();
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");

    chooseFile(csvFile());

    await waitFor(() =>
      expect(status).toHaveTextContent("Building your dashboard and running the pipeline…"),
    );
    await act(async () => finishBuild(result));
  });

  it("announces an unparseable CSV (no columns) as an alert and uploads nothing", async () => {
    inferMock.mockResolvedValue([]);
    renderZone();
    chooseFile(csvFile());

    expect(await screen.findByRole("alert")).toHaveTextContent("no readable columns");
    expect(createCsvMock).not.toHaveBeenCalled();
    expect(trackMock).toHaveBeenCalledWith("firstrun_file_dropped", { source: "drop" });
  });

  it("rejects a file over the backend-reported limit client-side: alert naming it, no Retry, no request", async () => {
    renderZone();
    const big = new File(["x"], "big.csv", { type: "text/csv" });
    Object.defineProperty(big, "size", { value: LIMIT_BYTES + 1 });
    chooseFile(big);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("15 MB");
    expect(within(alert).queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    expect(inferMock).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it("accepts a file exactly at the backend-reported limit", async () => {
    renderZone();
    const edge = new File(["x"], "edge.csv", { type: "text/csv" });
    Object.defineProperty(edge, "size", { value: LIMIT_BYTES });
    chooseFile(edge);
    await waitFor(() => expect(inferMock).toHaveBeenCalled());
  });

  it("derives its pre-check from the fetched limit rather than a built-in number", async () => {
    fetchLimitsMock.mockResolvedValue({ maxBytes: 2 * 1024 * 1024, maxRows: 10, maxCells: 10 });
    renderZone();
    const file = new File(["x"], "mid.csv", { type: "text/csv" });
    Object.defineProperty(file, "size", { value: 3 * 1024 * 1024 });
    chooseFile(file);

    expect(await screen.findByRole("alert")).toHaveTextContent("2 MB");
    expect(inferMock).not.toHaveBeenCalled();
  });

  it("skips the client pre-check when the limits cannot be fetched, leaving the server 413 authoritative", async () => {
    fetchLimitsMock.mockRejectedValue(new Error("offline"));
    renderZone();
    const big = new File(["x"], "big.csv", { type: "text/csv" });
    Object.defineProperty(big, "size", { value: LIMIT_BYTES * 2 });
    chooseFile(big);

    await waitFor(() => expect(inferMock).toHaveBeenCalled());
  });

  it("shows the server's 413 message with no Retry, since repeating cannot succeed", async () => {
    inferMock.mockRejectedValue({
      isAxiosError: true,
      response: { status: 413, data: { message: "CSV is too large: files are limited to 15 MiB" } },
    });
    renderZone();
    chooseFile(csvFile());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("CSV is too large: files are limited to 15 MiB");
    expect(within(alert).queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("falls back to generic too-large copy when a 413 carries no message", async () => {
    inferMock.mockRejectedValue({ isAxiosError: true, response: { status: 413, data: {} } });
    renderZone();
    chooseFile(csvFile());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("too large");
    expect(within(alert).queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("announces an oversized file (413) as an alert", async () => {
    createCsvMock.mockRejectedValue({ isAxiosError: true, response: { status: 413, data: {} } });
    renderZone();
    chooseFile(csvFile());

    expect(await screen.findByRole("alert")).toHaveTextContent("too large");
  });

  it("shows a retry-later message with a Retry when the upload gate answers 429", async () => {
    inferMock.mockRejectedValue({ isAxiosError: true, response: { status: 429, data: {} } });
    renderZone();
    chooseFile(csvFile());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Too many requests");
    expect(within(alert).getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("announces a URL fetch failure (502) as an alert", async () => {
    createUrlMock.mockRejectedValue({ isAxiosError: true, response: { status: 502, data: {} } });
    renderZone();
    fireEvent.change(screen.getByLabelText("Or paste a link to a CSV"), {
      target: { value: "https://example.com/x.csv" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Build from link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't fetch that link");
  });

  it("rejects a non-CSV file client-side with an alert, without any request or event", () => {
    renderZone();
    chooseFile(new File(["x"], "notes.pdf", { type: "application/pdf" }));

    expect(screen.getByRole("alert")).toHaveTextContent("doesn't look like a CSV");
    expect(inferMock).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalled();
  });

  it("retries a failed build against the already-created source, never uploading twice", async () => {
    buildMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 400, data: { message: "The CSV has no data rows" } },
    });
    renderZone();
    chooseFile(csvFile());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The CSV has no data rows");
    fireEvent.click(within(alert).getByRole("button", { name: /retry/i }));

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/dashboards/dash-new"),
    );
    expect(createCsvMock).toHaveBeenCalledTimes(1);
    expect(buildMock).toHaveBeenCalledTimes(2);
    expect(
      trackMock.mock.calls.filter(([event]) => event === "firstrun_file_dropped"),
    ).toHaveLength(1);
  });

  it("offers the step-by-step path", () => {
    const { onStepByStep } = renderZone();
    fireEvent.click(screen.getByRole("button", { name: "Set up step by step" }));
    expect(onStepByStep).toHaveBeenCalledTimes(1);
  });
});
