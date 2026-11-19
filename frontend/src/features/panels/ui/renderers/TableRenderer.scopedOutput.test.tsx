// HEL-1773 D5: an Output read through the per-panel `output-meta` route (a dashboard grantee's) carries no owner
// (`ownerId: ""` once rebuilt as an `Output`), so a column sort never persists through `PATCH /api/outputs/:id` -- the
// table sorts on screen only, whoever is signed in.
import { fireEvent, screen } from "@testing-library/react";

import { TableRenderer } from "./TableRenderer";
import { renderWithStore } from "../../../../test/renderWithStore";

jest.mock("../../../pipelines/services/outputService", () => ({ updateOutput: jest.fn() }));

const { updateOutput } = jest.requireMock<{ updateOutput: jest.Mock }>(
  "../../../pipelines/services/outputService",
);

afterEach(() => jest.useRealTimers());

it.each([
  ["a panel-scoped Output (no owner)", "", "me", false],
  ["an Output the signed-in user owns", "me", "me", true],
])("%s: persists a sort = %s", (_label, ownerId, userId, persists) => {
  jest.useFakeTimers();
  updateOutput.mockReset().mockResolvedValue(undefined);
  renderWithStore(
    <TableRenderer outputId="out-1" ownerId={ownerId} paginationRows={[{ n: "b" }, { n: "a" }]} />,
    { auth: { currentUser: { id: userId } as never } },
  );
  const header = screen
    .getAllByRole("columnheader")
    .filter((th) => !th.closest(".ui-data-grid__filter-row, .ui-data-grid__filter-toggle-row"))[0];
  fireEvent.click(header.querySelector("button") as HTMLElement);
  jest.advanceTimersByTime(5000);
  expect(updateOutput).toHaveBeenCalledTimes(persists ? 1 : 0);
});
