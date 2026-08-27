import { configureStore } from "@reduxjs/toolkit";

import {
  clearDeleteConflict,
  connectorsReducer,
  createConnector,
  deleteConnector,
  fetchConnectors,
  rotateConnectorCredential,
  updateConnector,
} from "./connectorsSlice";
import * as connectorEntityService from "../services/connectorEntityService";
import type { Connector } from "../types/connector";

jest.mock("../services/connectorEntityService", () => ({
  fetchConnectors: jest.fn(),
  createConnector: jest.fn(),
  updateConnector: jest.fn(),
  deleteConnector: jest.fn(),
  rotateConnectorCredential: jest.fn(),
}));

const deleteConnectorServiceMock = jest.mocked(connectorEntityService.deleteConnector);

const testConnector: Connector = {
  id: "c-1",
  ownerId: "u-1",
  name: "Stripe",
  kind: "rest_api",
  baseUrl: "https://api.stripe.com",
  config: { authType: "bearer" },
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
  dependentCount: 0,
};

describe("connectorsSlice", () => {
  it("populates items when fetchConnectors fulfills", () => {
    const nextState = connectorsReducer(
      undefined,
      fetchConnectors.fulfilled([testConnector], "req-1"),
    );
    expect(nextState.items).toEqual([testConnector]);
    expect(nextState.status).toBe("succeeded");
    expect(nextState.error).toBeNull();
  });

  it("sets loading status on pending and failed status + message on rejected", () => {
    const pending = connectorsReducer(undefined, fetchConnectors.pending("req-1"));
    expect(pending.status).toBe("loading");

    const rejected = connectorsReducer(
      undefined,
      fetchConnectors.rejected(new Error("boom"), "req-1", undefined, "Failed to load connectors."),
    );
    expect(rejected.status).toBe("failed");
    expect(rejected.error).toBe("Failed to load connectors.");
  });

  it("prepends a newly created connector", () => {
    const existing: Connector = { ...testConnector, id: "c-0", name: "Existing" };
    const state = connectorsReducer(
      { items: [existing], status: "succeeded", error: null, deleteConflict: {} },
      createConnector.fulfilled(testConnector, "req-1", {
        name: "Stripe",
        kind: "rest_api",
        baseUrl: "https://api.stripe.com",
        credential: "secret",
      }),
    );
    expect(state.items).toEqual([testConnector, existing]);
  });

  it("replaces the matching connector on update fulfilled", () => {
    const updated: Connector = { ...testConnector, name: "Renamed" };
    const state = connectorsReducer(
      { items: [testConnector], status: "succeeded", error: null, deleteConflict: {} },
      updateConnector.fulfilled(updated, "req-1", { id: "c-1", request: { name: "Renamed" } }),
    );
    expect(state.items[0].name).toBe("Renamed");
  });

  it("replaces the matching connector on rotateConnectorCredential fulfilled", () => {
    const rotated: Connector = { ...testConnector, updatedAt: "2026-08-02T00:00:00Z" };
    const state = connectorsReducer(
      { items: [testConnector], status: "succeeded", error: null, deleteConflict: {} },
      rotateConnectorCredential.fulfilled(rotated, "req-1", {
        id: "c-1",
        request: { credential: "new-value" },
      }),
    );
    expect(state.items[0].updatedAt).toBe("2026-08-02T00:00:00Z");
  });

  it("removes the connector and clears any deleteConflict on delete fulfilled", () => {
    const state = connectorsReducer(
      {
        items: [testConnector],
        status: "succeeded",
        error: null,
        deleteConflict: { "c-1": "still referenced" },
      },
      deleteConnector.fulfilled("c-1", "req-1", { id: "c-1", dependentCount: 0 }),
    );
    expect(state.items).toEqual([]);
    expect(state.deleteConflict).toEqual({});
  });

  it("records a per-id deleteConflict message on delete rejected", () => {
    const state = connectorsReducer(
      { items: [testConnector], status: "succeeded", error: null, deleteConflict: {} },
      deleteConnector.rejected(
        new Error("boom"),
        "req-1",
        { id: "c-1", dependentCount: 1 },
        {
          id: "c-1",
          message: "Still referenced by 1 source. Repoint or delete it first.",
          conflict: true,
        },
      ),
    );
    expect(state.deleteConflict["c-1"]).toBe(
      "Still referenced by 1 source. Repoint or delete it first.",
    );
    // The connector is NOT removed on a blocked delete.
    expect(state.items).toEqual([testConnector]);
  });

  // HEL-824 skeptic-final-1.md change request 3: the thunk itself (not just
  // the reducer) builds a 409 message from the row's own `dependentCount`,
  // never the raw backend `ConnectorHasDependents: ...` string.
  it("deleteConnector thunk builds a counted client-side message on a 409 when dependentCount > 0", async () => {
    deleteConnectorServiceMock.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { error: "ConnectorHasDependents: still referenced" } },
    });
    const store = configureStore({ reducer: { connectors: connectorsReducer } });

    await store.dispatch(deleteConnector({ id: "c-1", dependentCount: 3 }));

    expect(store.getState().connectors.deleteConflict["c-1"]).toBe(
      "Still referenced by 3 sources. Repoint or delete them first.",
    );
  });

  it("deleteConnector thunk falls back to a non-counted message on a 409 when dependentCount is 0 (stale-count race)", async () => {
    deleteConnectorServiceMock.mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { error: "ConnectorHasDependents: still referenced" } },
    });
    const store = configureStore({ reducer: { connectors: connectorsReducer } });

    await store.dispatch(deleteConnector({ id: "c-1", dependentCount: 0 }));

    expect(store.getState().connectors.deleteConflict["c-1"]).toBe(
      "This connector is now referenced by a dependent source — refresh the page and try again.",
    );
  });

  it("clearDeleteConflict removes only the named entry", () => {
    const state = connectorsReducer(
      {
        items: [testConnector],
        status: "succeeded",
        error: null,
        deleteConflict: { "c-1": "conflict", "c-2": "other conflict" },
      },
      clearDeleteConflict("c-1"),
    );
    expect(state.deleteConflict).toEqual({ "c-2": "other conflict" });
  });
});
