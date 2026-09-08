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
  pending: false,
};

const implicitConnector: Connector = {
  ...savedConnector,
  id: "conn-2",
  name: "Legacy source host",
  config: { authType: "none", implicit: true },
  dependentCount: 1,
  pending: false,
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

  // HEL-955 design.md D10 / skeptic-final-1.md CR3: the owner-visible completion signal must
  // actually be rendered, and an anonymous completion must be visibly distinguished from a named
  // principal -- design.md's own residual-risk acceptance is argued only on that distinction
  // existing.
  it("renders the D10 completion signal, distinguishing anonymous from a named principal", async () => {
    const anonymouslyCompleted: Connector = {
      ...savedConnector,
      id: "conn-anon",
      name: "Anon-completed API",
      completedAt: "2026-08-15T12:00:00Z",
      completedBy: "anonymous",
    };
    const namedCompleted: Connector = {
      ...savedConnector,
      id: "conn-named",
      name: "Owner-completed API",
      completedAt: "2026-08-16T09:30:00Z",
      completedBy: "u-42",
    };

    renderPage([anonymouslyCompleted, namedCompleted]);

    const anonSignal = await screen.findByTestId("completion-signal-conn-anon");
    expect(anonSignal).toHaveTextContent(/completed anonymously/i);
    expect(anonSignal).not.toHaveTextContent("u-42");

    const namedSignal = screen.getByTestId("completion-signal-conn-named");
    expect(namedSignal).toHaveTextContent(/completed by u-42/i);
    expect(namedSignal).not.toHaveTextContent(/anonymously/i);
  });

  it("renders no completion signal for a Connector that has never been completed", async () => {
    renderPage([savedConnector]);
    await screen.findByText("Stripe");
    expect(screen.queryByTestId("completion-signal-conn-1")).not.toBeInTheDocument();
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

  // HEL-1022: Edit/Delete moved from standalone buttons into a single
  // `ActionsMenu` popover -- open it (via its trigger's accessible name,
  // "<connector> actions") before reaching the `menuitem`.
  function openActionsMenu(connectorName: string) {
    fireEvent.click(screen.getByRole("button", { name: `${connectorName} actions` }));
  }

  it("deletes a connector with no dependents after confirm", async () => {
    deleteConnectorMock.mockResolvedValue(undefined);
    renderPage([savedConnector]);
    await screen.findByText("Stripe");

    openActionsMenu("Stripe");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
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
    await screen.findByText("Legacy source host");

    openActionsMenu("Legacy source host");
    const deleteItem = await screen.findByRole("menuitem", { name: "Delete" });
    expect(deleteItem).toBeDisabled();

    fireEvent.click(deleteItem);
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
    await screen.findByText("Stripe");

    openActionsMenu("Stripe");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm delete Stripe" }));

    expect(
      await screen.findByText(
        "This connector is now referenced by a dependent source — refresh the page and try again.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ConnectorHasDependents/)).not.toBeInTheDocument();
    expect(screen.getByText("Stripe")).toBeInTheDocument();
  });

  it("HEL-1022: Edit opens the edit modal via the Actions popover", async () => {
    renderPage([savedConnector]);
    await screen.findByText("Stripe");

    openActionsMenu("Stripe");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));

    expect(await screen.findByRole("dialog", { name: "Edit Stripe" })).toBeInTheDocument();
  });

  it("HEL-1022: defaults to most-recently-updated first", async () => {
    const older = { ...savedConnector, name: "Older Conn", updatedAt: "2026-01-01T00:00:00Z" };
    const newer = { ...implicitConnector, name: "Newer Conn", updatedAt: "2026-08-01T00:00:00Z" };
    renderPage([older, newer]);

    await screen.findByText("Newer Conn");
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Newer Conn");
  });

  it("HEL-1022: clicking the Name header sorts ascending, toggling to descending on a second click", async () => {
    const alpha = { ...savedConnector, id: "conn-a", name: "Alpha" };
    const bravo = { ...implicitConnector, id: "conn-b", name: "Bravo" };
    renderPage([bravo, alpha]);
    await screen.findByText("Bravo");

    fireEvent.click(screen.getByRole("button", { name: /Name/ }));
    expect(screen.getAllByRole("row").slice(1)[0]).toHaveTextContent("Alpha");

    fireEvent.click(screen.getByRole("button", { name: /Name/ }));
    expect(screen.getAllByRole("row").slice(1)[0]).toHaveTextContent("Bravo");
  });

  it("HEL-1022 follow-up: renders a visible Updated column carrying the default descending indicator on first paint", async () => {
    renderPage([savedConnector, implicitConnector]);
    await screen.findByText("Stripe");

    expect(screen.getByRole("columnheader", { name: /Updated/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    for (const name of ["Name", "Kind", "Base URL", "Credential", "Dependents"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(name) })).toHaveAttribute(
        "aria-sort",
        "none",
      );
    }
  });
});
