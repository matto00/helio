// HEL-1755 D10: the composer's model picker — value is the server's effectiveModel, the "Server default" option for
// a non-selectable default, optimistic PATCH reverted on error, and the pre-conversation pick reaching the first
// converse.

import { fireEvent, screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import {
  converse as converseRequest,
  createConversation as createConversationRequest,
  fetchAssistantModels as fetchAssistantModelsRequest,
  updateConversation as updateConversationRequest,
} from "../services/assistantConversationsService";
import type { AssistantConversationDetail, AssistantModelsResponse } from "../types";
import { MessageComposer } from "./MessageComposer";
import { ModelPicker } from "./ModelPicker";

jest.mock("../services/assistantConversationsService", () => ({
  createConversation: jest.fn(),
  converse: jest.fn(),
  getConversation: jest.fn(),
  updateConversation: jest.fn(),
  fetchAssistantModels: jest.fn(),
}));

const converseMock = jest.mocked(converseRequest);
const createMock = jest.mocked(createConversationRequest);
const updateMock = jest.mocked(updateConversationRequest);
const fetchModelsMock = jest.mocked(fetchAssistantModelsRequest);

const models = (serverDefaultId: string, defaultId = serverDefaultId): AssistantModelsResponse => ({
  models: [
    { id: "claude-haiku-5-5", label: "Haiku 5.5", betaWeight: 1 },
    { id: "claude-sonnet-5-5", label: "Sonnet 5.5", betaWeight: 4 },
    { id: "claude-opus-5-5", label: "Opus 5.5", betaWeight: 8 },
  ],
  serverDefault: { id: serverDefaultId },
  defaultModel: { id: defaultId },
});

function active(model: string | null, effectiveModel: string): AssistantConversationDetail {
  return {
    id: "conv-1",
    title: "Chat",
    pinned: false,
    updatedAt: "2026-11-17T00:00:00Z",
    transcript: [],
    model,
    effectiveModel,
  };
}

function render(
  ui: React.ReactElement,
  data: AssistantModelsResponse,
  detail: AssistantConversationDetail | null,
) {
  return renderWithStore(ui, {
    assistantModels: { status: "succeeded", data },
    assistantConversations: {
      selectedConversationId: detail?.id ?? null,
      activeConversation: { data: detail, status: "succeeded" },
    },
  });
}

const trigger = () => screen.getByRole("combobox", { name: "Model" });

beforeEach(() => {
  converseMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
});

describe("ModelPicker on an existing conversation", () => {
  it("shows the server-resolved effectiveModel", () => {
    render(
      <ModelPicker conversationId="conv-1" />,
      models("claude-opus-4-8"),
      active(null, "claude-sonnet-5-5"),
    );
    expect(trigger()).toHaveTextContent("Sonnet 5.5");
  });

  it("shows a non-selectable effective model as 'Server default (<id>)'", () => {
    render(
      <ModelPicker conversationId="conv-1" />,
      models("claude-opus-4-8"),
      active(null, "claude-opus-4-8"),
    );
    expect(trigger()).toHaveTextContent("Server default (claude-opus-4-8)");
  });

  it("PATCHes the picked model, optimistically showing it before the server answers", async () => {
    let resolve: (v: never) => void = () => {};
    updateMock.mockReturnValueOnce(new Promise((r) => (resolve = r as never)));
    const { store } = render(
      <ModelPicker conversationId="conv-1" />,
      models("claude-opus-4-8"),
      active(null, "claude-opus-4-8"),
    );
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: "Haiku 5.5" }));

    expect(updateMock).toHaveBeenCalledWith("conv-1", { model: "claude-haiku-5-5" });
    expect(trigger()).toHaveTextContent("Haiku 5.5");
    resolve({
      id: "conv-1",
      title: "Chat",
      pinned: false,
      updatedAt: "x",
      model: "claude-haiku-5-5",
      effectiveModel: "claude-haiku-5-5",
    } as never);
    await waitFor(() =>
      expect(store.getState().assistantConversations.activeConversation.data?.model).toBe(
        "claude-haiku-5-5",
      ),
    );
  });

  it("reverts to the previous model and says so when the PATCH fails", async () => {
    updateMock.mockRejectedValueOnce(new Error("boom"));
    render(
      <ModelPicker conversationId="conv-1" />,
      models("claude-opus-4-8"),
      active("claude-sonnet-5-5", "claude-sonnet-5-5"),
    );
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: "Opus 5.5" }));

    await waitFor(() => expect(screen.getByText("boom")).toBeInTheDocument());
    expect(trigger()).toHaveTextContent("Sonnet 5.5");
  });

  it("clears the stored model (model: null) when 'Server default' is picked", async () => {
    updateMock.mockResolvedValueOnce({
      id: "conv-1",
      title: "Chat",
      pinned: false,
      updatedAt: "x",
      model: null,
      effectiveModel: "claude-opus-4-8",
    });
    render(
      <ModelPicker conversationId="conv-1" />,
      models("claude-opus-4-8"),
      active("claude-haiku-5-5", "claude-haiku-5-5"),
    );
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: "Server default (claude-opus-4-8)" }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith("conv-1", { model: null }));
    // The optimistic value is what a clear resolves to (defaultModel), so the UI does not flash and flip.
    expect(trigger()).toHaveTextContent("Server default (claude-opus-4-8)");
  });

  it("offers no 'Server default' option when the user's saved default overrides it", () => {
    render(
      <ModelPicker conversationId="conv-1" />,
      models("claude-opus-4-8", "claude-sonnet-5-5"),
      active(null, "claude-sonnet-5-5"),
    );
    fireEvent.click(trigger());
    expect(screen.queryByRole("option", { name: /Server default/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Haiku 5.5",
      "Sonnet 5.5",
      "Opus 5.5",
    ]);
  });

  it("is disabled while the open conversation's detail has not arrived", () => {
    render(<ModelPicker conversationId="conv-1" />, models("claude-opus-4-8"), null);
    expect(trigger()).toBeDisabled();
  });

  it("renders nothing until the model list has loaded", () => {
    fetchModelsMock.mockReturnValue(new Promise(() => {}));
    renderWithStore(<ModelPicker conversationId="conv-1" />);
    expect(screen.queryByRole("combobox", { name: "Model" })).not.toBeInTheDocument();
  });
});

describe("ModelPicker before the first message", () => {
  it("shows defaultModel, and the pick reaches the first converse as `model`", async () => {
    createMock.mockResolvedValueOnce({ ...active(null, "claude-opus-5-5"), id: "new-1" });
    converseMock.mockResolvedValueOnce({
      ...active("claude-opus-5-5", "claude-opus-5-5"),
      id: "new-1",
    });
    render(
      <MessageComposer conversationId={null} />,
      models("claude-opus-4-8", "claude-sonnet-5-5"),
      null,
    );

    expect(trigger()).toHaveTextContent("Sonnet 5.5");
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: "Opus 5.5" }));
    expect(trigger()).toHaveTextContent("Opus 5.5");

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(converseMock).toHaveBeenCalled());
    expect(converseMock).toHaveBeenCalledWith(
      "new-1",
      "hello",
      expect.any(String),
      "claude-opus-5-5",
    );
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("sends no model when nothing was picked (the server resolves the default)", async () => {
    createMock.mockResolvedValueOnce({ ...active(null, "claude-sonnet-5-5"), id: "new-2" });
    converseMock.mockResolvedValueOnce({ ...active(null, "claude-sonnet-5-5"), id: "new-2" });
    render(
      <MessageComposer conversationId={null} />,
      models("claude-opus-4-8", "claude-sonnet-5-5"),
      null,
    );
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(converseMock).toHaveBeenCalled());
    expect(converseMock).toHaveBeenCalledWith("new-2", "hi", expect.any(String), undefined);
  });
});
