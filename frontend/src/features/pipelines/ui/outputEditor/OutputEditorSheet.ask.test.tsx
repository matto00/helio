// HEL-1746 D3: the "Ask about this Output" group of the Output editor sheet. Present only for an Output with a saved server row
// (never create mode, never a draft Output whose id is a client id); Pin is disabled with a reason while a pipeline draft exists.
import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { httpClient } from "../../../../services/httpClient";
import { authReducer } from "../../../auth/state/authSlice";
import { PIN_DRAFT_REASON } from "../../../ask/ui/AskAnswerCard";
import { outputsReducer } from "../../state/outputsSlice";
import { isDraftClientId } from "../../state/draftOps";
import type { Output } from "../../types/output";
import { OutputEditorSheet } from "./OutputEditorSheet";
import type { OutputSheetDraft } from "./outputSheetDraft";

jest.mock("../../../../services/httpClient", () => ({
  httpClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("../../../panels/insight/InsightMarkdown", () => ({
  InsightMarkdown: ({ markdown }: { markdown: string }) => <p>{markdown}</p>,
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
    Promise.resolve({
      data: url.endsWith("/panels") ? [] : { columns: [], capabilities: {}, rows: [], rowCount: 0 },
    }),
  );
  http.post.mockImplementation((url: string) =>
    url.endsWith("/ask")
      ? Promise.resolve({
          data: {
            answer: "Revenue is 10 [c1].",
            citations: [{ id: "c1", outputId: "o-1", field: "revenue", number: 10, isPct: false }],
            citedOutputs: [{ id: "o-1", name: "Revenue" }],
            pin: { pipelineId: "p-1", request: { kind: "insight", name: "q", config: {} } },
          },
        })
      : // The draft projection (`analyze-proposal`) the sheet reads while a draft exists.
        Promise.resolve({ data: { sourceSchemas: [], steps: [], outputs: [] } }),
  );
});

const output = (id: string): Output => ({
  id,
  pipelineId: "p-1",
  nodeStepId: "step-1",
  ownerId: "u-1",
  name: "Revenue",
  kind: "table",
  config: {},
  schema: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

async function renderSheet(out: Output | null, draft?: OutputSheetDraft) {
  const store = configureStore({
    reducer: { outputs: outputsReducer, auth: authReducer },
    preloadedState: {
      outputs: {
        ...outputsReducer(undefined, { type: "init" }),
        byPipeline: { "p-1": out ? [out] : [] },
      },
      auth: {
        ...authReducer(undefined, { type: "init" }),
        currentUser: {
          id: "u-1",
          email: "u@test.local",
          displayName: null,
          avatarUrl: null,
          createdAt: "2026-01-01T00:00:00Z",
          tier: "beta" as const,
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
          output={out}
          createTargetStepId="step-1"
          steps={[{ id: "step-1", label: "First step" } as never]}
          draft={draft}
        />
      </Provider>
    </MemoryRouter>,
  );
  await act(async () => {});
}

const CLIENT_PREFIX = "draft-";
const group = () => screen.queryByText("Ask about this Output");

const DRAFT: OutputSheetDraft = {
  pipelineName: "Revenue rollup",
  roots: [{ id: "root-1", dataSourceId: "src-1", dataSourceName: "Sales" }],
  frames: null,
  onNodeChange: jest.fn(),
};

describe("OutputEditorSheet ask group (HEL-1746)", () => {
  it("is offered for a saved Output, behind a disclosure, and posts to the Output's ask route", async () => {
    await renderSheet(output("o-1"));
    const summary = screen.getByText("Ask about this Output");
    expect(summary.tagName).toBe("SUMMARY");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    fireEvent.change(screen.getByRole("textbox", { name: "Your question" }), {
      target: { value: "Why?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByRole("region", { name: "Answer" });
    expect(http.post).toHaveBeenCalledWith("/api/outputs/o-1/ask", { question: "Why?" });
  });

  it("is absent in create mode", async () => {
    await renderSheet(null);
    expect(group()).not.toBeInTheDocument();
  });

  it("is absent for an Output that exists only in the draft (a client id)", async () => {
    const clientId = `${CLIENT_PREFIX}1`;
    expect(isDraftClientId(clientId)).toBe(true);
    await renderSheet(output(clientId), DRAFT);
    expect(group()).not.toBeInTheDocument();
  });

  it("while a pipeline draft exists, the saved Output's pin is disabled with the visible reason", async () => {
    await renderSheet(output("o-1"), DRAFT);
    fireEvent.change(screen.getByRole("textbox", { name: "Your question" }), {
      target: { value: "Why?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    const pin = await screen.findByRole("button", { name: "Pin as insight" });
    expect(pin).toBeDisabled();
    expect(screen.getByText(PIN_DRAFT_REASON)).toBeInTheDocument();
  });

  it("with no draft the pin is enabled", async () => {
    await renderSheet(output("o-1"));
    fireEvent.change(screen.getByRole("textbox", { name: "Your question" }), {
      target: { value: "Why?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByRole("button", { name: "Pin as insight" })).toBeEnabled();
  });
});
