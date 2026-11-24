// HEL-1744 D1-D3 -- the insight settings card in the Output editor sheet, through the real sheet.
import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { httpClient } from "../../../../services/httpClient";
import { authReducer } from "../../../auth/state/authSlice";
import { outputsReducer } from "../../state/outputsSlice";
import { OutputEditorSheet } from "./OutputEditorSheet";
import type { Output, OutputKind } from "../../types/output";
import type { UserTier } from "../../../auth/types/user";

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
  http.get.mockImplementation((url: string) => {
    if (url.endsWith("/panels")) return Promise.resolve({ data: [] });
    if (url.includes("/capabilities")) {
      return Promise.resolve({ data: { columns: [], capabilities: {} } });
    }
    return Promise.resolve({
      data: {
        rows: [],
        rowCount: 0,
        stepRowCounts: {},
        sourceRowCount: 0,
        blocked: false,
        sourceTruncated: false,
        truncatedReads: [],
      },
    });
  });
  http.patch.mockResolvedValue({ data: { id: "i-1", pipelineId: "p-1", kind: "insight" } });
  http.post.mockResolvedValue({
    data: { id: "i-2", pipelineId: "p-1", kind: "insight", name: "n", config: {}, schema: [] },
  });
});

function outputOf(id: string, kind: OutputKind, extra: Partial<Output> = {}): Output {
  return {
    id,
    pipelineId: "p-1",
    nodeStepId: "step-1",
    ownerId: "u-1",
    name: id.toUpperCase(),
    kind,
    config: {},
    schema: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...extra,
  };
}

interface Opts {
  output?: Output | null;
  siblings?: Output[];
  tier?: UserTier;
  isPipelineOwner?: boolean;
}

async function renderSheet({
  output = null,
  siblings = [],
  tier = "beta",
  isPipelineOwner = true,
}: Opts = {}) {
  const initial = authReducer(undefined, { type: "init" });
  const outputsInitial = outputsReducer(undefined, { type: "init" });
  const store = configureStore({
    reducer: { outputs: outputsReducer, auth: authReducer },
    preloadedState: {
      outputs: {
        ...outputsInitial,
        byPipeline: { "p-1": [...siblings, ...(output ? [output] : [])] },
      },
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
          readOnly={false}
          open
          onClose={jest.fn()}
          pipelineId="p-1"
          output={output}
          createTargetStepId="step-1"
          steps={[{ id: "step-1", label: "First step" } as never]}
          isPipelineOwner={isPipelineOwner}
        />
      </Provider>
    </MemoryRouter>,
  );
  await act(async () => {});
}

async function pickInsightKind() {
  fireEvent.click(await screen.findByRole("combobox", { name: "Output kind" }));
  const listbox = await screen.findByRole("listbox");
  await act(async () => {
    fireEvent.click(within(listbox).getByRole("option", { name: "Insight" }));
  });
}

const SIBLINGS = [
  outputOf("t1", "table"),
  outputOf("m1", "metric"),
  outputOf("far", "chart", { nodeStepId: "step-2" }),
  outputOf("other-insight", "insight"),
];

const checkbox = (name: string) => screen.getByRole("checkbox", { name: new RegExp(name) });

describe("OutputEditorSheet -- insight settings card (HEL-1744)", () => {
  it("offers Insight in the create picker and shows the defaults", async () => {
    await renderSheet({ siblings: SIBLINGS });
    await pickInsightKind();
    expect(screen.getByRole("combobox", { name: "Preset" })).toHaveTextContent("Auto");
    expect(screen.getByRole("radio", { name: "On every run" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect((checkbox("T1") as HTMLInputElement).checked).toBe(true);
    expect((checkbox("M1") as HTMLInputElement).checked).toBe(true);
    expect((checkbox("FAR") as HTMLInputElement).checked).toBe(false);
    // Other insights and the insight itself are never listed.
    expect(screen.queryByRole("checkbox", { name: /OTHER-INSIGHT/ })).toBeNull();
    const details = screen.getByText("Custom prompt").closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
  });

  it("creates without typing a prompt: the body has no prompt, reads, preset or refresh", async () => {
    await renderSheet({ siblings: SIBLINGS });
    await pickInsightKind();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^(Save|Create)/ }));
    });
    await waitFor(() => expect(http.post).toHaveBeenCalled());
    const body = JSON.parse(JSON.stringify(http.post.mock.calls[0][1]));
    expect(body.kind).toBe("insight");
    expect(body.config).toEqual({});
  });

  it("shows stored values when an existing insight is opened", async () => {
    const insight = outputOf("i-1", "insight", {
      config: {
        preset: "trend",
        refresh: "daily",
        prompt: "Mind the churn",
        reads: { outputs: ["far"] },
      },
    });
    await renderSheet({ output: insight, siblings: SIBLINGS });
    expect(screen.getByRole("combobox", { name: "Preset" })).toHaveTextContent("Trend over time");
    expect(screen.getByRole("radio", { name: "Daily" })).toHaveAttribute("aria-checked", "true");
    expect((checkbox("FAR") as HTMLInputElement).checked).toBe(true);
    expect((checkbox("T1") as HTMLInputElement).checked).toBe(false);
    const details = screen.getByText("Custom prompt").closest("details");
    expect(details).toHaveAttribute("open");
    expect(screen.getByRole("textbox", { name: "Custom prompt" })).toHaveValue("Mind the churn");
  });

  it("an untouched edit save sends no insight config key", async () => {
    const insight = outputOf("i-1", "insight", { config: { preset: "delta" } });
    await renderSheet({ output: insight, siblings: SIBLINGS });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    await waitFor(() => expect(http.patch).toHaveBeenCalled());
    expect(JSON.parse(JSON.stringify(http.patch.mock.calls[0][1])).config).toBeUndefined();
  });

  it("unticking one default Output writes an explicit reads list", async () => {
    const insight = outputOf("i-1", "insight");
    await renderSheet({ output: insight, siblings: SIBLINGS });
    await act(async () => {
      fireEvent.click(checkbox("M1"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    await waitFor(() => expect(http.patch).toHaveBeenCalled());
    expect(JSON.parse(JSON.stringify(http.patch.mock.calls[0][1])).config).toEqual({
      reads: { outputs: ["t1"] },
    });
  });

  it("blocks save with an inline message when more than 8 Outputs are ticked", async () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      outputOf(`x${i}`, "table", { nodeStepId: "step-9" }),
    );
    const insight = outputOf("i-1", "insight", { config: { reads: { outputs: ["x0"] } } });
    await renderSheet({ output: insight, siblings: many });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show all 9" }));
    });
    for (let i = 1; i < 9; i++) {
      await act(async () => {
        fireEvent.click(checkbox(`X${i}`));
      });
    }
    expect(screen.getByText(/at most 8/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("changing the prompt and clearing it sends an explicit null", async () => {
    const insight = outputOf("i-1", "insight", { config: { prompt: "old" } });
    await renderSheet({ output: insight });
    await act(async () => {
      fireEvent.change(screen.getByRole("textbox", { name: "Custom prompt" }), {
        target: { value: "" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    await waitFor(() => expect(http.patch).toHaveBeenCalled());
    expect(JSON.parse(JSON.stringify(http.patch.mock.calls[0][1])).config).toEqual({
      prompt: null,
    });
  });

  it("limits the prompt to 2000 characters", async () => {
    await renderSheet({});
    await pickInsightKind();
    fireEvent.click(screen.getByText("Custom prompt"));
    expect(screen.getByRole("textbox", { name: "Custom prompt" })).toHaveAttribute(
      "maxlength",
      "2000",
    );
  });

  it("shows the upsell to a free-tier pipeline owner, keeping save enabled", async () => {
    await renderSheet({ tier: "free", isPipelineOwner: true });
    await pickInsightKind();
    expect(screen.getByText("Insights render on the beta plan.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /beta access/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^(Save|Create)/ })).toBeEnabled();
  });

  it("shows no upsell to a free-tier editor on someone else's pipeline", async () => {
    await renderSheet({ tier: "free", isPipelineOwner: false });
    await pickInsightKind();
    expect(screen.queryByText("Insights render on the beta plan.")).toBeNull();
  });

  it("shows no upsell to a beta-tier pipeline owner", async () => {
    await renderSheet({ tier: "beta", isPipelineOwner: true });
    await pickInsightKind();
    expect(screen.queryByText("Insights render on the beta plan.")).toBeNull();
  });

  // HEL-1743 D13: the per-Output model selector, after the preset.
  describe("model selector", () => {
    const MODELS = {
      models: [
        { id: "claude-haiku-5-5", label: "Haiku 5.5", betaWeight: 1 },
        { id: "claude-sonnet-5-5", label: "Sonnet 5.5", betaWeight: 4 },
      ],
      serverDefault: { id: "claude-haiku-5-5", label: "Haiku 5.5" },
      defaultModel: { id: "claude-haiku-5-5", label: "Haiku 5.5" },
    };
    function withModels(result: "ok" | "refused") {
      const previous = http.get.getMockImplementation();
      http.get.mockImplementation((url: string) =>
        url === "/api/assistant-models"
          ? result === "ok"
            ? Promise.resolve({ data: MODELS })
            : Promise.reject(new Error("403"))
          : (previous as (u: string) => Promise<unknown>)(url),
      );
    }

    it("lists the selectable models plus Server default (the default shown) and, once chosen, writes the model", async () => {
      withModels("ok");
      await renderSheet({ siblings: SIBLINGS });
      await pickInsightKind();
      const select = await screen.findByRole("combobox", { name: "Model" });
      expect(select).toHaveTextContent("Server default");
      fireEvent.click(select);
      const listbox = await screen.findByRole("listbox");
      expect(
        within(listbox)
          .getAllByRole("option")
          .map((o) => o.textContent),
      ).toEqual(["Server default", "Haiku 5.5", "Sonnet 5.5"]);
      await act(async () => {
        fireEvent.click(within(listbox).getByRole("option", { name: "Haiku 5.5" }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^(Save|Create)/ }));
      });
      await waitFor(() => expect(http.post).toHaveBeenCalled());
      expect(JSON.parse(JSON.stringify(http.post.mock.calls[0][1])).config).toEqual({
        model: "claude-haiku-5-5",
      });
    });

    it("clears a stored model when Server default is chosen on an edit", async () => {
      withModels("ok");
      const insight = outputOf("i-1", "insight", { config: { model: "claude-sonnet-5-5" } });
      await renderSheet({ output: insight, siblings: SIBLINGS });
      const select = await screen.findByRole("combobox", { name: "Model" });
      expect(select).toHaveTextContent("Sonnet 5.5");
      fireEvent.click(select);
      const listbox = await screen.findByRole("listbox");
      await act(async () => {
        fireEvent.click(within(listbox).getByRole("option", { name: "Server default" }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
      });
      await waitFor(() => expect(http.patch).toHaveBeenCalled());
      expect(JSON.parse(JSON.stringify(http.patch.mock.calls[0][1])).config).toEqual({
        model: null,
      });
    });

    it("hides the selector when the model list cannot be loaded, and saving still works", async () => {
      withModels("refused");
      await renderSheet({ siblings: SIBLINGS });
      await pickInsightKind();
      expect(screen.queryByRole("combobox", { name: "Model" })).toBeNull();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^(Save|Create)/ }));
      });
      await waitFor(() => expect(http.post).toHaveBeenCalled());
      expect(JSON.parse(JSON.stringify(http.post.mock.calls[0][1])).config).toEqual({});
    });
  });
});
