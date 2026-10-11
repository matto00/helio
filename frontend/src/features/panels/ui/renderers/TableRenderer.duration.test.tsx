import { fireEvent, screen } from "@testing-library/react";

import { renderWithStore } from "../../../../test/renderWithStore";
import { formatColumnValue } from "./columnFormatting";
import { TableRenderer } from "./TableRenderer";

jest.mock("../../../pipelines/services/outputService", () => ({
  updateOutput: jest.fn().mockResolvedValue({}),
}));

// HEL-1308 task 4.3.
describe("formatColumnValue -- duration", () => {
  it("seconds by default, milliseconds with unit ms", () => {
    expect(formatColumnValue({ type: "duration" }, 330)).toBe("5m 30s");
    expect(formatColumnValue({ type: "duration", unit: "ms" }, 1500)).toBe("2s");
    expect(formatColumnValue({ type: "duration", unit: "ms" }, "330000")).toBe("5m 30s");
  });

  // GUARD (passes on base behaviour: an unknown spec type falls to formatCell). Mutation that turns it red:
  // in the `duration` case replace `return formatCell(value)` after `n === undefined` with `return String(n)`
  // (red-guard-table-fallback.log).
  it("null -> em dash, non-numeric passes through", () => {
    expect(formatColumnValue({ type: "duration" }, null)).toBe("—");
    expect(formatColumnValue({ type: "duration" }, "n/a")).toBe("n/a");
    expect(formatColumnValue({ type: "duration" }, "")).toBe("");
  });
});

describe("TableRenderer -- duration column", () => {
  function cellText(): string[] {
    return screen
      .getAllByRole("row")
      .filter((row) => row.closest("tbody") != null)
      .map((row) => row.querySelector("td")?.textContent ?? "");
  }

  it("renders a ms column and right-aligns header and cells", () => {
    const { container } = renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[{ n: 1500 }]}
        columnFormats={{ n: { type: "duration", unit: "ms" } }}
      />,
    );
    expect(screen.getByText("2s")).toBeInTheDocument();
    const th = container.querySelector("thead tr.ui-data-grid__header-row th") as HTMLElement;
    const td = container.querySelector("tbody td") as HTMLElement;
    expect(th.style.textAlign).toBe("right");
    expect(td.style.textAlign).toBe("right");
  });

  // GUARD (same reason and mutation as the formatColumnValue fallback guard above).
  it("null renders an em dash and n/a passes through", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[{ n: null }, { n: "n/a" }]}
        columnFormats={{ n: { type: "duration" } }}
      />,
    );
    expect(cellText().sort()).toEqual(["n/a", "—"]);
  });

  it("sorts by the raw value, not the display text", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[{ n: 330 }, { n: 45 }, { n: 3600 }]}
        columnFormats={{ n: { type: "duration" } }}
      />,
    );
    const header = screen
      .getAllByRole("columnheader")
      .filter((th) => !th.closest(".ui-data-grid__filter-row, .ui-data-grid__filter-toggle-row"))
      .map((th) => th.querySelector("button") as HTMLElement)[0];
    fireEvent.click(header);
    expect(cellText()).toEqual(["45s", "5m 30s", "1h"]);
  });

  it("the filter matches the displayed text, not the raw value", () => {
    renderWithStore(
      <TableRenderer
        outputId="p"
        paginationRows={[{ n: 330 }, { n: 45 }]}
        columnFormats={{ n: { type: "duration" } }}
      />,
    );
    const toggle = screen.queryByRole("button", { name: /filter/i });
    if (toggle && !screen.queryByRole("textbox", { name: "Filter column n" })) {
      fireEvent.click(toggle);
    }
    fireEvent.change(screen.getByRole("textbox", { name: "Filter column n" }), {
      target: { value: "5m" },
    });
    expect(screen.getByText("5m 30s")).toBeInTheDocument();
    expect(screen.queryByText("45s")).not.toBeInTheDocument();
  });
});
