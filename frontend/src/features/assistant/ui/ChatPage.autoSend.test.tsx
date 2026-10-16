import { act, screen, waitFor } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import {
  converse as converseRequest,
  createConversation as createConversationRequest,
  listConversations as listConversationsRequest,
} from "../services/assistantConversationsService";
import { renderWithStore } from "../../../test/renderWithStore";
import { TierRequestAccessCopy } from "../state/assistantConversationsSlice";
import { ChatPage } from "./ChatPage";

jest.mock("../services/assistantConversationsService", () => ({
  listConversations: jest.fn(),
  getConversation: jest.fn(),
  updateConversation: jest.fn(),
  createConversation: jest.fn(),
  converse: jest.fn(),
}));

const createMock = jest.mocked(createConversationRequest);
const converseMock = jest.mocked(converseRequest);
const listMock = jest.mocked(listConversationsRequest);

const detail = (id: string) =>
  ({
    id,
    title: "Why did revenue dip",
    pinned: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    transcript: [],
  }) as never;

function StateProbe() {
  const location = useLocation();
  return <output data-testid="nav-state">{JSON.stringify(location.state)}</output>;
}

/** Stands in for the palette's "Ask the assistant" action: navigates to `/chat` with a hand-off. */
const askFromHere = { current: (_text: string): void => undefined };
function AskProbe() {
  const navigate = useNavigate();
  useEffect(() => {
    askFromHere.current = (text) => navigate("/chat", { state: { draft: text, autoSend: true } });
  }, [navigate]);
  return null;
}

function renderHandoff(tier: "beta" | "free") {
  return renderWithStore(
    <StrictMode>
      <Routes>
        <Route
          path="/"
          element={
            <Navigate
              to="/chat"
              replace
              state={{ draft: "  why did revenue dip ", autoSend: true }}
            />
          }
        />
        <Route
          path="/chat"
          element={
            <>
              <ChatPage />
              <StateProbe />
              <AskProbe />
            </>
          }
        />
      </Routes>
    </StrictMode>,
    {
      auth: {
        status: "authenticated",
        currentUser: {
          id: "u1",
          email: "a@b.c",
          displayName: null,
          avatarUrl: null,
          createdAt: "2026-01-01T00:00:00Z",
          tier,
        },
      },
    },
  );
}

describe("ChatPage palette auto-send hand-off (HEL-1575 D10)", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    listMock.mockResolvedValue([]);
    createMock.mockResolvedValue(detail("new-1"));
    converseMock.mockResolvedValue(detail("new-1"));
  });

  it("creates one conversation and sends the text exactly once under StrictMode", async () => {
    const { store } = renderHandoff("beta");

    await waitFor(() => expect(converseMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(converseMock).toHaveBeenCalledWith("new-1", "why did revenue dip", expect.any(String));
    await waitFor(() =>
      expect(store.getState().assistantConversations.selectedConversationId).toBe("new-1"),
    );
    expect(screen.getByTestId("nav-state")).toHaveTextContent("null");
    // The composer is not seeded with the text (it was sent, not drafted).
    expect(screen.getByLabelText("Message")).toHaveValue("");
    expect(converseMock).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for a free-tier user, who lands on the request-access state", async () => {
    renderHandoff("free");

    await waitFor(() => expect(screen.getByText(TierRequestAccessCopy.title)).toBeInTheDocument());
    expect(createMock).not.toHaveBeenCalled();
    expect(converseMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("nav-state")).toHaveTextContent("null");
  });

  it("surfaces a converse failure with the composer's copy", async () => {
    converseMock.mockRejectedValue(new Error("boom"));
    renderHandoff("beta");

    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect(converseMock).toHaveBeenCalledTimes(1);
  });

  it("honours a second hand-off made while already on /chat, once, and clears it", async () => {
    createMock.mockResolvedValueOnce(detail("new-1")).mockResolvedValueOnce(detail("new-2"));
    converseMock.mockResolvedValueOnce(detail("new-1")).mockResolvedValueOnce(detail("new-2"));
    renderHandoff("beta");
    await waitFor(() => expect(converseMock).toHaveBeenCalledTimes(1));

    act(() => askFromHere.current("second question"));

    await waitFor(() => expect(converseMock).toHaveBeenCalledTimes(2));
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(converseMock).toHaveBeenLastCalledWith("new-2", "second question", expect.any(String));
    await waitFor(() => expect(screen.getByTestId("nav-state")).toHaveTextContent("null"));
    expect(converseMock).toHaveBeenCalledTimes(2);
  });

  it("sends the same text again when it is asked again on /chat (a new navigation, not a new text)", async () => {
    renderHandoff("beta");
    await waitFor(() => expect(converseMock).toHaveBeenCalledTimes(1));

    act(() => askFromHere.current("why did revenue dip"));

    await waitFor(() => expect(converseMock).toHaveBeenCalledTimes(2));
  });
});
