// HEL-1773 D6: `GET /api/outputs/:id/history` is an Output route; a dashboard grantee reads no history through it. A
// panel-scoped (public) source is unaffected by the role.
import { renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";

import { DashboardAccessProvider } from "../../dashboards/state/dashboardAccessContext";
import type { DashboardAccessRole } from "../../dashboards/types/dashboard";
import { fetchOutputHistory, fetchPublicOutputHistory } from "./outputHistoryService";
import { useOutputHistory } from "./useOutputHistory";

jest.mock("./outputHistoryService");

function wrapperFor(role: DashboardAccessRole) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <DashboardAccessProvider role={role}>{children}</DashboardAccessProvider>;
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(fetchOutputHistory).mockResolvedValue({} as never);
  jest.mocked(fetchPublicOutputHistory).mockResolvedValue({} as never);
});

it("an owner reads the Output history route", () => {
  renderHook(() => useOutputHistory("o-own", "p", "pl", undefined, true, null), {
    wrapper: wrapperFor("owner"),
  });
  expect(fetchOutputHistory).toHaveBeenCalledWith("o-own");
});

it.each(["viewer", "editor"] as const)("a %s reads no history through the Output route", (role) => {
  const { result } = renderHook(
    () => useOutputHistory("o-" + role, "p", "pl", undefined, true, null),
    {
      wrapper: wrapperFor(role),
    },
  );
  expect(fetchOutputHistory).not.toHaveBeenCalled();
  expect(result.current).toBeNull();
});

it("a public source is read whatever the role", () => {
  renderHook(
    () =>
      useOutputHistory(
        "o-pub",
        "p",
        undefined,
        { variant: "public", dashboardId: "d", token: "t" },
        true,
        null,
      ),
    { wrapper: wrapperFor("viewer") },
  );
  expect(fetchPublicOutputHistory).toHaveBeenCalledWith("d", "p", "t");
});
