import { screen } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import type { User } from "../../auth/types/user";
import { OwnerOnly } from "./OwnerOnly";

function user(tier: User["tier"]): User {
  return {
    id: "u-1",
    email: "u@example.com",
    displayName: null,
    avatarUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    tier,
  };
}

function renderFor(tier?: User["tier"]) {
  return renderWithStore(
    <OwnerOnly fallback={<p>fallback shown</p>}>
      <p>owner content</p>
    </OwnerOnly>,
    tier ? { auth: { status: "authenticated", currentUser: user(tier) } } : undefined,
  );
}

describe("OwnerOnly", () => {
  it("renders the content for an owner", () => {
    renderFor("owner");
    expect(screen.getByText("owner content")).toBeInTheDocument();
    expect(screen.queryByText("fallback shown")).not.toBeInTheDocument();
  });

  it.each(["free", "beta"] as const)("renders only the fallback for a %s-tier user", (tier) => {
    renderFor(tier);
    expect(screen.getByText("fallback shown")).toBeInTheDocument();
    expect(screen.queryByText("owner content")).not.toBeInTheDocument();
  });

  it("renders only the fallback when there is no signed-in user", () => {
    renderFor();
    expect(screen.getByText("fallback shown")).toBeInTheDocument();
    expect(screen.queryByText("owner content")).not.toBeInTheDocument();
  });
});
