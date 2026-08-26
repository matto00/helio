import { screen, waitFor } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import * as auditEventService from "../services/auditEventService";
import type { AuditEvent } from "../types/auditEvent";
import { AuditHistorySection } from "./AuditHistorySection";

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
  fetchAuditEventsMock.mockReset();
});

describe("AuditHistorySection", () => {
  it("shows a loading indicator while the fetch is in flight", () => {
    fetchAuditEventsMock.mockReturnValueOnce(new Promise(() => {}));
    renderWithStore(<AuditHistorySection />);

    expect(screen.getByLabelText("Loading audit history")).toBeInTheDocument();
  });

  it("shows an empty state when the user has zero audit events", async () => {
    fetchAuditEventsMock.mockResolvedValueOnce({ items: [], total: 0, offset: 0, limit: 200 });
    renderWithStore(<AuditHistorySection />);

    expect(await screen.findByText("No audit events yet")).toBeInTheDocument();
  });

  it("shows an error state without crashing when the request fails", async () => {
    fetchAuditEventsMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { message: "Failed to load audit history." } },
    });
    renderWithStore(<AuditHistorySection />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to load audit history.");
  });

  it("renders rows with human-readable action/actor/source/timestamp", async () => {
    fetchAuditEventsMock.mockResolvedValueOnce({
      items: [testEvent],
      total: 1,
      offset: 0,
      limit: 200,
    });
    renderWithStore(<AuditHistorySection />);

    await waitFor(() => expect(screen.getByText("Created dashboard")).toBeInTheDocument());
    expect(screen.getByText("You (browser)")).toBeInTheDocument();
    expect(screen.getByText("ui")).toBeInTheDocument();
  });

  it("shows a truncation caption when total exceeds the items shown", async () => {
    fetchAuditEventsMock.mockResolvedValueOnce({
      items: [testEvent],
      total: 5,
      offset: 0,
      limit: 200,
    });
    renderWithStore(<AuditHistorySection />);

    expect(await screen.findByText("Showing latest 1 of 5 events.")).toBeInTheDocument();
  });

  it("renders no mutation controls (buttons/links) in the table", async () => {
    fetchAuditEventsMock.mockResolvedValueOnce({
      items: [testEvent],
      total: 1,
      offset: 0,
      limit: 200,
    });
    renderWithStore(<AuditHistorySection />);

    await waitFor(() => expect(screen.getByText("Created dashboard")).toBeInTheDocument());
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
