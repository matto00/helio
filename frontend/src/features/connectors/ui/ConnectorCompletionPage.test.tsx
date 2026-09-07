// ConnectorCompletionPage tests (HEL-955 evaluation-1.md CR4): renders the credential field
// from the pending Connector's ACTUAL fetched auth shape (never a discarded chooser), submits
// only { token, credential }, and handles the missing-token / invalid-token / success states.

import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import * as connectorCompletionService from "../services/connectorCompletionService";
import { ConnectorCompletionPage } from "./ConnectorCompletionPage";

jest.mock("../services/connectorCompletionService", () => ({
  completeConnector: jest.fn(),
  getPendingConnectorAuthShape: jest.fn(),
}));

const completeConnectorMock = jest.mocked(connectorCompletionService.completeConnector);
const getShapeMock = jest.mocked(connectorCompletionService.getPendingConnectorAuthShape);

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/connectors/complete" element={<ConnectorCompletionPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ConnectorCompletionPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders 'This link is missing its completion token' with no token param, never calling the service", () => {
    renderAt("/connectors/complete");
    expect(screen.getByText(/missing its completion token/i)).toBeInTheDocument();
    expect(getShapeMock).not.toHaveBeenCalled();
  });

  it("renders the credential field labeled from the FETCHED auth shape (api_key), never a chooser", async () => {
    getShapeMock.mockResolvedValue({ authType: "api_key" });
    renderAt("/connectors/complete?token=good-token");

    expect(await screen.findByLabelText(/API key value/i)).toBeInTheDocument();
    // The old dead chooser is gone entirely.
    expect(
      screen.queryByRole("combobox", { name: /authentication type/i }),
    ).not.toBeInTheDocument();
    expect(getShapeMock).toHaveBeenCalledWith("good-token");
  });

  it("renders the credential field labeled 'Bearer token value' for a bearer shape", async () => {
    getShapeMock.mockResolvedValue({ authType: "bearer" });
    renderAt("/connectors/complete?token=good-token");

    expect(await screen.findByLabelText(/Bearer token value/i)).toBeInTheDocument();
  });

  it("renders the invalid-link message when the shape lookup fails, never a form", async () => {
    getShapeMock.mockRejectedValue(new Error("400"));
    renderAt("/connectors/complete?token=bad-token");

    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid or has expired/i);
    expect(screen.queryByLabelText(/token value|key value/i)).not.toBeInTheDocument();
  });

  it("submits ONLY { token, credential } — never the fetched authType", async () => {
    getShapeMock.mockResolvedValue({ authType: "api_key", apiKeyName: "X-Api-Key" });
    completeConnectorMock.mockResolvedValue();
    renderAt("/connectors/complete?token=good-token");

    const input = await screen.findByLabelText(/API key value/i);
    fireEvent.change(input, { target: { value: "sk-the-real-value" } });
    fireEvent.click(screen.getByRole("button", { name: /submit credential/i }));

    await waitFor(() => expect(completeConnectorMock).toHaveBeenCalledTimes(1));
    expect(completeConnectorMock).toHaveBeenCalledWith({
      token: "good-token",
      credential: "sk-the-real-value",
    });

    expect(await screen.findByText(/is now ready to use/i)).toBeInTheDocument();
  });

  it("shows the generic invalid-or-expired alert on a rejected submission", async () => {
    getShapeMock.mockResolvedValue({ authType: "bearer" });
    completeConnectorMock.mockRejectedValue(new Error("400"));
    renderAt("/connectors/complete?token=good-token");

    const input = await screen.findByLabelText(/Bearer token value/i);
    fireEvent.change(input, { target: { value: "wrong-or-late" } });
    fireEvent.click(screen.getByRole("button", { name: /submit credential/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid or has expired/i);
  });
});
