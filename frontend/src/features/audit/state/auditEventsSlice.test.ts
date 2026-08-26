import { configureStore } from "@reduxjs/toolkit";

import { auditEventsReducer, fetchAuditEvents } from "./auditEventsSlice";
import * as auditEventService from "../services/auditEventService";
import type { AuditEvent } from "../types/auditEvent";

jest.mock("../services/auditEventService", () => ({
  fetchAuditEvents: jest.fn(),
}));

const fetchAuditEventsMock = jest.mocked(auditEventService.fetchAuditEvents);

const testEvent: AuditEvent = {
  id: "ae-1",
  actorUserId: "u-1",
  actorTokenId: null,
  source: "ui",
  action: "dashboard.create",
  resourceType: "dashboard",
  resourceId: "d-1",
  metadata: {},
  createdAt: "2026-07-01T00:00:00Z",
};

beforeEach(() => {
  jest.resetAllMocks();
});

function buildStore() {
  return configureStore({ reducer: { auditEvents: auditEventsReducer } });
}

describe("auditEventsSlice reducers", () => {
  it("sets loading status when fetchAuditEvents is pending", () => {
    const nextState = auditEventsReducer(undefined, fetchAuditEvents.pending("req-1", undefined));
    expect(nextState.status).toBe("loading");
    expect(nextState.error).toBeNull();
  });

  it("populates items and total when fetchAuditEvents fulfills", () => {
    const nextState = auditEventsReducer(
      undefined,
      fetchAuditEvents.fulfilled({ items: [testEvent], total: 1 }, "req-1", undefined),
    );
    expect(nextState.status).toBe("succeeded");
    expect(nextState.items).toEqual([testEvent]);
    expect(nextState.total).toBe(1);
    expect(nextState.error).toBeNull();
  });

  it("sets error state when fetchAuditEvents rejects", () => {
    const nextState = auditEventsReducer(
      undefined,
      fetchAuditEvents.rejected(
        new Error("boom"),
        "req-1",
        undefined,
        "Failed to load audit history.",
      ),
    );
    expect(nextState.status).toBe("failed");
    expect(nextState.error).toBe("Failed to load audit history.");
  });
});

describe("fetchAuditEvents thunk", () => {
  it("dispatches fulfilled with items/total on success", async () => {
    fetchAuditEventsMock.mockResolvedValue({ items: [testEvent], total: 1, offset: 0, limit: 200 });
    const store = buildStore();

    await store.dispatch(fetchAuditEvents());

    expect(store.getState().auditEvents.status).toBe("succeeded");
    expect(store.getState().auditEvents.items).toEqual([testEvent]);
    expect(store.getState().auditEvents.total).toBe(1);
  });

  it("dispatches an empty result without error when the user has zero events", async () => {
    fetchAuditEventsMock.mockResolvedValue({ items: [], total: 0, offset: 0, limit: 200 });
    const store = buildStore();

    await store.dispatch(fetchAuditEvents());

    expect(store.getState().auditEvents.status).toBe("succeeded");
    expect(store.getState().auditEvents.items).toEqual([]);
    expect(store.getState().auditEvents.total).toBe(0);
    expect(store.getState().auditEvents.error).toBeNull();
  });

  it("dispatches rejected with the extracted error message on failure", async () => {
    fetchAuditEventsMock.mockRejectedValue({
      isAxiosError: true,
      response: { data: { message: "Unauthorized" } },
    });
    const store = buildStore();

    await store.dispatch(fetchAuditEvents());

    expect(store.getState().auditEvents.status).toBe("failed");
    expect(store.getState().auditEvents.error).toBe("Unauthorized");
  });

  it("falls back to a generic error message when the failure isn't an axios error", async () => {
    fetchAuditEventsMock.mockRejectedValue(new Error("network down"));
    const store = buildStore();

    await store.dispatch(fetchAuditEvents());

    expect(store.getState().auditEvents.status).toBe("failed");
    expect(store.getState().auditEvents.error).toBe("Failed to load audit history.");
  });
});
