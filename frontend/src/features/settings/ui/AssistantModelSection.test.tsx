// HEL-1755 D10: Settings → Assistant default model — owner/beta only, shared Select in a FormField,
// "Server default" clears, a failed save reverts, and a successful save refetches the model list and the open
// conversation.

import { fireEvent, screen, waitFor } from "@testing-library/react";

import { patchShellPreferencesRequest } from "../../auth/services/authService";
import {
  fetchAssistantModels as fetchAssistantModelsRequest,
  getConversation as getConversationRequest,
} from "../../assistant/services/assistantConversationsService";
import { renderWithStore } from "../../../test/renderWithStore";
import type { User } from "../../auth/types/user";
import type { AssistantModelsResponse } from "../../assistant/types";
import { AssistantModelSection } from "./AssistantModelSection";

jest.mock("../../auth/services/authService", () => ({
  ...jest.requireActual("../../auth/services/authService"),
  patchShellPreferencesRequest: jest.fn(),
}));
jest.mock("../../assistant/services/assistantConversationsService", () => ({
  fetchAssistantModels: jest.fn(),
  getConversation: jest.fn(),
}));

const patchMock = jest.mocked(patchShellPreferencesRequest);
const fetchModelsMock = jest.mocked(fetchAssistantModelsRequest);
const getConversationMock = jest.mocked(getConversationRequest);

const modelsResponse: AssistantModelsResponse = {
  models: [
    { id: "claude-haiku-5-5", label: "Haiku 5.5", betaWeight: 1 },
    { id: "claude-sonnet-5-5", label: "Sonnet 5.5", betaWeight: 4 },
  ],
  serverDefault: { id: "claude-opus-4-8" },
  defaultModel: { id: "claude-opus-4-8" },
};

function user(tier: User["tier"], assistantModel?: string): User {
  return {
    id: "u1",
    email: "u@example.com",
    displayName: null,
    avatarUrl: null,
    createdAt: "2026-11-17T00:00:00Z",
    tier,
    preferences: { accentColor: null, zoomLevels: {}, assistantModel },
  };
}

const select = () => screen.getByRole("combobox", { name: "Default model" });

beforeEach(() => {
  patchMock.mockReset();
  fetchModelsMock.mockReset();
  fetchModelsMock.mockResolvedValue(modelsResponse);
  getConversationMock.mockReset();
});

describe("AssistantModelSection", () => {
  it("renders nothing for a free-tier user and fetches nothing", () => {
    renderWithStore(<AssistantModelSection />, { auth: { currentUser: user("free") } });
    expect(screen.queryByText("Assistant")).not.toBeInTheDocument();
    expect(fetchModelsMock).not.toHaveBeenCalled();
  });

  it("shows the saved default, and 'Server default (<id>)' when none is saved", async () => {
    const saved = renderWithStore(<AssistantModelSection />, {
      auth: { currentUser: user("beta", "claude-sonnet-5-5") },
    });
    await waitFor(() => expect(select()).toHaveTextContent("Sonnet 5.5"));
    saved.unmount();

    renderWithStore(<AssistantModelSection />, { auth: { currentUser: user("owner") } });
    await waitFor(() => expect(select()).toHaveTextContent("Server default (claude-opus-4-8)"));
  });

  it("treats a saved id that is no longer selectable as unset", async () => {
    renderWithStore(<AssistantModelSection />, {
      auth: { currentUser: user("owner", "claude-opus-5-5") },
    });
    await waitFor(() => expect(select()).toHaveTextContent("Server default"));
  });

  it("saves a pick, then refetches the model list and the open conversation", async () => {
    patchMock.mockResolvedValueOnce({ accentColor: null, zoomLevels: {} });
    getConversationMock.mockResolvedValue({
      id: "conv-1",
      title: "Chat",
      pinned: false,
      updatedAt: "x",
      transcript: [],
      effectiveModel: "claude-haiku-5-5",
    });
    const { store } = renderWithStore(<AssistantModelSection />, {
      auth: { currentUser: user("owner") },
      assistantConversations: {
        selectedConversationId: "conv-1",
        activeConversation: {
          data: { id: "conv-1", title: "Chat", pinned: false, updatedAt: "x", transcript: [] },
          status: "succeeded",
        },
      },
    });
    await waitFor(() => expect(select()).not.toBeDisabled());
    fetchModelsMock.mockClear();

    fireEvent.click(select());
    fireEvent.click(screen.getByRole("option", { name: "Haiku 5.5" }));

    expect(patchMock).toHaveBeenCalledWith({ assistantModel: "claude-haiku-5-5" });
    await waitFor(() => expect(fetchModelsMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getConversationMock).toHaveBeenCalledWith("conv-1"));
    expect(store.getState().auth.currentUser?.preferences?.assistantModel).toBe("claude-haiku-5-5");
    await waitFor(() =>
      expect(store.getState().assistantConversations.activeConversation.data?.effectiveModel).toBe(
        "claude-haiku-5-5",
      ),
    );
  });

  it("clears the saved default with null when 'Server default' is picked", async () => {
    patchMock.mockResolvedValueOnce({ accentColor: null, zoomLevels: {} });
    const { store } = renderWithStore(<AssistantModelSection />, {
      auth: { currentUser: user("owner", "claude-haiku-5-5") },
    });
    await waitFor(() => expect(select()).toHaveTextContent("Haiku 5.5"));
    fireEvent.click(select());
    fireEvent.click(screen.getByRole("option", { name: "Server default (claude-opus-4-8)" }));

    await waitFor(() => expect(patchMock).toHaveBeenCalledWith({ assistantModel: null }));
    await waitFor(() =>
      expect(store.getState().auth.currentUser?.preferences?.assistantModel).toBeUndefined(),
    );
  });

  it("reverts to the previous default and shows an error when the save fails", async () => {
    patchMock.mockRejectedValueOnce(new Error("nope"));
    const { store } = renderWithStore(<AssistantModelSection />, {
      auth: { currentUser: user("owner", "claude-haiku-5-5") },
    });
    await waitFor(() => expect(select()).toHaveTextContent("Haiku 5.5"));
    fireEvent.click(select());
    fireEvent.click(screen.getByRole("option", { name: "Sonnet 5.5" }));

    await waitFor(() =>
      expect(screen.getByText("Failed to save your default model.")).toBeInTheDocument(),
    );
    expect(store.getState().auth.currentUser?.preferences?.assistantModel).toBe("claude-haiku-5-5");
    expect(select()).toHaveTextContent("Haiku 5.5");
  });
});
