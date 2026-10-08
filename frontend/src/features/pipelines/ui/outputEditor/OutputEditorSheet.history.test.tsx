// HEL-1331 -- the Output editor's History section: the "Keep each run's rows" switch, what an edit
// Save sends for `config.historyPayloads` (D5), and the disabled-with-upsell state (Q1/Q3).

import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { httpClient } from "../../../../services/httpClient";
import { authReducer } from "../../../auth/state/authSlice";
import { outputsReducer } from "../../state/outputsSlice";
import { OutputEditorSheet } from "./OutputEditorSheet";
import type { UserTier } from "../../../auth/types/user";
import type { HistoryPayloadLimits, Output } from "../../types/output";

jest.mock("../../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
const http = jest.mocked(httpClient);

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  jest.clearAllMocks();
  http.get.mockImplementation((url: string) =>
    url.endsWith("/panels")
      ? Promise.resolve({ data: [] })
      : Promise.resolve({
          data: {
            columns: [{ name: "amount", dataType: "number", nullable: false }],
            capabilities: {},
            rows: [],
            rowCount: 0,
            stepRowCounts: {},
            sourceRowCount: 0,
            blocked: false,
            sourceTruncated: false,
            truncatedReads: [],
          },
        }),
  );
  http.patch.mockResolvedValue({
    data: { id: "o-1", pipelineId: "p-1", kind: "metric", name: "n", config: {}, schema: [] },
  });
});

const METRIC = { fieldMapping: {}, aggregation: { value: "amount", agg: "sum" } };

const DEFAULT_LIMITS: HistoryPayloadLimits = {
  maxRows: 1000,
  maxBytes: 1048576,
  tiers: {
    free: { maxRuns: 0, maxAgeDays: 0 },
    beta: { maxRuns: 10, maxAgeDays: 7 },
    owner: { maxRuns: 30, maxAgeDays: 30 },
  },
};

function outputOf(
  config: Record<string, unknown>,
  available?: boolean,
  limits: HistoryPayloadLimits | null = DEFAULT_LIMITS,
): Output {
  return {
    id: "o-1",
    pipelineId: "p-1",
    nodeStepId: "step-1",
    ownerId: "u-1",
    name: "Revenue",
    kind: "metric",
    config,
    schema: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...(available === undefined ? {} : { historyPayloadsAvailable: available }),
    ...(limits === null ? {} : { historyPayloadLimits: limits }),
  };
}

function renderSheet(output: Output | null, tier: UserTier = "free") {
  const initial = authReducer(undefined, { type: "init" });
  const store = configureStore({
    reducer: { outputs: outputsReducer, auth: authReducer },
    preloadedState: {
      outputs: outputsReducer(undefined, { type: "init" }),
      auth: {
        ...initial,
        currentUser: {
          id: "u-1",
          email: "u@test.local",
          displayName: null,
          avatarUrl: null,
          createdAt: "2026-01-01T00:00:00Z",
          tier,
        },
      },
    },
  });
  render(
    <MemoryRouter>
      <Provider store={store}>
        <OutputEditorSheet
          open
          onClose={jest.fn()}
          pipelineId="p-1"
          output={output}
          createTargetStepId="step-1"
          steps={[]}
        />
      </Provider>
    </MemoryRouter>,
  );
}

async function save(): Promise<Record<string, unknown>> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^(Save|Create)/ }));
  });
  await waitFor(() => expect(http.patch).toHaveBeenCalled());
  return (http.patch.mock.calls[0][1] as { config: Record<string, unknown> }).config;
}

const toggle = () => screen.getByRole("switch", { name: "Keep each run's rows" });

describe("OutputEditorSheet -- History section (HEL-1331)", () => {
  it("shows the owner-ruled copy, including the cap, retention and opt-out text", () => {
    renderSheet(outputOf(METRIC, true));
    expect(
      screen.getByText(
        "Stores the full rows of every run from the next run on, so History can show what changed. A run over 1,000 rows or 1 MiB keeps only its summary. Beta keeps the last 10 runs for 7 days; Owner keeps 30 runs for 30 days. Turning this off stops storing rows; rows already kept expire on the normal schedule.",
      ),
    ).toBeInTheDocument();
    expect(toggle()).toBeEnabled();
    expect(screen.queryByText("Free stores run summaries only")).not.toBeInTheDocument();
  });

  it("renders overridden figures from the response and no default figure (HEL-1372)", () => {
    renderSheet(
      outputOf(METRIC, true, {
        maxRows: 500,
        maxBytes: 2097152,
        tiers: { ...DEFAULT_LIMITS.tiers, beta: { maxRuns: 1, maxAgeDays: 1 } },
      }),
    );
    const help = document.getElementById("output-history-payloads-help")?.textContent ?? "";
    expect(help).toContain("A run over 500 rows or 2 MiB keeps only its summary.");
    expect(help).toContain("Beta keeps the last 1 run for 1 day;");
    expect(help).not.toMatch(/1,000|1 MiB|10 runs|7 days/);
  });

  it("omits figures rather than guessing when the response carries no limits (HEL-1372)", () => {
    renderSheet(outputOf(METRIC, true, null));
    const help = document.getElementById("output-history-payloads-help")?.textContent ?? "";
    expect(help).toContain("Stores the full rows of every run from the next run on");
    expect(help).toContain("Turning this off stops storing rows");
    expect(help).not.toMatch(/\d/);
  });

  it("an enabled switch turned on sends historyPayloads: true", async () => {
    renderSheet(outputOf(METRIC, true));
    expect(toggle()).not.toBeChecked();
    fireEvent.click(toggle());
    expect((await save()).historyPayloads).toBe(true);
  });

  it("an enabled switch turned off from a stored true sends historyPayloads: false", async () => {
    renderSheet(outputOf({ ...METRIC, historyPayloads: true }, true));
    expect(toggle()).toBeChecked();
    fireEvent.click(toggle());
    expect((await save()).historyPayloads).toBe(false);
  });

  it.each([
    ["absent", {}],
    ["null", { historyPayloads: null }],
    ["true", { historyPayloads: true }],
  ])("an untouched switch omits the key (%s seed)", async (_label, seed) => {
    renderSheet(outputOf({ ...METRIC, ...seed }, true));
    expect(Object.keys(await save())).not.toContain("historyPayloads");
  });

  it("toggling on and back off sends nothing (no net change)", async () => {
    renderSheet(outputOf(METRIC, true));
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(Object.keys(await save())).not.toContain("historyPayloads");
  });

  it("a disabled switch shows the note and the Beta link, and Save omits the key", async () => {
    renderSheet(outputOf({ ...METRIC, historyPayloads: true }, false));
    expect(toggle()).toBeDisabled();
    expect(toggle()).toBeChecked(); // a stored true still shows as on
    expect(screen.getByText("Free stores run summaries only")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Request Beta access (opens in a new tab)" });
    expect(link).toHaveAttribute("href", "/settings#beta-access");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(Object.keys(await save())).not.toContain("historyPayloads");
  });

  it("the disabled note shares the help text's style class (HEL-1372)", () => {
    renderSheet(outputOf(METRIC, false));
    const help = document.getElementById("output-history-payloads-help");
    const note = document.getElementById("output-history-payloads-note");
    expect(note).toHaveClass("output-editor-sheet__field-hint");
    expect(note).not.toHaveClass("output-editor-sheet__type-hint");
    expect(help).toHaveClass("output-editor-sheet__field-hint");
  });

  it("fails closed when the response carries no flag", () => {
    renderSheet(outputOf(METRIC));
    expect(toggle()).toBeDisabled();
    expect(screen.getByRole("link", { name: /^Request Beta access/ })).toBeInTheDocument();
  });

  it("gates on the pipeline owner, not the viewer: a beta viewer on a free-owned pipeline sees it disabled", () => {
    renderSheet(outputOf(METRIC, false), "beta");
    expect(toggle()).toBeDisabled();
    expect(screen.getByText("Free stores run summaries only")).toBeInTheDocument();
  });

  it("gates on the pipeline owner, not the viewer: a free viewer on a beta-owned pipeline sees it enabled", () => {
    renderSheet(outputOf(METRIC, true), "free");
    expect(toggle()).toBeEnabled();
  });

  it("create mode has no History section", () => {
    renderSheet(null);
    expect(screen.queryByRole("switch", { name: "Keep each run's rows" })).not.toBeInTheDocument();
    expect(screen.queryByText("History")).not.toBeInTheDocument();
  });
});
