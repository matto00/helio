// ConnectorsPage tests (HEL-824): list render (incl. implicit badge +
// dependent count), empty state, create flow, delete confirm/cancel + 409
// conflict surfacing distinct from a generic error.

import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "react-redux";

import { toastsReducer } from "../../toasts/state/toastsSlice";
import * as connectorEntityService from "../services/connectorEntityService";
import { connectorsReducer } from "../state/connectorsSlice";
import type { Connector } from "../types/connector";
import { ConnectorsPage } from "./ConnectorsPage";

jest.mock("../services/connectorEntityService", () => ({
  fetchConnectors: jest.fn(),
  createConnector: jest.fn(),
  updateConnector: jest.fn(),
  deleteConnector: jest.fn(),
  rotateConnectorCredential: jest.fn(),
}));

// TestConnectionAffordance calls this — irrelevant to these tests, stub it
// out so no unrelated network call fires.
jest.mock("../../sources/services/dataSourceService", () => ({
  ...jest.requireActual("../../sources/services/dataSourceService"),
  testConnection: jest.fn().mockResolvedValue({ ok: true, error: null }),
}));

const fetchConnectorsMock = jest.mocked(connectorEntityService.fetchConnectors);
const createConnectorMock = jest.mocked(connectorEntityService.createConnector);
const deleteConnectorMock = jest.mocked(connectorEntityService.deleteConnector);

const savedConnector: Connector = {
  id: "conn-1",
  ownerId: "u-1",
  name: "Stripe",
  kind: "rest_api",
  baseUrl: "https://api.stripe.com",
  config: { authType: "bearer" },
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
  dependentCount: 0,
};

const implicitConnector: Connector = {
  ...savedConnector,
  id: "conn-2",
  name: "Legacy source host",
  config: { authType: "none", implicit: true },
  dependentCount: 1,
};

function buildStore(items: Connector[] = []) {
  return configureStore({
    reducer: { connectors: connectorsReducer, toasts: toastsReducer },
    preloadedState: {
      connectors: { items, status: "idle" as const, error: null, deleteConflict: {} },
    },
  });
}

function renderPage(items: Connector[] = []) {
  const store = buildStore(items);
  fetchConnectorsMock.mockResolvedValue(items);
  return render(
    <Provider store={store}>
      <ConnectorsPage />
    </Provider>,
  );
}

describe("ConnectorsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // jsdom does not implement showModal/close natively (Modal.tsx uses a
    // native <dialog>); stub them, mirroring shared/ui/Modal.test.tsx /
    // AddSourceModal.test.tsx.
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    });
  });

  it("shows an EmptyState with a CTA when there are no connectors", async () => {
    renderPage([]);
    expect(await screen.findByText("No connectors yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add connector" })).toBeInTheDocument();
  });

  it("lists connectors with name/kind/baseUrl/auth/dependent count, badging an implicit one", async () => {
    renderPage([savedConnector, implicitConnector]);

    expect(await screen.findByText("Stripe")).toBeInTheDocument();
    expect(screen.getAllByText("https://api.stripe.com")).toHaveLength(2);
    expect(screen.getByText("0 sources")).toBeInTheDocument();
    expect(screen.getByText("1 source")).toBeInTheDocument();

    expect(screen.getByText("Legacy source host")).toBeInTheDocument();
    expect(screen.getByText("Auto-created")).toBeInTheDocument();
  });

  it("opens the create modal and creates a connector", async () => {
    createConnectorMock.mockResolvedValue({
      ...savedConnector,
      id: "conn-new",
      name: "New Connector",
    });
    renderPage([savedConnector]);

    fireEvent.click(await screen.findByRole("button", { name: "Add connector" }));
    const dialog = await screen.findByRole("dialog", { name: "Add connector" });

    fireEvent.change(within(dialog).getByLabelText("Name"), {
      target: { value: "New Connector" },
    });
    fireEvent.change(within(dialog).getByLabelText("Base URL"), {
      target: { value: "https://api.example.com" },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Create connector" }));

    await waitFor(() => {
      expect(createConnectorMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: "New Connector", baseUrl: "https://api.example.com" }),
      );
    });
  });

  it("deletes a connector with no dependents after confirm", async () => {
    deleteConnectorMock.mockResolvedValue(undefined);
    renderPage([savedConnector]);

    fireEvent.click(await screen.findByRole("button", { name: "Delete Stripe" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm delete Stripe" }));

    await waitFor(() => {
      expect(deleteConnectorMock).toHaveBeenCalledWith("conn-1");
    });
    await waitFor(() => {
      expect(screen.queryByText("Stripe")).not.toBeInTheDocument();
    });
  });

  // HEL-824 skeptic-final-1.md change request 4: `ConnectorEntityService.delete`
  // returns 409 unconditionally whenever `dependentCount > 0` -- there is no
  // force-delete path, so offering a confirm that can never succeed is a
  // false affordance. Delete is disabled up front instead.
  it("disables Delete (no confirm offered) for a connector with dependents", async () => {
    renderPage([implicitConnector]);

    const deleteBtn = await screen.findByRole("button", { name: "Delete Legacy source host" });
    expect(deleteBtn).toBeDisabled();
    expect(deleteBtn).toHaveAttribute(
      "title",
      "Remove or repoint the dependent source(s) before deleting this connector.",
    );

    fireEvent.click(deleteBtn);
    expect(
      screen.queryByRole("button", { name: "Confirm delete Legacy source host" }),
    ).not.toBeInTheDocument();
    expect(deleteConnectorMock).not.toHaveBeenCalled();
  });

  // A 409 can still occur despite the client-side disable -- a dependent
  // source added between page load and the click (a genuine race, not
  // reachable by clicking Delete in this UI, so simulated directly here).
  // HEL-824 skeptic-final-1.md change request 3: the 409 message is built
  // client-side from the row's own `dependentCount`, never the raw backend
  // `ConnectorHasDependents: ...` string.
  it("surfaces a 409 conflict with a client-built message (not the raw backend string), keeping the connector in the list", async () => {
    const axiosLikeError = {
      isAxiosError: true,
      response: { status: 409, data: { error: "ConnectorHasDependents: still referenced" } },
    };
    deleteConnectorMock.mockRejectedValue(axiosLikeError);
    renderPage([savedConnector]);

    fireEvent.click(await screen.findByRole("button", { name: "Delete Stripe" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm delete Stripe" }));

    expect(
      await screen.findByText(
        "This connector is now referenced by a dependent source — refresh the page and try again.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ConnectorHasDependents/)).not.toBeInTheDocument();
    expect(screen.getByText("Stripe")).toBeInTheDocument();
  });
});
