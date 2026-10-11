import type { ComponentProps } from "react";
import { fireEvent, screen, within } from "@testing-library/react";

import type { ColumnDef } from "../../../../shared/ui";
import { renderWithStore } from "../../../../test/renderWithStore";
import { TableRenderer } from "./TableRenderer";
import type { ConditionalFormatRule } from "./conditionalFormatting";

jest.mock("../../../pipelines/services/outputService", () => ({
  updateOutput: jest.fn().mockResolvedValue({}),
}));

// HEL-1307 task 4.4 (table). CLASSES and DOM only -- jest maps `.css` to a style mock, so the single-wash
// outcome and the colours are proven by the Playwright computed-style spec (4.7/4.8, C5). Per design D6 the
// row class sits on the <tr> (CSS paints its <td>s) and a cell-rule cell carries the cell class.

const rows: Record<string, unknown>[] = [
  { id: "1", status: "failed", pass_rate: "0.5", duration_s: "700" },
  { id: "2", status: "passed", pass_rate: "0.95", duration_s: "20" },
  { id: "3", status: " Failed ", pass_rate: "0.9", duration_s: "30" },
];

const cellRule: ConditionalFormatRule = {
  op: "lt",
  value: 0.8,
  tone: "error",
  label: "Failing",
  column: "pass_rate",
};
const rowRule: ConditionalFormatRule = {
  op: "eq",
  value: "failed",
  tone: "error",
  column: "status",
  target: "row",
};
const slowRule: ConditionalFormatRule = {
  op: "gt",
  value: 600,
  tone: "warning",
  column: "duration_s",
  target: "cell",
};

function renderTable(extra: Partial<ComponentProps<typeof TableRenderer>> = {}) {
  return renderWithStore(
    <TableRenderer
      outputId="out-1"
      paginationRows={rows}
      columnOrder={["id", "status", "pass_rate", "duration_s"]}
      {...extra}
    />,
  );
}

function bodyRows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("tbody tr"));
}
function cell(tr: HTMLElement, index: number): HTMLElement {
  return tr.querySelectorAll<HTMLElement>("td")[index];
}

describe("TableRenderer -- cell rules", () => {
  it("tones only the matching cell: cell class, glyph, title and accessible text", () => {
    const { container } = renderTable({ conditionalFormats: [cellRule] });
    const [r1, r2] = bodyRows(container);
    const hit = cell(r1, 2);
    expect(hit).toHaveClass("ui-data-grid__cell--tone-error");
    expect(hit.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(hit.querySelector("[title='Failing']")).not.toBeNull();
    expect(within(hit).getByText("Failing")).toHaveClass("sr-only");
    expect(hit).toHaveTextContent("0.5");
    // neighbours and the passing row are untouched
    expect(cell(r1, 1).className).not.toMatch(/tone/);
    expect(cell(r2, 2).className).not.toMatch(/tone/);
    expect(r1.className).not.toMatch(/tone/);
  });

  it("falls back to the tone word when there is no label", () => {
    const { container } = renderTable({ conditionalFormats: [slowRule] });
    const hit = cell(bodyRows(container)[0], 3);
    expect(hit).toHaveClass("ui-data-grid__cell--tone-warning");
    expect(within(hit).getByText("Warning")).toHaveClass("sr-only");
  });

  it("evaluates the RAW value, not the formatted cell text", () => {
    const { container } = renderTable({
      columnFormats: { pass_rate: { type: "number", decimals: 0 } },
      conditionalFormats: [cellRule],
    });
    const hit = cell(bodyRows(container)[0], 2);
    expect(hit).toHaveTextContent("1"); // 0.5 rendered with 0 decimals ...
    expect(hit).toHaveClass("ui-data-grid__cell--tone-error"); // ... but the rule still saw 0.5
  });

  it("never applies a rule whose column does not exist", () => {
    const { container } = renderTable({
      conditionalFormats: [{ op: "gte", value: 0, tone: "success", column: "no_such_column" }],
    });
    expect(container.querySelector("[class*='tone']")).toBeNull();
  });

  it("matches text case-insensitively after trimming", () => {
    const { container } = renderTable({
      conditionalFormats: [{ op: "eq", value: "failed", tone: "error", column: "status" }],
    });
    const trs = bodyRows(container);
    expect(cell(trs[0], 1)).toHaveClass("ui-data-grid__cell--tone-error");
    expect(cell(trs[1], 1).className).not.toMatch(/tone/);
    expect(cell(trs[2], 1)).toHaveClass("ui-data-grid__cell--tone-error");
  });

  it("keeps a pinned cell's pinned class alongside its tone class", () => {
    const { container } = renderTable({
      columnOrder: ["pass_rate", "id", "status", "duration_s"],
      pinnedColumns: ["pass_rate"],
      conditionalFormats: [cellRule],
    });
    const hit = cell(bodyRows(container)[0], 0);
    expect(hit).toHaveClass("ui-data-grid__pinned-cell", "ui-data-grid__cell--tone-error");
  });
});

describe("TableRenderer -- row rules", () => {
  it("puts the row class on the <tr> of every matching row only (no per-cell wash class)", () => {
    const { container } = renderTable({ conditionalFormats: [rowRule] });
    const trs = bodyRows(container);
    expect(trs[0]).toHaveClass("ui-data-grid__row--tone-error");
    expect(trs[1].className).not.toMatch(/tone/);
    expect(trs[2]).toHaveClass("ui-data-grid__row--tone-error");
    // D6: CSS paints the <td>s from the row class; no td carries a tone class of its own.
    expect(trs[0].querySelectorAll("td[class*='tone']")).toHaveLength(0);
  });

  it("starts the row's first visible data cell with the glyph and the tone word", () => {
    const { container } = renderTable({ conditionalFormats: [rowRule] });
    const first = cell(bodyRows(container)[0], 0);
    expect(first.firstElementChild?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(within(first).getByText("Critical")).toHaveClass("sr-only");
    expect(first.firstElementChild).toHaveAttribute("title", "Critical");
    // only the first data cell carries the row mark
    expect(within(cell(bodyRows(container)[0], 1)).queryByText("Critical")).toBeNull();
  });

  it("keeps a non-colour signal when the rule's column is hidden by columnOrder", () => {
    const { container } = renderTable({
      columnOrder: ["id", "pass_rate"],
      conditionalFormats: [rowRule],
    });
    const trs = bodyRows(container);
    expect(trs[0]).toHaveClass("ui-data-grid__row--tone-error");
    expect(within(cell(trs[0], 0)).getByText("Critical")).toBeInTheDocument();
    expect(container.querySelectorAll("th")).toHaveLength(2);
  });

  it("uses the rule label for the row mark when set", () => {
    const { container } = renderTable({
      conditionalFormats: [{ ...rowRule, label: "Build failed" }],
    });
    expect(within(cell(bodyRows(container)[0], 0)).getByText("Build failed")).toBeInTheDocument();
  });

  it("composes with a caller rowClassName instead of replacing it", () => {
    const { container } = renderTable({
      conditionalFormats: [rowRule],
      rowClassName: (row) => (row === rows[0] ? "flagged-row" : undefined),
    });
    const trs = bodyRows(container);
    expect(trs[0]).toHaveClass("flagged-row", "ui-data-grid__row--tone-error");
    expect(trs[2]).toHaveClass("ui-data-grid__row--tone-error");
    expect(trs[2]).not.toHaveClass("flagged-row");
  });

  it("follows the row through a sort (keyed by row object, not position)", () => {
    const { container } = renderTable({ conditionalFormats: [rowRule] });
    const sortBtn = screen.getByRole("button", { name: "id" });
    fireEvent.click(sortBtn);
    fireEvent.click(sortBtn); // descending: id 3, 2, 1
    const trs = bodyRows(container);
    expect(trs.map((t) => t.classList.contains("ui-data-grid__row--tone-error"))).toEqual([
      true,
      false,
      true,
    ]);
  });
});

describe("TableRenderer -- cell and row rules resolve independently", () => {
  it("a washed row can hold a differently toned cell; the row mark stays in the first cell", () => {
    const { container } = renderTable({ conditionalFormats: [rowRule, slowRule, cellRule] });
    const r1 = bodyRows(container)[0];
    expect(r1).toHaveClass("ui-data-grid__row--tone-error");
    const slow = cell(r1, 3);
    expect(slow).toHaveClass("ui-data-grid__cell--tone-warning");
    // the cell-rule cell carries the cell class; D6: it has no second (row) class of its own
    expect(slow.className).not.toMatch(/row--tone/);
    expect(within(slow).getByText("Warning")).toBeInTheDocument();
    expect(within(slow).queryByText("Critical")).toBeNull();
    expect(within(cell(r1, 0)).getByText("Critical")).toBeInTheDocument();
    // another cell in the row has neither a cell class nor a duplicate mark
    expect(cell(r1, 1).className).not.toMatch(/tone/);
  });

  it("first matching rule wins per target", () => {
    const { container } = renderTable({
      conditionalFormats: [
        { op: "lt", value: 0.8, tone: "warning", column: "pass_rate" },
        { op: "lt", value: 0.8, tone: "error", column: "pass_rate" },
      ],
    });
    expect(cell(bodyRows(container)[0], 2)).toHaveClass("ui-data-grid__cell--tone-warning");
  });
});

describe("TableRenderer -- no rules", () => {
  it("renders byte-identical DOM with no rules, an empty list or rules that match nothing", () => {
    const base = renderTable().container.innerHTML;
    for (const conditionalFormats of [
      undefined,
      [],
      [{ op: "gt", value: 1e9, tone: "error", column: "duration_s" } as ConditionalFormatRule],
    ]) {
      const { container, unmount } = renderTable({ conditionalFormats });
      expect(container.innerHTML).toBe(base);
      unmount();
    }
  });

  it("leaves leadingColumns alone", () => {
    const change: ColumnDef = { key: "__change__", header: "Change", render: () => "chg" };
    const { container } = renderTable({ leadingColumns: [change], conditionalFormats: [rowRule] });
    const first = cell(bodyRows(container)[0], 0);
    expect(first).toHaveTextContent("chg");
    expect(first.querySelector("svg")).toBeNull();
    expect(within(cell(bodyRows(container)[0], 1)).getByText("Critical")).toBeInTheDocument();
  });
});
