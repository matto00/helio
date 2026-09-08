import { fireEvent, render, screen } from "@testing-library/react";

import { AuditEventTable } from "./AuditEventTable";
import type { AuditEvent } from "../types/auditEvent";

function event(overrides: Partial<AuditEvent>): AuditEvent {
  return {
    id: "e-1",
    actorUserId: "u-1",
    actorTokenId: null,
    source: "ui",
    action: "dashboard.create",
    resourceType: "dashboard",
    resourceId: "d-1",
    metadata: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function rowOrder() {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.textContent);
}

describe("AuditEventTable — HEL-1022 default ordering and column sorting", () => {
  const older = event({ id: "e-old", action: "aaa.create", createdAt: "2026-01-01T00:00:00Z" });
  const newer = event({ id: "e-new", action: "zzz.create", createdAt: "2026-06-01T00:00:00Z" });

  it("defaults to most-recent-first", () => {
    render(<AuditEventTable events={[older, newer]} />);
    expect(rowOrder()[0]).toContain("zzz.create");
  });

  it("clicking the Action header sorts ascending, toggling to descending on a second click", () => {
    render(<AuditEventTable events={[newer, older]} />);
    fireEvent.click(screen.getByRole("button", { name: /Action/ }));
    expect(rowOrder()[0]).toContain("aaa.create");

    fireEvent.click(screen.getByRole("button", { name: /Action/ }));
    expect(rowOrder()[0]).toContain("zzz.create");
  });

  it("marks the active sort header's aria-sort and leaves others none", () => {
    render(<AuditEventTable events={[newer, older]} />);
    fireEvent.click(screen.getByRole("button", { name: /Action/ }));
    expect(screen.getByRole("columnheader", { name: /Action/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(screen.getByRole("columnheader", { name: /When/ })).toHaveAttribute("aria-sort", "none");
  });

  it("HEL-1022 follow-up: the default sort (When desc) is visible on first paint, and every other header is none", () => {
    render(<AuditEventTable events={[older, newer]} />);
    expect(screen.getByRole("columnheader", { name: /When/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    for (const name of ["Action", "Resource", "Actor", "Source"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(name) })).toHaveAttribute(
        "aria-sort",
        "none",
      );
    }
  });
});
